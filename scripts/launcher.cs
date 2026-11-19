using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("RhineLab Music")]
[assembly: AssemblyProduct("RhineLab Music")]
[assembly: AssemblyCompany("RhineLab Music")]
[assembly: AssemblyDescription("RhineLab Music Desktop Terminal")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program {
  static readonly Dictionary<string, string> MimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
    { ".html", "text/html; charset=utf-8" },
    { ".js", "application/javascript; charset=utf-8" },
    { ".mjs", "application/javascript; charset=utf-8" },
    { ".css", "text/css; charset=utf-8" },
    { ".json", "application/json; charset=utf-8" },
    { ".webmanifest", "application/manifest+json; charset=utf-8" },
    { ".svg", "image/svg+xml" },
    { ".png", "image/png" },
    { ".webp", "image/webp" },
    { ".jpg", "image/jpeg" },
    { ".ico", "image/x-icon" },
    { ".woff2", "font/woff2" },
    { ".woff", "font/woff" },
    { ".ttf", "font/ttf" },
    { ".glb", "model/gltf-binary" },
    { ".mp3", "audio/mpeg" },
    { ".wav", "audio/wav" },
    { ".ogg", "audio/ogg" },
    { ".txt", "text/plain; charset=utf-8" },
    { ".pdf", "application/pdf" }
  };

  static string DataDir() {
    string dir = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "RhineLabMusic"
    );
    Directory.CreateDirectory(dir);
    return dir;
  }

  static readonly object logLock = new object();
  static readonly List<string> recentLogs = new List<string>();
  static string LogPath() {
    string dir = Path.Combine(DataDir(), "logs");
    Directory.CreateDirectory(dir);
    return Path.Combine(dir, "launcher.log");
  }
  static string ScrubSecrets(string text) {
    if (string.IsNullOrEmpty(text)) return "";
    text = Regex.Replace(text, "(access_token|refresh_token|client_secret|code|token|authorization)=([^&\\s\"']+)", "$1=[REDACTED]", RegexOptions.IgnoreCase);
    text = Regex.Replace(text, "Bearer\\s+[A-Za-z0-9\\-._~+/]+=*", "Bearer [REDACTED]", RegexOptions.IgnoreCase);
    return text;
  }
  static void LogEvent(string level, string message) {
    string line = DateTime.UtcNow.ToString("o") + " [" + level + "] " + ScrubSecrets(message);
    lock (logLock) {
      recentLogs.Add(line);
      if (recentLogs.Count > 80) recentLogs.RemoveAt(0);
      try {
        string path = LogPath();
        if (File.Exists(path) && new FileInfo(path).Length > 262144) {
          File.WriteAllText(path, line + Environment.NewLine, Encoding.UTF8);
        } else {
          File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8);
        }
      } catch {}
    }
  }

  static string GpuModePath() {
    return Path.Combine(DataDir(), "gpu-mode.txt");
  }

  static string NormalizeGpuMode(string raw) {
    if (string.IsNullOrEmpty(raw)) return "auto";
    string v = raw.Trim().ToLowerInvariant();
    if (v == "high" || v == "low" || v == "auto") return v;
    return "auto";
  }

  static string ReadGpuMode() {
    try {
      string path = GpuModePath();
      if (File.Exists(path)) return NormalizeGpuMode(File.ReadAllText(path, Encoding.UTF8));
    } catch {}
    return "auto";
  }

  static void WriteGpuMode(string mode) {
    File.WriteAllText(GpuModePath(), NormalizeGpuMode(mode), Encoding.UTF8);
  }

  static string GpuFlag(string mode) {
    if (mode == "high") return " --force_high_performance_gpu";
    if (mode == "low") return " --force_low_power_gpu";
    return "";
  }

  static string RenderBackendPath() {
    return Path.Combine(DataDir(), "render-backend.txt");
  }

  static string NormalizeRenderBackend(string raw) {
    if (string.IsNullOrEmpty(raw)) return "auto";
    string v = raw.Trim().ToLowerInvariant();
    if (v == "vulkan" || v == "auto" || v == "d3d11" || v == "gl") return v;
    return "auto";
  }

  static string ReadRenderBackend() {
    try {
      string path = RenderBackendPath();
      if (File.Exists(path)) return NormalizeRenderBackend(File.ReadAllText(path, Encoding.UTF8));
    } catch {}
    return "auto";
  }

  static void WriteRenderBackend(string backend) {
    File.WriteAllText(RenderBackendPath(), NormalizeRenderBackend(backend), Encoding.UTF8);
  }

  static string RenderBackendFlag(string backend) {
    if (backend == "vulkan") return " --use-angle=vulkan --enable-features=Vulkan";
    if (backend == "gl") return " --use-angle=gl";
    if (backend == "d3d11") return " --use-angle=d3d11";
    return "";
  }

  static string ThemePath() {
    return Path.Combine(DataDir(), "theme.txt");
  }

  static string NormalizeTheme(string raw) {
    if (!string.IsNullOrEmpty(raw) && raw.Trim().Equals("dark", StringComparison.OrdinalIgnoreCase)) return "dark";
    return "light";
  }

  static string ReadTheme() {
    try {
      string path = ThemePath();
      if (File.Exists(path)) return NormalizeTheme(File.ReadAllText(path, Encoding.UTF8));
    } catch {}
    return "light";
  }

  static void WriteTheme(string theme) {
    try { File.WriteAllText(ThemePath(), NormalizeTheme(theme), Encoding.UTF8); } catch {}
  }

  delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")]
  static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")]
  static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")]
  static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("dwmapi.dll")]
  static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);
  [StructLayout(LayoutKind.Sequential)]
  struct MARGINS {
    public int cxLeftWidth;
    public int cxRightWidth;
    public int cyTopHeight;
    public int cyBottomHeight;
  }
  [DllImport("dwmapi.dll")]
  static extern int DwmExtendFrameIntoClientArea(IntPtr hWnd, ref MARGINS pMarInset);
  [DllImport("user32.dll")]
  static extern bool ReleaseCapture();
  [DllImport("user32.dll")]
  static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  static extern uint ExtractIconEx(string lpszFile, int nIconIndex, out IntPtr phiconLarge, out IntPtr phiconSmall, uint nIcons);
  [DllImport("user32.dll", SetLastError = true)]
  static extern bool DestroyIcon(IntPtr hIcon);
  [DllImport("user32.dll")]
  static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")]
  static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr LoadLibrary(string lpFileName);
  [StructLayout(LayoutKind.Sequential)]
  struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct NCCALCSIZE_PARAMS {
    public RECT rgrc0;
    public RECT rgrc1;
    public RECT rgrc2;
    public IntPtr lppos;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct MONITORINFO {
    public int cbSize;
    public RECT rcMonitor;
    public RECT rcWork;
    public int dwFlags;
  }
  [DllImport("user32.dll")]
  static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);
  [DllImport("user32.dll")]
  static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

  static bool webViewRuntimeInitialized = false;
  static void SetupWebViewRuntime() {
    if (webViewRuntimeInitialized) return;
    webViewRuntimeInitialized = true;
    try {
      if (!SetProcessDpiAwarenessContext((IntPtr)(-4))) SetProcessDPIAware();
    } catch {
      try { SetProcessDPIAware(); } catch {}
    }
    try { Application.EnableVisualStyles(); } catch {}
    try { Application.SetCompatibleTextRenderingDefault(false); } catch {}
    AppDomain.CurrentDomain.AssemblyResolve += (sender, args) => {
      try {
        string shortName = new AssemblyName(args.Name).Name;
        string resName = null;
        if (shortName.Equals("Microsoft.Web.WebView2.Core", StringComparison.OrdinalIgnoreCase)) {
          resName = "RhineLabMusic.Microsoft.Web.WebView2.Core.dll";
        } else if (shortName.Equals("Microsoft.Web.WebView2.WinForms", StringComparison.OrdinalIgnoreCase)) {
          resName = "RhineLabMusic.Microsoft.Web.WebView2.WinForms.dll";
        }
        if (resName == null) return null;
        using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(resName)) {
          if (s == null) return null;
          byte[] buf = new byte[s.Length];
          int offset = 0;
          while (offset < buf.Length) {
            int n = s.Read(buf, offset, buf.Length - offset);
            if (n <= 0) break;
            offset += n;
          }
          return Assembly.Load(buf);
        }
      } catch {
        return null;
      }
    };
    try {
      using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("RhineLabMusic.WebView2Loader.dll")) {
        if (s != null) {
          string binDir = Path.Combine(DataDir(), "bin");
          Directory.CreateDirectory(binDir);
          string loaderPath = Path.Combine(binDir, "WebView2Loader.dll");
          bool writeNeeded = !File.Exists(loaderPath) || new FileInfo(loaderPath).Length != s.Length;
          if (writeNeeded) {
            try {
              using (var fs = File.Create(loaderPath)) s.CopyTo(fs);
            } catch {}
          }
          if (File.Exists(loaderPath)) LoadLibrary(loaderPath);
        }
      }
    } catch {}
  }

  static void CopyDirectoryRecursive(string srcDir, string dstDir) {
    Directory.CreateDirectory(dstDir);
    foreach (string file in Directory.GetFiles(srcDir)) {
      string destFile = Path.Combine(dstDir, Path.GetFileName(file));
      if (!File.Exists(destFile)) {
        try { File.Copy(file, destFile, false); } catch {}
      }
    }
    foreach (string subDir in Directory.GetDirectories(srcDir)) {
      string name = Path.GetFileName(subDir);
      CopyDirectoryRecursive(subDir, Path.Combine(dstDir, name));
    }
  }

  static void MigrateProfileToWebView2(string profile) {
    try {
      string srcDefault = Path.Combine(profile, "Default");
      if (!Directory.Exists(srcDefault)) return;
      string dstDefault = Path.Combine(profile, @"EBWebView\Default");
      foreach (string folder in new[] { "Local Storage", "IndexedDB" }) {
        string src = Path.Combine(srcDefault, folder);
        string dst = Path.Combine(dstDefault, folder);
        if (Directory.Exists(src) && !Directory.Exists(dst)) {
          CopyDirectoryRecursive(src, dst);
          LogEvent("INFO", "Migrated profile store to WebView2: " + folder);
        }
      }
    } catch (Exception ex) {
      LogEvent("WARN", "Profile migration warning: " + ex.Message);
    }
  }

  static bool IsWebView2Available() {
    try {
      string ver = CoreWebView2Environment.GetAvailableBrowserVersionString();
      return !string.IsNullOrEmpty(ver);
    } catch {
      return false;
    }
  }

  class FramelessHostForm : Form {
    readonly WebView2 webView;
    readonly string url;
    readonly string profileDir;
    readonly string browserArgs;
    readonly Action<string> onInitFailed;
    bool readyTriggered = false;
    IntPtr hIconLarge = IntPtr.Zero;
    IntPtr hIconSmall = IntPtr.Zero;

    public FramelessHostForm(string targetUrl, string profile, string args, bool initialDark, Action<string> failCb) {
      url = targetUrl;
      profileDir = profile;
      browserArgs = args;
      onInitFailed = failCb;
      Text = "RhineLab Music";
      try {
        Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (appIcon != null) Icon = appIcon;
      } catch {}
      FormBorderStyle = FormBorderStyle.Sizable;
      ControlBox = true;
      ShowIcon = true;
      ShowInTaskbar = true;
      StartPosition = FormStartPosition.CenterScreen;
      Rectangle wa = Screen.PrimaryScreen.WorkingArea;
      Size = new Size(Math.Min(1440, Math.Max(1024, wa.Width - 60)), Math.Min(900, Math.Max(680, wa.Height - 60)));
      MinimumSize = new Size(960, 620);
      Padding = new Padding(4);
      SetStyle(ControlStyles.ResizeRedraw, true);

      webView = new WebView2();
      webView.Dock = DockStyle.Fill;
      Controls.Add(webView);
      ApplyTheme(initialDark);

      webView.CoreWebView2InitializationCompleted += (sender, e) => {
        if (!e.IsSuccess) {
          onInitFailed(e.InitializationException != null ? e.InitializationException.Message : "WebView2 initialization failed");
          return;
        }
        OnCoreWebView2Ready();
      };
    }

    protected override CreateParams CreateParams {
      get {
        var cp = base.CreateParams;
        cp.Style |= 0x00040000 | 0x00020000 | 0x00010000 | 0x00080000;
        return cp;
      }
    }

    protected override void OnHandleCreated(EventArgs e) {
      base.OnHandleCreated(e);
      try {
        if (hIconLarge == IntPtr.Zero && hIconSmall == IntPtr.Zero) {
          ExtractIconEx(Application.ExecutablePath, 0, out hIconLarge, out hIconSmall, 1);
        }
        if (hIconLarge != IntPtr.Zero) SendMessage(Handle, 0x0080, (IntPtr)1, hIconLarge);
        if (hIconSmall != IntPtr.Zero) SendMessage(Handle, 0x0080, (IntPtr)0, hIconSmall);
        int cornerPref = 2; // DWMWCP_ROUND
        DwmSetWindowAttribute(Handle, 33, ref cornerPref, 4);
        var margins = new MARGINS { cxLeftWidth = 0, cxRightWidth = 0, cyTopHeight = 0, cyBottomHeight = 1 };
        DwmExtendFrameIntoClientArea(Handle, ref margins);
      } catch {}
      ApplyTheme(ReadTheme() == "dark");
    }

    protected override void OnShown(EventArgs e) {
      base.OnShown(e);
      if (readyTriggered) return;
      readyTriggered = true;
      try {
        var envOpts = new CoreWebView2EnvironmentOptions(browserArgs);
        CoreWebView2Environment.CreateAsync(null, profileDir, envOpts).ContinueWith(t => {
          if (t.IsFaulted || t.IsCanceled || IsDisposed) {
            string msg = t.Exception != null ? t.Exception.GetBaseException().Message : "WebView2 environment creation failed";
            try { BeginInvoke(new Action(() => onInitFailed(msg))); } catch {}
            return;
          }
          var env = t.Result;
          try {
            BeginInvoke(new Action(() => {
              if (!IsDisposed) {
                try { webView.EnsureCoreWebView2Async(env); }
                catch (Exception ex) { onInitFailed(ex.Message); }
              }
            }));
          } catch {}
        });
      } catch (Exception ex) {
        onInitFailed(ex.Message);
      }
    }

    void OnCoreWebView2Ready() {
      if (IsDisposed || webView.CoreWebView2 == null) return;
      var s = webView.CoreWebView2.Settings;
      s.IsStatusBarEnabled = false;
      s.AreDefaultContextMenusEnabled = false;
      s.AreBrowserAcceleratorKeysEnabled = true;
      try { s.IsNonClientRegionSupportEnabled = true; } catch {}

      webView.CoreWebView2.NewWindowRequested += (sender, e) => {
        try {
          if (!string.IsNullOrEmpty(e.Uri) &&
              (e.Uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
               e.Uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))) {
            e.Handled = true;
            Process.Start(new ProcessStartInfo { FileName = e.Uri, UseShellExecute = true });
          }
        } catch {}
      };
      webView.CoreWebView2.WebMessageReceived += (sender, e) => {
        try {
          string msg = e.TryGetWebMessageAsString();
          HandleWindowCommand(msg);
        } catch {}
      };
      webView.CoreWebView2.Navigate(url);
    }

    public void ApplyTheme(bool isDark) {
      Color bg = isDark ? Color.FromArgb(0x15, 0x18, 0x18) : Color.FromArgb(0xe9, 0xe5, 0xde);
      BackColor = bg;
      if (webView != null) {
        try { webView.DefaultBackgroundColor = bg; } catch {}
      }
      if (IsHandleCreated) SetDwmThemeAttrs(Handle, isDark);
    }

    public void HandleWindowCommand(string action) {
      if (string.IsNullOrEmpty(action) || IsDisposed) return;
      switch (action.Trim().ToLowerInvariant()) {
        case "minimize":
          WindowState = FormWindowState.Minimized;
          break;
        case "maximize":
          WindowState = FormWindowState.Maximized;
          break;
        case "toggle-maximize":
          WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
          break;
        case "close":
          Close();
          break;
        case "drag":
          ReleaseCapture();
          SendMessage(Handle, 0x00A1, (IntPtr)2, IntPtr.Zero);
          break;
      }
    }

    protected override void OnSizeChanged(EventArgs e) {
      base.OnSizeChanged(e);
      Padding targetPad = WindowState == FormWindowState.Maximized ? Padding.Empty : new Padding(4);
      if (Padding != targetPad) Padding = targetPad;
    }

    protected override void WndProc(ref Message m) {
      if (m.Msg == 0x0083 && m.WParam != IntPtr.Zero) {
        if (WindowState == FormWindowState.Maximized) {
          var ncp = (NCCALCSIZE_PARAMS)Marshal.PtrToStructure(m.LParam, typeof(NCCALCSIZE_PARAMS));
          IntPtr hMon = MonitorFromWindow(Handle, 2);
          var mi = new MONITORINFO();
          mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
          if (GetMonitorInfo(hMon, ref mi)) ncp.rgrc0 = mi.rcWork;
          Marshal.StructureToPtr(ncp, m.LParam, false);
        }
        m.Result = IntPtr.Zero;
        return;
      }
      if (m.Msg == 0x0084) {
        base.WndProc(ref m);
        if ((int)m.Result == 1 && WindowState != FormWindowState.Maximized) {
          Point pt = PointToClient(Cursor.Position);
          const int grip = 6;
          bool left = pt.X <= grip;
          bool right = pt.X >= ClientSize.Width - grip;
          bool top = pt.Y <= grip;
          bool bottom = pt.Y >= ClientSize.Height - grip;
          if (top && left) m.Result = (IntPtr)13;
          else if (top && right) m.Result = (IntPtr)14;
          else if (bottom && left) m.Result = (IntPtr)16;
          else if (bottom && right) m.Result = (IntPtr)17;
          else if (left) m.Result = (IntPtr)10;
          else if (right) m.Result = (IntPtr)11;
          else if (top) m.Result = (IntPtr)12;
          else if (bottom) m.Result = (IntPtr)15;
        }
        return;
      }
      base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing) {
      if (disposing && webView != null) {
        try { webView.Dispose(); } catch {}
      }
      if (hIconLarge != IntPtr.Zero) {
        try { DestroyIcon(hIconLarge); } catch {}
        hIconLarge = IntPtr.Zero;
      }
      if (hIconSmall != IntPtr.Zero) {
        try { DestroyIcon(hIconSmall); } catch {}
        hIconSmall = IntPtr.Zero;
      }
      base.Dispose(disposing);
    }
  }

  static void SetDwmThemeAttrs(IntPtr hWnd, bool isDark) {
    try {
      int dark = isDark ? 1 : 0;
      DwmSetWindowAttribute(hWnd, 20, ref dark, 4);
      int caption = isDark ? 0x00181815 : 0x00DEE5E9;
      int text = isDark ? 0x00E4EEF2 : 0x00131817;
      DwmSetWindowAttribute(hWnd, 35, ref caption, 4);
      DwmSetWindowAttribute(hWnd, 36, ref text, 4);
      DwmSetWindowAttribute(hWnd, 34, ref caption, 4);
    } catch {}
  }

  static bool ApplyWindowThemeToBrowser(bool isDark, int browserPid = 0) {
    bool applied = false;
    try {
      EnumWindows((hWnd, lParam) => {
        if (!IsWindowVisible(hWnd)) return true;
        var cls = new StringBuilder(64);
        GetClassName(hWnd, cls, cls.Capacity);
        if (!cls.ToString().StartsWith("Chrome_WidgetWin_", StringComparison.Ordinal)) return true;
        uint pid;
        GetWindowThreadProcessId(hWnd, out pid);
        var title = new StringBuilder(256);
        GetWindowText(hWnd, title, title.Capacity);
        string t = title.ToString();
        bool titleMatch = t.IndexOf("RhineLab", StringComparison.OrdinalIgnoreCase) >= 0;
        bool pidMatch = browserPid > 0 && pid == (uint)browserPid;
        if (titleMatch || pidMatch) {
          SetDwmThemeAttrs(hWnd, isDark);
          applied = true;
        }
        return true;
      }, IntPtr.Zero);
    } catch {}
    return applied;
  }

  static void SyncBrowserProfileTheme(string profile, bool isDark) {
    try {
      string prefPath = Path.Combine(profile, @"Default\Preferences");
      if (!File.Exists(prefPath)) return;
      string raw = File.ReadAllText(prefPath, Encoding.UTF8);
      if (string.IsNullOrWhiteSpace(raw)) return;
      var serializer = new JavaScriptSerializer();
      serializer.MaxJsonLength = 32 * 1024 * 1024;
      var root = serializer.DeserializeObject(raw) as Dictionary<string, object>;
      if (root == null) return;
      Dictionary<string, object> browserObj;
      if (root.ContainsKey("browser") && root["browser"] is Dictionary<string, object>) {
        browserObj = (Dictionary<string, object>)root["browser"];
      } else {
        browserObj = new Dictionary<string, object>();
        root["browser"] = browserObj;
      }
      Dictionary<string, object> themeObj;
      if (browserObj.ContainsKey("theme") && browserObj["theme"] is Dictionary<string, object>) {
        themeObj = (Dictionary<string, object>)browserObj["theme"];
      } else {
        themeObj = new Dictionary<string, object>();
        browserObj["theme"] = themeObj;
      }
      themeObj["color_scheme2"] = isDark ? 2 : 1;
      themeObj["follows_system_colors"] = false;
      File.WriteAllText(prefPath, serializer.Serialize(root), new UTF8Encoding(false));
    } catch {}
  }

  static int PickPort() {
    foreach (int candidate in new[] { 41890, 41891, 41892, 0 }) {
      TcpListener probe = null;
      try {
        probe = new TcpListener(IPAddress.Loopback, candidate);
        probe.Start();
        return ((IPEndPoint)probe.LocalEndpoint).Port;
      } catch {
      } finally {
        if (probe != null) probe.Stop();
      }
    }
    return 41890;
  }

  static Dictionary<string, byte[]> LoadAssets() {
    var files = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
    using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("RhineLabMusic.dist.zip")) {
      if (stream == null) throw new Exception("Embedded dist.zip resource missing.");
      using (var archive = new ZipArchive(stream, ZipArchiveMode.Read)) {
        foreach (var entry in archive.Entries) {
          if (string.IsNullOrEmpty(entry.Name)) continue;
          var key = "/" + entry.FullName.Replace('\\', '/').TrimStart('/');
          using (var ms = new MemoryStream())
          using (var es = entry.Open()) {
            es.CopyTo(ms);
            files[key] = ms.ToArray();
          }
        }
      }
    }
    return files;
  }

  static string FindBrowser() {
    string[] candidates = new[] {
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
      Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
    };
    foreach (var path in candidates) {
      if (File.Exists(path)) return path;
    }
    return null;
  }

  static string EscapeJson(string s) {
    if (string.IsNullOrEmpty(s)) return "";
    return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n").Replace("\t", "\\t");
  }

  static void SendJson(HttpListenerResponse res, int status, string json) {
    byte[] buf = Encoding.UTF8.GetBytes(json);
    res.StatusCode = status;
    res.ContentType = "application/json; charset=utf-8";
    res.Headers["Cache-Control"] = "no-store";
    res.ContentLength64 = buf.Length;
    res.OutputStream.Write(buf, 0, buf.Length);
    res.Close();
  }

  static string ReadBody(HttpListenerRequest req) {
    using (var reader = new StreamReader(req.InputStream, req.ContentEncoding ?? Encoding.UTF8)) {
      return reader.ReadToEnd();
    }
  }

  static readonly object ytLock = new object();
  static readonly object ytdlpExtractLock = new object();
  static string extractedYtDlpPath = null;
  static readonly Dictionary<string, object> resolveLocks = new Dictionary<string, object>(StringComparer.Ordinal);
  static readonly object activeStreamLock = new object();
  static string activeStreamKey = null;
  static CancellationTokenSource activeStreamCts = null;

  static CancellationToken BeginStreamToken(string streamKey) {
    lock (activeStreamLock) {
      if (activeStreamCts != null && !string.Equals(activeStreamKey, streamKey, StringComparison.Ordinal)) {
        try { activeStreamCts.Cancel(); } catch {}
        activeStreamCts = null;
      }
      if (activeStreamCts == null || activeStreamCts.IsCancellationRequested) {
        activeStreamCts = new CancellationTokenSource();
        activeStreamKey = streamKey;
      }
      return activeStreamCts.Token;
    }
  }

  static void AbortActiveStreams(string streamKey = null) {
    lock (activeStreamLock) {
      if (!string.IsNullOrEmpty(streamKey) && !string.Equals(activeStreamKey, streamKey, StringComparison.Ordinal)) {
        return;
      }
      if (activeStreamCts != null) {
        try { activeStreamCts.Cancel(); } catch {}
        activeStreamCts = null;
      }
      activeStreamKey = null;
    }
  }

  class ResolvedStream {
    public string DirectUrl;
    public string MimeType;
    public Dictionary<string, string> Headers;
    public string Protocol;
    public string FormatId;
    public string AudioCodec;
    public string AudioExt;
    public double BitrateKbps;
    public int SampleRateHz;
    public long ContentLength;
    public string Title;
    public string Artist;
    public string Album;
    public string Artwork;
    public string WebpageUrl;
    public string Extractor;
    public double Duration;
    public bool IsLive;
    public DateTime ExpiresUtc;
  }

  class HeadChunk {
    public byte[] Data;
    public long TotalLength;
    public string MimeType;
    public string AudioCodec;
    public string AudioExt;
    public double BitrateKbps;
    public int SampleRateHz;
    public DateTime CachedUtc;
  }

  static readonly Dictionary<string, ResolvedStream> streamCache = new Dictionary<string, ResolvedStream>(StringComparer.Ordinal);
  static readonly Dictionary<string, HeadChunk> headCache = new Dictionary<string, HeadChunk>(StringComparer.Ordinal);
  static readonly List<string> headCacheOrder = new List<string>();
  static readonly Regex VideoIdRegex = new Regex("^[a-zA-Z0-9_-]{11}$", RegexOptions.Compiled);
  static readonly Regex ExpireParamRegex = new Regex(@"[?&]expire=(\d+)", RegexOptions.Compiled);
  static int activeForegroundResolves = 0;
  static int streamCacheSavePending = 0;
  static readonly object prewarmQueueLock = new object();
  static readonly Queue<string> prewarmQueue = new Queue<string>();
  static readonly HashSet<string> prewarmPendingSet = new HashSet<string>(StringComparer.Ordinal);
  static readonly AutoResetEvent prewarmSignal = new AutoResetEvent(false);
  static bool prewarmWorkerStarted = false;

  static string StreamCachePath() {
    return Path.Combine(DataDir(), "stream-cache.json");
  }

  static DateTime ComputeExpiryUtc(string directUrl) {
    DateTime fallback = DateTime.UtcNow.AddMinutes(25);
    if (string.IsNullOrEmpty(directUrl)) return fallback;
    var m = ExpireParamRegex.Match(directUrl);
    if (!m.Success) return fallback;
    long epoch;
    if (!long.TryParse(m.Groups[1].Value, out epoch)) return fallback;
    try {
      var exp = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(epoch).AddMinutes(-5);
      var maxExp = DateTime.UtcNow.AddHours(4);
      var minExp = DateTime.UtcNow.AddMinutes(2);
      if (exp <= minExp) return fallback;
      return exp > maxExp ? maxExp : exp;
    } catch {
      return fallback;
    }
  }

  static void LoadStreamCacheFromDisk() {
    try {
      string path = StreamCachePath();
      if (!File.Exists(path)) return;
      string raw = File.ReadAllText(path, Encoding.UTF8);
      if (string.IsNullOrWhiteSpace(raw)) return;
      var serializer = new JavaScriptSerializer();
      serializer.MaxJsonLength = 16 * 1024 * 1024;
      var items = serializer.DeserializeObject(raw) as object[];
      if (items == null) return;
      var now = DateTime.UtcNow;
      lock (ytLock) {
        foreach (var obj in items) {
          var d = obj as Dictionary<string, object>;
          if (d == null) continue;
          string cacheKey = d.ContainsKey("key") ? Convert.ToString(d["key"]) : null;
          string directUrl = d.ContainsKey("directUrl") ? Convert.ToString(d["directUrl"]) : null;
          long expTicks = d.ContainsKey("expiresTicks") ? Convert.ToInt64(d["expiresTicks"]) : 0;
          if (string.IsNullOrEmpty(cacheKey) || string.IsNullOrEmpty(directUrl)) continue;
          var exp = new DateTime(expTicks, DateTimeKind.Utc);
          if (exp <= now.AddMinutes(1)) continue;
          var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
          var rawH = d.ContainsKey("headers") ? d["headers"] as Dictionary<string, object> : null;
          if (rawH != null) {
            foreach (var kv in rawH) {
              if (kv.Value != null) headers[kv.Key] = Convert.ToString(kv.Value);
            }
          }
          streamCache[cacheKey] = new ResolvedStream {
            DirectUrl = directUrl,
            MimeType = d.ContainsKey("mime") ? (Convert.ToString(d["mime"]) ?? "audio/mp4") : "audio/mp4",
            Headers = headers,
            Protocol = d.ContainsKey("protocol") ? (Convert.ToString(d["protocol"]) ?? "https") : "https",
            FormatId = d.ContainsKey("formatId") ? (Convert.ToString(d["formatId"]) ?? "bestaudio") : "bestaudio",
            AudioCodec = d.ContainsKey("acodec") ? (Convert.ToString(d["acodec"]) ?? "") : "",
            AudioExt = d.ContainsKey("aext") ? (Convert.ToString(d["aext"]) ?? "") : "",
            BitrateKbps = d.ContainsKey("abr") ? Convert.ToDouble(d["abr"]) : 0,
            SampleRateHz = d.ContainsKey("asr") ? Convert.ToInt32(d["asr"]) : 0,
            ContentLength = d.ContainsKey("cl") ? Convert.ToInt64(d["cl"]) : -1,
            Duration = d.ContainsKey("dur") ? Convert.ToDouble(d["dur"]) : 0,
            IsLive = d.ContainsKey("live") && Convert.ToBoolean(d["live"]),
            ExpiresUtc = exp
          };
        }
      }
    } catch {}
  }

  static void ScheduleSaveStreamCache() {
    if (Interlocked.Exchange(ref streamCacheSavePending, 1) == 1) return;
    ThreadPool.QueueUserWorkItem(_ => {
      Thread.Sleep(600);
      Interlocked.Exchange(ref streamCacheSavePending, 0);
      try {
        var now = DateTime.UtcNow;
        var list = new List<Dictionary<string, object>>();
        lock (ytLock) {
          foreach (var kv in streamCache) {
            var r = kv.Value;
            if (r == null || r.ExpiresUtc <= now.AddMinutes(1) || string.IsNullOrEmpty(r.DirectUrl)) continue;
            list.Add(new Dictionary<string, object> {
              { "key", kv.Key },
              { "directUrl", r.DirectUrl },
              { "mime", r.MimeType ?? "audio/mp4" },
              { "headers", r.Headers ?? new Dictionary<string, string>() },
              { "protocol", r.Protocol ?? "https" },
              { "formatId", r.FormatId ?? "bestaudio" },
              { "acodec", r.AudioCodec ?? "" },
              { "aext", r.AudioExt ?? "" },
              { "abr", r.BitrateKbps },
              { "asr", r.SampleRateHz },
              { "cl", r.ContentLength },
              { "dur", r.Duration },
              { "live", r.IsLive },
              { "expiresTicks", r.ExpiresUtc.Ticks }
            });
            if (list.Count >= 64) break;
          }
        }
        var serializer = new JavaScriptSerializer();
        serializer.MaxJsonLength = 16 * 1024 * 1024;
        File.WriteAllText(StreamCachePath(), serializer.Serialize(list), new UTF8Encoding(false));
      } catch {}
    });
  }

  static void EnsurePrewarmWorker() {
    lock (prewarmQueueLock) {
      if (prewarmWorkerStarted) return;
      prewarmWorkerStarted = true;
      var t = new Thread(() => {
        while (true) {
          string item = null;
          lock (prewarmQueueLock) {
            if (prewarmQueue.Count > 0) {
              item = prewarmQueue.Dequeue();
              prewarmPendingSet.Remove(item);
            }
          }
          if (item == null) {
            prewarmSignal.WaitOne(2000);
            continue;
          }
          while (Interlocked.CompareExchange(ref activeForegroundResolves, 0, 0) > 0) {
            Thread.Sleep(80);
          }
          int sep = item.IndexOf('|');
          if (sep > 0) {
            string normQ = item.Substring(0, sep);
            string targetUrl = item.Substring(sep + 1);
            PrewarmHeadChunk(targetUrl, normQ);
          }
        }
      }) { IsBackground = true };
      t.Start();
    }
  }

  static void EnqueuePrewarm(string targetUrl, string quality) {
    EnsurePrewarmWorker();
    string normQ = NormalizeAudioQuality(quality);
    string key = normQ + "|" + targetUrl;
    lock (ytLock) {
      HeadChunk existing;
      if (headCache.TryGetValue(key, out existing) && (DateTime.UtcNow - existing.CachedUtc).TotalMinutes < 15) {
        return;
      }
    }
    lock (prewarmQueueLock) {
      if (prewarmPendingSet.Contains(key)) return;
      if (prewarmQueue.Count >= 16) return;
      prewarmPendingSet.Add(key);
      prewarmQueue.Enqueue(key);
      prewarmSignal.Set();
    }
  }

  static string NormalizeAudioQuality(string q) {
    if (string.IsNullOrEmpty(q)) return "auto";
    string v = q.Trim().ToLowerInvariant();
    if (v == "standard" || v == "high" || v == "very_high" || v == "lossless" || v == "auto") return v;
    return "auto";
  }

  static string FormatSelectorForQuality(string quality) {
    switch (NormalizeAudioQuality(quality)) {
      case "standard":
        return "bestaudio[abr<=160][protocol^=http]/bestaudio[abr<=160]/bestaudio[protocol^=http]/bestaudio/best";
      case "high":
        return "bestaudio[abr<=260][protocol^=http]/bestaudio[abr<=260]/bestaudio[protocol^=http]/bestaudio/best";
      case "very_high":
        return "bestaudio[abr<=340][protocol^=http]/bestaudio[abr<=340]/bestaudio[protocol^=http]/bestaudio/best";
      default:
        return "bestaudio[acodec=flac][protocol^=http]/bestaudio[ext=flac][protocol^=http]/bestaudio[protocol^=http][ext=m4a]/bestaudio[protocol^=http][ext=webm]/bestaudio[protocol^=http][ext=mp3]/bestaudio[protocol^=http][ext=ogg]/bestaudio[protocol^=http][ext=opus]/bestaudio[protocol^=http]/bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[ext=mp3]/bestaudio[ext=ogg]/bestaudio[ext=opus]/bestaudio/best";
    }
  }

  static string QuoteArg(string arg) {
    if (string.IsNullOrEmpty(arg)) return "\"\"";
    if (arg.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return arg;
    var sb = new StringBuilder();
    sb.Append('"');
    int backslashes = 0;
    for (int i = 0; i < arg.Length; i++) {
      char c = arg[i];
      if (c == '\\') {
        backslashes++;
      } else if (c == '"') {
        sb.Append('\\', backslashes * 2 + 1);
        sb.Append('"');
        backslashes = 0;
      } else {
        if (backslashes > 0) { sb.Append('\\', backslashes); backslashes = 0; }
        sb.Append(c);
      }
    }
    if (backslashes > 0) sb.Append('\\', backslashes * 2);
    sb.Append('"');
    return sb.ToString();
  }

  static string JoinArgs(params string[] args) {
    var parts = new string[args.Length];
    for (int i = 0; i < args.Length; i++) parts[i] = QuoteArg(args[i]);
    return string.Join(" ", parts);
  }

  static string EnsureYtDlp() {
    string overridePath = Environment.GetEnvironmentVariable("RHINE_YTDLP_PATH");
    if (!string.IsNullOrEmpty(overridePath) && File.Exists(overridePath)) return overridePath;
    lock (ytdlpExtractLock) {
      if (!string.IsNullOrEmpty(extractedYtDlpPath) && File.Exists(extractedYtDlpPath)) return extractedYtDlpPath;
      string binDir = Path.Combine(DataDir(), "bin");
      Directory.CreateDirectory(binDir);
      string targetPath = Path.Combine(binDir, "yt-dlp.exe");
      using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("RhineLabMusic.yt-dlp.exe")) {
        if (stream == null) throw new Exception("找不到內嵌的串流解析模組 (yt-dlp.exe)");
        bool needsWrite = !File.Exists(targetPath);
        if (!needsWrite) {
          try {
            needsWrite = new FileInfo(targetPath).Length != stream.Length;
          } catch {
            needsWrite = true;
          }
        }
        if (needsWrite) {
          string tempPath = Path.Combine(binDir, "yt-dlp." + Process.GetCurrentProcess().Id + ".tmp");
          using (var fs = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None)) {
            stream.CopyTo(fs);
          }
          try {
            if (File.Exists(targetPath)) File.Delete(targetPath);
            File.Move(tempPath, targetPath);
          } catch {
            if (!File.Exists(targetPath)) throw;
            try { File.Delete(tempPath); } catch {}
          }
        }
      }
      extractedYtDlpPath = targetPath;
      return extractedYtDlpPath;
    }
  }

  static bool IsSafeExternalUrl(string rawUrl, out Uri uri) {
    uri = null;
    if (string.IsNullOrEmpty(rawUrl)) return false;
    if (!Uri.TryCreate(rawUrl.Trim(), UriKind.Absolute, out uri)) return false;
    if (uri.Scheme != "http" && uri.Scheme != "https") return false;
    string host = uri.Host.ToLowerInvariant();
    if (string.IsNullOrEmpty(host)) return false;
    if (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0" ||
        host.EndsWith(".local") || host.EndsWith(".internal")) return false;
    IPAddress ip;
    if (IPAddress.TryParse(host, out ip)) {
      if (IPAddress.IsLoopback(ip)) return false;
      byte[] b = ip.GetAddressBytes();
      if (b.Length == 4) {
        if (b[0] == 10 || b[0] == 127 || b[0] == 0) return false;
        if (b[0] == 169 && b[1] == 254) return false;
        if (b[0] == 172 && b[1] >= 16 && b[1] <= 31) return false;
        if (b[0] == 192 && b[1] == 168) return false;
      }
    }
    return true;
  }

  static int RunYtDlp(string[] args, int timeoutMs, out string stdout, out string stderr) {
    return RunYtDlp(args, timeoutMs, CancellationToken.None, out stdout, out stderr);
  }

  static int RunYtDlp(string[] args, int timeoutMs, CancellationToken ct, out string stdout, out string stderr) {
    ct.ThrowIfCancellationRequested();
    string exe = EnsureYtDlp();
    var psi = new ProcessStartInfo {
      FileName = exe,
      Arguments = JoinArgs(args),
      UseShellExecute = false,
      CreateNoWindow = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true,
      StandardOutputEncoding = Encoding.UTF8,
      StandardErrorEncoding = Encoding.UTF8
    };
    using (var proc = Process.Start(psi)) {
      if (proc == null) throw new Exception("無法啟動串流解析模組");
      using (ct.Register(() => { try { if (!proc.HasExited) proc.Kill(); } catch {} })) {
        string errBuf = "";
        var errThread = new Thread(() => {
          try { errBuf = proc.StandardError.ReadToEnd(); } catch {}
        }) { IsBackground = true };
        errThread.Start();
        string outBuf = proc.StandardOutput.ReadToEnd();
        ct.ThrowIfCancellationRequested();
        if (!proc.WaitForExit(timeoutMs)) {
          try { proc.Kill(); } catch {}
          throw new Exception("解析串流逾時，請稍後重試");
        }
        errThread.Join(1000);
        stdout = outBuf;
        stderr = errBuf;
        return proc.ExitCode;
      }
    }
  }

  static string MimeFromExt(string ext) {
    if (string.IsNullOrEmpty(ext)) return "audio/mp4";
    switch (ext.Trim().ToLowerInvariant()) {
      case "m4a":
      case "mp4":
      case "m4b": return "audio/mp4";
      case "webm":
      case "opus": return "audio/webm";
      case "mp3": return "audio/mpeg";
      case "ogg":
      case "oga": return "audio/ogg";
      case "wav": return "audio/wav";
      case "flac": return "audio/flac";
      case "aac": return "audio/aac";
      default: return "application/octet-stream";
    }
  }

  static object GetUrlLock(string key) {
    lock (ytLock) {
      object lk;
      if (!resolveLocks.TryGetValue(key, out lk)) {
        lk = new object();
        resolveLocks[key] = lk;
      }
      return lk;
    }
  }

  static void InvalidateStreamCache(string sourceUrl, string quality = "auto") {
    string cacheKey = NormalizeAudioQuality(quality) + "|" + sourceUrl;
    lock (ytLock) {
      streamCache.Remove(cacheKey);
      headCache.Remove(cacheKey);
      headCacheOrder.Remove(cacheKey);
    }
  }

  static string ParsePrintField(string s) {
    if (string.IsNullOrWhiteSpace(s)) return "";
    string t = s.Trim();
    if (t == "NA" || t == "None" || t == "null") return "";
    return t;
  }

  static ResolvedStream TryResolveFastYouTube(string sourceUrl, string normQ, CancellationToken ct) {
    if (string.IsNullOrEmpty(sourceUrl) || !sourceUrl.StartsWith("https://www.youtube.com/watch?v=", StringComparison.OrdinalIgnoreCase)) {
      return null;
    }
    string stdout, stderr;
    int code = RunYtDlp(new[] {
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--no-check-certificates",
      "-f", FormatSelectorForQuality(normQ),
      "--print", "%(url)s",
      "--print", "%(ext)s",
      "--print", "%(protocol)s",
      "--print", "%(format_id)s",
      "--print", "%(acodec)s",
      "--print", "%(abr)s",
      "--print", "%(asr)s",
      "--print", "%(filesize,filesize_approx)s",
      "--print", "%(duration)s",
      "--print", "%(is_live)s",
      "--print", "%(http_headers)j",
      "--", sourceUrl
    }, 25000, ct, out stdout, out stderr);
    if (code != 0 || string.IsNullOrWhiteSpace(stdout)) return null;
    string[] lines = stdout.Replace("\r\n", "\n").Split('\n');
    if (lines.Length < 10) return null;
    string directUrl = ParsePrintField(lines[0]);
    if (string.IsNullOrEmpty(directUrl) || !(directUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || directUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))) {
      return null;
    }
    string ext = ParsePrintField(lines[1]);
    string protocol = ParsePrintField(lines[2]);
    if (string.IsNullOrEmpty(protocol)) protocol = "https";
    string formatId = ParsePrintField(lines[3]);
    if (string.IsNullOrEmpty(formatId)) formatId = "bestaudio";
    string acodec = ParsePrintField(lines[4]);
    double abr = 0;
    double.TryParse(ParsePrintField(lines[5]), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out abr);
    int asr = 0;
    int.TryParse(ParsePrintField(lines[6]), out asr);
    long contentLength = -1;
    long parsedCl;
    if (long.TryParse(ParsePrintField(lines[7]), out parsedCl) && parsedCl > 0) contentLength = parsedCl;
    double duration = 0;
    double.TryParse(ParsePrintField(lines[8]), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out duration);
    string liveStr = ParsePrintField(lines[9]);
    bool isLive = liveStr.Equals("True", StringComparison.OrdinalIgnoreCase) || liveStr.Equals("true", StringComparison.OrdinalIgnoreCase);
    var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    string rawHeadersJson = lines.Length > 10 ? ParsePrintField(lines[10]) : "";
    if (!string.IsNullOrEmpty(rawHeadersJson) && rawHeadersJson.StartsWith("{")) {
      try {
        var serializer = new JavaScriptSerializer();
        var rawHeaders = serializer.DeserializeObject(rawHeadersJson) as Dictionary<string, object>;
        if (rawHeaders != null) {
          foreach (var kv in rawHeaders) {
            if (kv.Value != null) headers[kv.Key] = Convert.ToString(kv.Value);
          }
        }
      } catch {}
    }
    return new ResolvedStream {
      DirectUrl = directUrl,
      MimeType = MimeFromExt(ext),
      Headers = headers,
      Protocol = protocol,
      FormatId = formatId,
      AudioCodec = acodec,
      AudioExt = ext,
      BitrateKbps = abr,
      SampleRateHz = asr,
      ContentLength = contentLength,
      Title = "",
      Artist = "",
      Album = "",
      Artwork = "",
      WebpageUrl = sourceUrl,
      Extractor = "Youtube",
      Duration = duration,
      IsLive = isLive,
      ExpiresUtc = ComputeExpiryUtc(directUrl)
    };
  }

  static ResolvedStream ResolveStream(string sourceUrl, bool forceRefresh, CancellationToken ct = default(CancellationToken), string quality = "auto", bool needFullMetadata = false) {
    ct.ThrowIfCancellationRequested();
    string normQ = NormalizeAudioQuality(quality);
    string cacheKey = normQ + "|" + sourceUrl;
    if (!forceRefresh) {
      lock (ytLock) {
        ResolvedStream cached;
        if (streamCache.TryGetValue(cacheKey, out cached) && cached.ExpiresUtc > DateTime.UtcNow) {
          if (!needFullMetadata || !string.IsNullOrEmpty(cached.Title)) {
            return cached;
          }
        }
      }
    }
    lock (GetUrlLock(cacheKey)) {
      ct.ThrowIfCancellationRequested();
      if (!forceRefresh) {
        lock (ytLock) {
          ResolvedStream cached;
          if (streamCache.TryGetValue(cacheKey, out cached) && cached.ExpiresUtc > DateTime.UtcNow) {
            if (!needFullMetadata || !string.IsNullOrEmpty(cached.Title)) {
              return cached;
            }
          }
        }
      }
      if (!needFullMetadata) {
        ResolvedStream fast = null;
        try {
          fast = TryResolveFastYouTube(sourceUrl, normQ, ct);
        } catch (OperationCanceledException) {
          throw;
        } catch {}
        if (fast != null) {
          lock (ytLock) {
            streamCache[cacheKey] = fast;
          }
          ScheduleSaveStreamCache();
          return fast;
        }
      }
      string stdout, stderr;
      int code = RunYtDlp(new[] {
        "--no-playlist",
        "--no-warnings",
        "--no-progress",
        "--no-check-certificates",
        "--dump-single-json",
        "-f", FormatSelectorForQuality(normQ),
        "--", sourceUrl
      }, 30000, ct, out stdout, out stderr);
      if (code != 0 || string.IsNullOrWhiteSpace(stdout)) {
        string errMsg = !string.IsNullOrWhiteSpace(stderr) ? stderr.Trim() : "無法解析此網址的音訊串流";
        if (errMsg.IndexOf("DRM", StringComparison.OrdinalIgnoreCase) >= 0) {
          errMsg = "此來源受 DRM 版權保護，無法透過公開代理串流";
        }
        throw new Exception(errMsg);
      }
      var serializer = new JavaScriptSerializer();
      serializer.MaxJsonLength = 32 * 1024 * 1024;
      var root = serializer.DeserializeObject(stdout) as Dictionary<string, object>;
      if (root == null) throw new Exception("串流解析回傳格式無效");

      string directUrl = root.ContainsKey("url") ? Convert.ToString(root["url"]) : null;
      string ext = root.ContainsKey("ext") ? Convert.ToString(root["ext"]) : null;
      string protocol = root.ContainsKey("protocol") ? Convert.ToString(root["protocol"]) : "https";
      string formatId = root.ContainsKey("format_id") ? Convert.ToString(root["format_id"]) : "bestaudio";
      if (string.IsNullOrEmpty(directUrl)) throw new Exception("找不到可用的純音訊串流位址");

      long contentLength = -1;
      if (root.ContainsKey("filesize") && root["filesize"] != null) {
        try { contentLength = Convert.ToInt64(root["filesize"]); } catch {}
      } else if (root.ContainsKey("filesize_approx") && root["filesize_approx"] != null) {
        try { contentLength = Convert.ToInt64(root["filesize_approx"]); } catch {}
      }

      var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
      var rawHeaders = root.ContainsKey("http_headers") ? root["http_headers"] as Dictionary<string, object> : null;
      if (rawHeaders != null) {
        foreach (var kv in rawHeaders) {
          if (kv.Value != null) headers[kv.Key] = Convert.ToString(kv.Value);
        }
      }

      double duration = 0;
      if (root.ContainsKey("duration") && root["duration"] != null) {
        try { duration = Convert.ToDouble(root["duration"]); } catch {}
      }
      bool isLive = false;
      if (root.ContainsKey("is_live") && root["is_live"] != null) {
        try { isLive = Convert.ToBoolean(root["is_live"]); } catch {}
      }

      string artist = "";
      if (root.ContainsKey("artist") && root["artist"] != null) artist = Convert.ToString(root["artist"]);
      if (string.IsNullOrEmpty(artist) && root.ContainsKey("uploader") && root["uploader"] != null) artist = Convert.ToString(root["uploader"]);
      if (string.IsNullOrEmpty(artist) && root.ContainsKey("channel") && root["channel"] != null) artist = Convert.ToString(root["channel"]);

      double abr = 0;
      if (root.ContainsKey("abr") && root["abr"] != null) {
        try { abr = Convert.ToDouble(root["abr"]); } catch {}
      }
      int asr = 0;
      if (root.ContainsKey("asr") && root["asr"] != null) {
        try { asr = Convert.ToInt32(root["asr"]); } catch {}
      }
      string acodec = root.ContainsKey("acodec") ? (Convert.ToString(root["acodec"]) ?? "") : "";

      var resolved = new ResolvedStream {
        DirectUrl = directUrl,
        MimeType = MimeFromExt(ext),
        Headers = headers,
        Protocol = protocol ?? "https",
        FormatId = formatId ?? "bestaudio",
        AudioCodec = acodec,
        AudioExt = ext ?? "",
        BitrateKbps = abr,
        SampleRateHz = asr,
        ContentLength = contentLength,
        Title = root.ContainsKey("title") ? (Convert.ToString(root["title"]) ?? "") : "",
        Artist = artist ?? "",
        Album = root.ContainsKey("album") ? (Convert.ToString(root["album"]) ?? "") : "",
        Artwork = root.ContainsKey("thumbnail") ? (Convert.ToString(root["thumbnail"]) ?? "") : "",
        WebpageUrl = root.ContainsKey("webpage_url") ? (Convert.ToString(root["webpage_url"]) ?? sourceUrl) : sourceUrl,
        Extractor = root.ContainsKey("extractor_key") ? (Convert.ToString(root["extractor_key"]) ?? "") : "",
        Duration = duration,
        IsLive = isLive,
        ExpiresUtc = ComputeExpiryUtc(directUrl)
      };
      lock (ytLock) {
        streamCache[cacheKey] = resolved;
      }
      ScheduleSaveStreamCache();
      return resolved;
    }
  }

  const int MaxHeadChunkBytes = 1048576;

  static void StoreHeadChunk(string cacheKey, ResolvedStream resolved, long totalLen, byte[] data) {
    if (data == null || data.Length == 0) return;
    lock (ytLock) {
      headCache[cacheKey] = new HeadChunk {
        Data = data,
        TotalLength = totalLen,
        MimeType = resolved.MimeType,
        AudioCodec = resolved.AudioCodec,
        AudioExt = resolved.AudioExt,
        BitrateKbps = resolved.BitrateKbps,
        SampleRateHz = resolved.SampleRateHz,
        CachedUtc = DateTime.UtcNow
      };
      headCacheOrder.Remove(cacheKey);
      headCacheOrder.Add(cacheKey);
      while (headCacheOrder.Count > 16) {
        string oldest = headCacheOrder[0];
        headCacheOrder.RemoveAt(0);
        headCache.Remove(oldest);
      }
    }
  }

  static void PrewarmHeadChunk(string sourceUrl, string quality = "auto") {
    string normQ = NormalizeAudioQuality(quality);
    string cacheKey = normQ + "|" + sourceUrl;
    lock (ytLock) {
      HeadChunk existing;
      if (headCache.TryGetValue(cacheKey, out existing) && (DateTime.UtcNow - existing.CachedUtc).TotalMinutes < 15) {
        return;
      }
    }
    try {
      ResolvedStream resolved = ResolveStream(sourceUrl, false, CancellationToken.None, normQ);
      if (resolved.IsLive ||
          resolved.Protocol.StartsWith("m3u8", StringComparison.OrdinalIgnoreCase) ||
          resolved.Protocol.Equals("http_dash_segments", StringComparison.OrdinalIgnoreCase)) {
        return;
      }
      var req = (HttpWebRequest)WebRequest.Create(resolved.DirectUrl);
      req.Method = "GET";
      req.Timeout = 12000;
      req.ReadWriteTimeout = 12000;
      req.AllowAutoRedirect = true;
      ApplyHeaders(req, resolved.Headers);
      req.AddRange(0, MaxHeadChunkBytes - 1);
      using (var resp = (HttpWebResponse)req.GetResponse())
      using (var rs = resp.GetResponseStream())
      using (var ms = new MemoryStream()) {
        byte[] buf = new byte[32768];
        int n;
        while (ms.Length < MaxHeadChunkBytes && (n = rs.Read(buf, 0, Math.Min(buf.Length, MaxHeadChunkBytes - (int)ms.Length))) > 0) {
          ms.Write(buf, 0, n);
        }
        byte[] data = ms.ToArray();
        if (data.Length > 0) {
          long totalLen = resolved.ContentLength;
          string cr = resp.Headers["Content-Range"];
          if (!string.IsNullOrEmpty(cr)) {
            int slash = cr.LastIndexOf('/');
            if (slash >= 0) {
              long parsed;
              if (long.TryParse(cr.Substring(slash + 1), out parsed)) totalLen = parsed;
            }
          }
          StoreHeadChunk(cacheKey, resolved, totalLen, data);
        }
      }
    } catch {}
  }

  static void ApplyHeaders(HttpWebRequest req, Dictionary<string, string> headers) {
    if (headers == null) return;
    foreach (var kv in headers) {
      string k = kv.Key;
      string v = kv.Value;
      if (string.IsNullOrEmpty(v)) continue;
      if (k.Equals("User-Agent", StringComparison.OrdinalIgnoreCase)) req.UserAgent = v;
      else if (k.Equals("Referer", StringComparison.OrdinalIgnoreCase)) req.Referer = v;
      else if (k.Equals("Accept", StringComparison.OrdinalIgnoreCase)) req.Accept = v;
      else if (!k.Equals("Host", StringComparison.OrdinalIgnoreCase) &&
               !k.Equals("Connection", StringComparison.OrdinalIgnoreCase) &&
               !k.Equals("Content-Length", StringComparison.OrdinalIgnoreCase) &&
               !k.Equals("Range", StringComparison.OrdinalIgnoreCase) &&
               !k.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase)) {
        try { req.Headers[k] = v; } catch {}
      }
    }
  }

  static void ProxyNonProgressiveStream(HttpListenerContext ctx, string sourceUrl, ResolvedStream resolved, CancellationToken ct) {
    ct.ThrowIfCancellationRequested();
    ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
    ctx.Response.Headers["Cache-Control"] = "no-store";
    ctx.Response.Headers["Accept-Ranges"] = "none";
    ctx.Response.ContentType = resolved.MimeType;
    if (ctx.Request.HttpMethod == "HEAD") {
      ctx.Response.StatusCode = 200;
      ctx.Response.Close();
      return;
    }
    string exe = EnsureYtDlp();
    var psi = new ProcessStartInfo {
      FileName = exe,
      Arguments = JoinArgs("--no-playlist", "--no-part", "--no-warnings", "--no-progress", "-f", resolved.FormatId, "-o", "-", "--", sourceUrl),
      UseShellExecute = false,
      CreateNoWindow = true,
      RedirectStandardOutput = true,
      RedirectStandardError = true
    };
    using (var proc = Process.Start(psi)) {
      if (proc == null) throw new Exception("無法啟動串流程序");
      using (ct.Register(() => {
        try { if (!proc.HasExited) proc.Kill(); } catch {}
        try { ctx.Response.Abort(); } catch {}
      })) {
        var errDrain = new Thread(() => { try { proc.StandardError.ReadToEnd(); } catch {} }) { IsBackground = true };
        errDrain.Start();
        ctx.Response.StatusCode = 200;
        ctx.Response.SendChunked = true;
        try {
          byte[] buf = new byte[65536];
          var bs = proc.StandardOutput.BaseStream;
          int n;
          while (!ct.IsCancellationRequested && (n = bs.Read(buf, 0, buf.Length)) > 0) {
            ctx.Response.OutputStream.Write(buf, 0, n);
          }
          if (ct.IsCancellationRequested) {
            try { ctx.Response.Abort(); } catch {}
          } else {
            ctx.Response.Close();
          }
        } catch {
          try { if (!proc.HasExited) proc.Kill(); } catch {}
          try { ctx.Response.Abort(); } catch {}
        } finally {
          try { if (!proc.HasExited) proc.Kill(); } catch {}
        }
      }
    }
  }

  static void ProxyStream(HttpListenerContext ctx, string sourceUrl, string sid, string quality = "auto") {
    string normQ = NormalizeAudioQuality(quality);
    string cacheKey = normQ + "|" + sourceUrl;
    string streamKey = !string.IsNullOrEmpty(sid) ? ("sid:" + sid) : sourceUrl;
    CancellationToken ct = BeginStreamToken(streamKey);
    const long ChunkSize = 4 * 1024 * 1024;
    string rangeHeader = ctx.Request.Headers["Range"];
    bool hasRange = false;
    long reqStart = 0;
    long reqEnd = -1;
    if (!string.IsNullOrEmpty(rangeHeader)) {
      var rm = Regex.Match(rangeHeader, @"^bytes=(\d+)-(\d*)$");
      if (rm.Success) {
        hasRange = true;
        reqStart = long.Parse(rm.Groups[1].Value);
        if (!string.IsNullOrEmpty(rm.Groups[2].Value)) {
          reqEnd = long.Parse(rm.Groups[2].Value);
          if (reqEnd < reqStart) {
            SendJson(ctx.Response, 416, "{\"ok\":false,\"error\":\"無效的 Range 範圍\"}");
            return;
          }
        } else {
          reqEnd = reqStart + ChunkSize - 1;
        }
      }
    }

    if (ctx.Request.HttpMethod == "GET" && hasRange && reqStart == 0 && reqEnd >= 0) {
      HeadChunk hc = null;
      lock (ytLock) {
        HeadChunk found;
        if (headCache.TryGetValue(cacheKey, out found) && (DateTime.UtcNow - found.CachedUtc).TotalMinutes < 15) {
          hc = found;
        }
      }
      if (hc != null && hc.Data.Length > 0) {
        long serveEnd = Math.Min(reqEnd, (long)hc.Data.Length - 1);
        if (hc.TotalLength > 0 && serveEnd >= hc.TotalLength) serveEnd = hc.TotalLength - 1;
        int sliceLen = (int)(serveEnd - reqStart + 1);
        if (sliceLen > 0) {
          ctx.Response.StatusCode = 206;
          ctx.Response.ContentType = hc.MimeType;
          ctx.Response.Headers["Accept-Ranges"] = "bytes";
          ctx.Response.Headers["Cache-Control"] = "no-store";
          ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
          ctx.Response.Headers["Access-Control-Expose-Headers"] = "Content-Range, Content-Length, Accept-Ranges, X-Rhine-Audio-Codec, X-Rhine-Audio-Bitrate, X-Rhine-Audio-SampleRate, X-Rhine-Audio-Ext";
          if (!string.IsNullOrEmpty(hc.AudioCodec)) ctx.Response.Headers["X-Rhine-Audio-Codec"] = hc.AudioCodec;
          if (hc.BitrateKbps > 0) ctx.Response.Headers["X-Rhine-Audio-Bitrate"] = Math.Round(hc.BitrateKbps).ToString();
          if (hc.SampleRateHz > 0) ctx.Response.Headers["X-Rhine-Audio-SampleRate"] = hc.SampleRateHz.ToString();
          if (!string.IsNullOrEmpty(hc.AudioExt)) ctx.Response.Headers["X-Rhine-Audio-Ext"] = hc.AudioExt;
          string totalStr = hc.TotalLength > 0 ? hc.TotalLength.ToString() : "*";
          ctx.Response.Headers["Content-Range"] = "bytes 0-" + serveEnd + "/" + totalStr;
          ctx.Response.ContentLength64 = sliceLen;
          ctx.Response.OutputStream.Write(hc.Data, 0, sliceLen);
          ctx.Response.Close();
          return;
        }
      }
    }

    bool headersSent = false;
    long currentPos = reqStart;
    long expectedRemaining = -1;

    for (int attempt = 0; attempt < 4; attempt++) {
      if (ct.IsCancellationRequested) {
        try { ctx.Response.Abort(); } catch {}
        return;
      }
      try {
        Interlocked.Increment(ref activeForegroundResolves);
        ResolvedStream resolved;
        try {
          resolved = ResolveStream(sourceUrl, attempt > 0, ct, normQ, false);
        } finally {
          Interlocked.Decrement(ref activeForegroundResolves);
        }
        if (resolved.IsLive ||
            resolved.Protocol.StartsWith("m3u8", StringComparison.OrdinalIgnoreCase) ||
            resolved.Protocol.Equals("http_dash_segments", StringComparison.OrdinalIgnoreCase) ||
            resolved.Protocol.Equals("rtmp", StringComparison.OrdinalIgnoreCase)) {
          if (headersSent) { try { ctx.Response.Abort(); } catch {} return; }
          ProxyNonProgressiveStream(ctx, sourceUrl, resolved, ct);
          return;
        }

        if (resolved.ContentLength > 0 && hasRange) {
          if (currentPos >= resolved.ContentLength) {
            if (!headersSent) SendJson(ctx.Response, 416, "{\"ok\":false,\"error\":\"Range 超出範圍\"}");
            return;
          }
          if (reqEnd < 0 || reqEnd >= resolved.ContentLength) {
            reqEnd = resolved.ContentLength - 1;
          }
        }

        var upstream = (HttpWebRequest)WebRequest.Create(resolved.DirectUrl);
        upstream.Method = ctx.Request.HttpMethod;
        upstream.Timeout = 25000;
        upstream.ReadWriteTimeout = 25000;
        upstream.AllowAutoRedirect = true;
        ApplyHeaders(upstream, resolved.Headers);
        if (hasRange || headersSent) {
          if (reqEnd >= currentPos) upstream.AddRange(currentPos, reqEnd);
          else upstream.AddRange(currentPos);
        }

        using (ct.Register(() => {
          try { upstream.Abort(); } catch {}
          try { ctx.Response.Abort(); } catch {}
        }))
        using (var resp = (HttpWebResponse)upstream.GetResponse()) {
          if (ct.IsCancellationRequested) {
            try { ctx.Response.Abort(); } catch {}
            return;
          }
          if (!headersSent) {
            ctx.Response.StatusCode = (int)resp.StatusCode;
            ctx.Response.ContentType = string.IsNullOrEmpty(resp.ContentType) || resp.ContentType == "application/octet-stream"
              ? resolved.MimeType
              : resp.ContentType;
            ctx.Response.Headers["Accept-Ranges"] = "bytes";
            ctx.Response.Headers["Cache-Control"] = "no-store";
            ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
            ctx.Response.Headers["Access-Control-Expose-Headers"] = "Content-Range, Content-Length, Accept-Ranges, X-Rhine-Audio-Codec, X-Rhine-Audio-Bitrate, X-Rhine-Audio-SampleRate, X-Rhine-Audio-Ext";
            if (!string.IsNullOrEmpty(resolved.AudioCodec)) ctx.Response.Headers["X-Rhine-Audio-Codec"] = resolved.AudioCodec;
            if (resolved.BitrateKbps > 0) ctx.Response.Headers["X-Rhine-Audio-Bitrate"] = Math.Round(resolved.BitrateKbps).ToString();
            if (resolved.SampleRateHz > 0) ctx.Response.Headers["X-Rhine-Audio-SampleRate"] = resolved.SampleRateHz.ToString();
            if (!string.IsNullOrEmpty(resolved.AudioExt)) ctx.Response.Headers["X-Rhine-Audio-Ext"] = resolved.AudioExt;
            string contentRange = resp.Headers["Content-Range"];
            if (!string.IsNullOrEmpty(contentRange)) ctx.Response.Headers["Content-Range"] = contentRange;
            if (resp.ContentLength >= 0) {
              ctx.Response.ContentLength64 = resp.ContentLength;
              expectedRemaining = resp.ContentLength;
            }
            headersSent = true;
          }

          if (ctx.Request.HttpMethod == "HEAD") {
            ctx.Response.Close();
            return;
          }

          long headTotalLen = resolved.ContentLength;
          string headCr = resp.Headers["Content-Range"];
          if (!string.IsNullOrEmpty(headCr)) {
            int slash = headCr.LastIndexOf('/');
            if (slash >= 0) {
              long parsed;
              if (long.TryParse(headCr.Substring(slash + 1), out parsed)) headTotalLen = parsed;
            }
          }
          MemoryStream headCapture = null;
          if (ctx.Request.HttpMethod == "GET" && currentPos == 0) {
            headCapture = new MemoryStream();
          }

          using (var rs = resp.GetResponseStream()) {
            byte[] buf = new byte[65536];
            int n;
            while (!ct.IsCancellationRequested && (n = rs.Read(buf, 0, buf.Length)) > 0) {
              try {
                ctx.Response.OutputStream.Write(buf, 0, n);
              } catch {
                if (headCapture != null) { headCapture.Dispose(); headCapture = null; }
                try { ctx.Response.Abort(); } catch {}
                return;
              }
              if (headCapture != null && headCapture.Length < MaxHeadChunkBytes) {
                int take = Math.Min(n, MaxHeadChunkBytes - (int)headCapture.Length);
                headCapture.Write(buf, 0, take);
                if (headCapture.Length >= MaxHeadChunkBytes) {
                  StoreHeadChunk(cacheKey, resolved, headTotalLen, headCapture.ToArray());
                  headCapture.Dispose();
                  headCapture = null;
                }
              }
              currentPos += n;
              if (expectedRemaining > 0) expectedRemaining -= n;
            }
          }

          if (headCapture != null) {
            if (!ct.IsCancellationRequested && headCapture.Length > 0) {
              StoreHeadChunk(cacheKey, resolved, headTotalLen, headCapture.ToArray());
            }
            headCapture.Dispose();
            headCapture = null;
          }

          if (ct.IsCancellationRequested) {
            try { ctx.Response.Abort(); } catch {}
            return;
          }
          if (expectedRemaining <= 0) {
            try { ctx.Response.Close(); } catch {}
            return;
          }
          // Upstream closed early before expectedRemaining reached 0; reconnect from currentPos.
          InvalidateStreamCache(sourceUrl, normQ);
        }
      } catch (OperationCanceledException) {
        try { ctx.Response.Abort(); } catch {}
        return;
      } catch (WebException wex) {
        if (ct.IsCancellationRequested) {
          try { ctx.Response.Abort(); } catch {}
          return;
        }
        var errResp = wex.Response as HttpWebResponse;
        int status = errResp != null ? (int)errResp.StatusCode : 502;
        if (errResp != null) errResp.Close();
        if (attempt < 3 && (status == 403 || status == 410 || status == 404 || status >= 500 || wex.Status == WebExceptionStatus.Timeout || wex.Status == WebExceptionStatus.ConnectionClosed)) {
          InvalidateStreamCache(sourceUrl, normQ);
          Thread.Sleep(250);
          continue;
        }
        if (headersSent) {
          try { ctx.Response.Abort(); } catch {}
        } else {
          SendJson(ctx.Response, status, "{\"ok\":false,\"error\":\"" + EscapeJson(wex.Message) + "\"}");
        }
        return;
      } catch (IOException) {
        if (ct.IsCancellationRequested) {
          try { ctx.Response.Abort(); } catch {}
          return;
        }
        if (attempt < 3) {
          InvalidateStreamCache(sourceUrl, normQ);
          Thread.Sleep(250);
          continue;
        }
        if (headersSent) { try { ctx.Response.Abort(); } catch {} }
        else SendJson(ctx.Response, 502, "{\"ok\":false,\"error\":\"串流連線中斷\"}");
        return;
      } catch (Exception ex) {
        if (ct.IsCancellationRequested) {
          try { ctx.Response.Abort(); } catch {}
          return;
        }
        if (headersSent) {
          try { ctx.Response.Abort(); } catch {}
        } else {
          SendJson(ctx.Response, 502, "{\"ok\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}");
        }
        return;
      }
    }
  }

  [STAThread]
  static void Main() {
    SetupWebViewRuntime();
    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls12;
    ServicePointManager.DefaultConnectionLimit = 64;
    ServicePointManager.Expect100Continue = false;
    ServicePointManager.UseNagleAlgorithm = false;
    ThreadPool.SetMinThreads(32, 32);
    Dictionary<string, byte[]> assets;
    try {
      assets = LoadAssets();
    } catch (Exception ex) {
      MessageBox.Show("無法載入內嵌資源：" + ex.Message, "RhineLab Music", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return;
    }

    int port = PickPort();
    string prefix = "http://127.0.0.1:" + port + "/";
    var listener = new HttpListener();
    listener.Prefixes.Add(prefix);
    try {
      listener.Start();
    } catch (Exception ex) {
      MessageBox.Show("無法啟動本機伺服器：" + ex.Message, "RhineLab Music", MessageBoxButtons.OK, MessageBoxIcon.Error);
      return;
    }

    string browser = FindBrowser();
    string profile = Path.Combine(DataDir(), "Profile");
    Directory.CreateDirectory(profile);
    MigrateProfileToWebView2(profile);
    bool useWebViewHost = IsWebView2Available();

    Process activeBrowser = null;
    FramelessHostForm activeHostForm = null;
    bool restartRequested = false;
    bool pageConnected = false;
    bool vulkanFallbackAttempted = false;
    DateTime lastActivityUtc = DateTime.UtcNow;
    object procLock = new object();

    var running = true;
    LoadStreamCacheFromDisk();
    ThreadPool.QueueUserWorkItem(_ => { try { EnsureYtDlp(); } catch {} });
    var serverThread = new Thread(() => {
      while (running) {
        HttpListenerContext ctx;
        try {
          ctx = listener.GetContext();
        } catch {
          break;
        }
        ThreadPool.QueueUserWorkItem(_ => {
          try {
            lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
            var path = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath);

            if (path == "/__rhine/desktop" && ctx.Request.HttpMethod == "GET") {
              bool isFrameless;
              lock (procLock) {
                lastActivityUtc = DateTime.UtcNow;
                pageConnected = true;
                isFrameless = useWebViewHost;
              }
              SendJson(ctx.Response, 200, "{\"desktop\":true,\"frameless\":" + (isFrameless ? "true" : "false") + ",\"streamProxy\":true,\"gpuMode\":\"" + ReadGpuMode() + "\",\"renderBackend\":\"" + ReadRenderBackend() + "\"}");
              return;
            }

            if (path == "/__rhine/diagnostics" && ctx.Request.HttpMethod == "GET") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string[] logsCopy;
              lock (logLock) { logsCopy = recentLogs.ToArray(); }
              var serializer = new JavaScriptSerializer();
              SendJson(ctx.Response, 200, serializer.Serialize(new Dictionary<string, object> {
                { "ok", true },
                { "gpuMode", ReadGpuMode() },
                { "renderBackend", ReadRenderBackend() },
                { "logPath", LogPath() },
                { "logs", logsCopy }
              }));
              return;
            }

            if (path == "/__rhine/stream-info" && ctx.Request.HttpMethod == "GET") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string normQ = NormalizeAudioQuality(ctx.Request.QueryString["q"]);
              string videoId = ctx.Request.QueryString["v"];
              string rawUrl = ctx.Request.QueryString["url"];
              string targetUrl = null;
              if (!string.IsNullOrEmpty(videoId) && VideoIdRegex.IsMatch(videoId)) {
                targetUrl = "https://www.youtube.com/watch?v=" + videoId;
              } else {
                Uri target;
                if (IsSafeExternalUrl(rawUrl, out target)) targetUrl = target.AbsoluteUri;
              }
              if (string.IsNullOrEmpty(targetUrl)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"無效的串流位址\"}");
                return;
              }
              ResolvedStream cachedInfo = null;
              lock (ytLock) {
                streamCache.TryGetValue(normQ + "|" + targetUrl, out cachedInfo);
              }
              if (cachedInfo == null) {
                try { cachedInfo = ResolveStream(targetUrl, false, CancellationToken.None, normQ); } catch {}
              }
              if (cachedInfo == null) {
                SendJson(ctx.Response, 404, "{\"ok\":false}");
                return;
              }
              var serializer = new JavaScriptSerializer();
              SendJson(ctx.Response, 200, serializer.Serialize(new Dictionary<string, object> {
                { "ok", true },
                { "codec", cachedInfo.AudioCodec ?? "" },
                { "ext", cachedInfo.AudioExt ?? "" },
                { "bitrateKbps", Math.Round(cachedInfo.BitrateKbps) },
                { "sampleRateHz", cachedInfo.SampleRateHz },
                { "quality", normQ }
              }));
              return;
            }

            if (path == "/__rhine/heartbeat" && ctx.Request.HttpMethod == "POST") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; pageConnected = true; }
              SendJson(ctx.Response, 200, "{\"ok\":true}");
              return;
            }

            if (path == "/__rhine/window-theme" && ctx.Request.HttpMethod == "POST") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string body = ReadBody(ctx.Request);
              var m = Regex.Match(body, "\"theme\"\\s*:\\s*\"(dark|light)\"", RegexOptions.IgnoreCase);
              string theme = NormalizeTheme(m.Success ? m.Groups[1].Value : body);
              WriteTheme(theme);
              bool isDarkTheme = theme == "dark";
              int bPid = 0;
              FramelessHostForm hostRef = null;
              lock (procLock) {
                hostRef = activeHostForm;
                if (activeBrowser != null) {
                  try { if (!activeBrowser.HasExited) bPid = activeBrowser.Id; } catch {}
                }
              }
              if (hostRef != null && !hostRef.IsDisposed) {
                try { hostRef.BeginInvoke(new Action(() => hostRef.ApplyTheme(isDarkTheme))); } catch {}
              }
              ThreadPool.QueueUserWorkItem(__ => {
                SyncBrowserProfileTheme(profile, isDarkTheme);
                ApplyWindowThemeToBrowser(isDarkTheme, bPid);
              });
              SendJson(ctx.Response, 200, "{\"ok\":true,\"theme\":\"" + theme + "\"}");
              return;
            }

            if (path == "/__rhine/window-control" && ctx.Request.HttpMethod == "POST") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string body = ReadBody(ctx.Request);
              var m = Regex.Match(body, "\"action\"\\s*:\\s*\"(minimize|maximize|toggle-maximize|close|drag)\"", RegexOptions.IgnoreCase);
              string act = m.Success ? m.Groups[1].Value : body;
              FramelessHostForm hostRef = null;
              lock (procLock) { hostRef = activeHostForm; }
              if (hostRef != null && !hostRef.IsDisposed) {
                try { hostRef.BeginInvoke(new Action(() => hostRef.HandleWindowCommand(act))); } catch {}
              }
              SendJson(ctx.Response, 200, "{\"ok\":true}");
              return;
            }

            if (path == "/__rhine/gpu-mode" && ctx.Request.HttpMethod == "POST") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string body = ReadBody(ctx.Request);
              var m = Regex.Match(body, "\"mode\"\\s*:\\s*\"(auto|high|low)\"", RegexOptions.IgnoreCase);
              string mode = NormalizeGpuMode(m.Success ? m.Groups[1].Value : body);
              WriteGpuMode(mode);
              SendJson(ctx.Response, 200, "{\"ok\":true,\"gpuMode\":\"" + mode + "\",\"restartRequired\":true}");
              return;
            }

            if (path == "/__rhine/render-backend" && ctx.Request.HttpMethod == "POST") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string body = ReadBody(ctx.Request);
              var m = Regex.Match(body, "\"backend\"\\s*:\\s*\"(vulkan|auto|d3d11|gl)\"", RegexOptions.IgnoreCase);
              string backend = NormalizeRenderBackend(m.Success ? m.Groups[1].Value : body);
              WriteRenderBackend(backend);
              SendJson(ctx.Response, 200, "{\"ok\":true,\"renderBackend\":\"" + backend + "\",\"restartRequired\":true}");
              return;
            }

            if (path == "/__rhine/stream-abort" && ctx.Request.HttpMethod == "POST") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string sid = ctx.Request.QueryString["sid"];
              AbortActiveStreams(!string.IsNullOrEmpty(sid) ? ("sid:" + sid) : null);
              SendJson(ctx.Response, 200, "{\"ok\":true}");
              return;
            }

            if (path == "/__rhine/restart" && ctx.Request.HttpMethod == "POST") {
              SendJson(ctx.Response, 200, "{\"ok\":true}");
              ThreadPool.QueueUserWorkItem(__ => {
                Thread.Sleep(250);
                lock (procLock) {
                  restartRequested = true;
                  lastActivityUtc = DateTime.UtcNow;
                  try {
                    if (activeHostForm != null && !activeHostForm.IsDisposed) {
                      var hf = activeHostForm;
                      hf.BeginInvoke(new Action(() => { try { hf.Close(); } catch {} }));
                    }
                    if (activeBrowser != null && !activeBrowser.HasExited) {
                      activeBrowser.CloseMainWindow();
                      if (!activeBrowser.WaitForExit(1500)) {
                        activeBrowser.Kill();
                      }
                    }
                  } catch {}
                }
              });
              return;
            }

            if (path == "/__rhine/resolve" && ctx.Request.HttpMethod == "GET") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string rawUrl = ctx.Request.QueryString["url"];
              Uri target;
              if (!IsSafeExternalUrl(rawUrl, out target)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"僅支援公開的 HTTP/HTTPS 串流網址\"}");
                return;
              }
              try {
                ResolvedStream resolved = ResolveStream(target.AbsoluteUri, false, CancellationToken.None, "auto", true);
                var serializer = new JavaScriptSerializer();
                SendJson(ctx.Response, 200, serializer.Serialize(new Dictionary<string, object> {
                  { "ok", true },
                  { "title", resolved.Title },
                  { "artist", resolved.Artist },
                  { "album", resolved.Album },
                  { "artwork", resolved.Artwork },
                  { "duration", resolved.Duration },
                  { "webpageUrl", resolved.WebpageUrl },
                  { "extractor", resolved.Extractor },
                  { "isLive", resolved.IsLive }
                }));
              } catch (Exception ex) {
                SendJson(ctx.Response, 502, "{\"ok\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}");
              }
              return;
            }

            if (path == "/__rhine/resolve-playlist" && ctx.Request.HttpMethod == "GET") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string rawUrl = ctx.Request.QueryString["url"];
              Uri target;
              if (!IsSafeExternalUrl(rawUrl, out target)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"僅支援公開的 HTTP/HTTPS 播放清單網址\"}");
                return;
              }
              try {
                string stdout, stderr;
                int code = RunYtDlp(new[] {
                  "--flat-playlist",
                  "--no-warnings",
                  "--no-progress",
                  "--dump-single-json",
                  "--", target.AbsoluteUri
                }, 35000, out stdout, out stderr);
                if (code != 0 || string.IsNullOrWhiteSpace(stdout)) {
                  throw new Exception(!string.IsNullOrWhiteSpace(stderr) ? stderr.Trim() : "無法解析播放清單");
                }
                var serializer = new JavaScriptSerializer();
                serializer.MaxJsonLength = 32 * 1024 * 1024;
                var root = serializer.DeserializeObject(stdout) as Dictionary<string, object>;
                string listTitle = root != null && root.ContainsKey("title") ? (Convert.ToString(root["title"]) ?? "") : "";
                var entries = root != null && root.ContainsKey("entries") ? root["entries"] as object[] : null;
                var tracks = new List<Dictionary<string, object>>();
                if (entries != null) {
                  foreach (var item in entries) {
                    var e = item as Dictionary<string, object>;
                    if (e == null) continue;
                    string entryUrl = e.ContainsKey("webpage_url") ? Convert.ToString(e["webpage_url"]) : null;
                    if (string.IsNullOrEmpty(entryUrl) && e.ContainsKey("url")) entryUrl = Convert.ToString(e["url"]);
                    string entryId = e.ContainsKey("id") ? Convert.ToString(e["id"]) : null;
                    string entryTitle = e.ContainsKey("title") ? Convert.ToString(e["title"]) : null;
                    if (string.IsNullOrEmpty(entryUrl) || string.IsNullOrEmpty(entryTitle)) continue;
                    if (entryTitle == "[Deleted video]" || entryTitle == "[Private video]") continue;
                    string entryArtist = "";
                    if (e.ContainsKey("uploader") && e["uploader"] != null) entryArtist = Convert.ToString(e["uploader"]);
                    else if (e.ContainsKey("channel") && e["channel"] != null) entryArtist = Convert.ToString(e["channel"]);
                    string entryThumb = e.ContainsKey("thumbnail") ? (Convert.ToString(e["thumbnail"]) ?? "") : "";
                    if (string.IsNullOrEmpty(entryThumb) && e.ContainsKey("thumbnails")) {
                      var thumbs = e["thumbnails"] as object[];
                      if (thumbs != null && thumbs.Length > 0) {
                        var lastThumb = thumbs[thumbs.Length - 1] as Dictionary<string, object>;
                        if (lastThumb != null && lastThumb.ContainsKey("url")) entryThumb = Convert.ToString(lastThumb["url"]) ?? "";
                      }
                    }
                    double entryDur = 0;
                    if (e.ContainsKey("duration") && e["duration"] != null) {
                      try { entryDur = Convert.ToDouble(e["duration"]); } catch {}
                    }
                    tracks.Add(new Dictionary<string, object> {
                      { "id", entryId ?? entryUrl },
                      { "title", entryTitle },
                      { "artist", entryArtist ?? "" },
                      { "artwork", entryThumb },
                      { "duration", entryDur },
                      { "url", entryUrl }
                    });
                  }
                }
                SendJson(ctx.Response, 200, serializer.Serialize(new Dictionary<string, object> {
                  { "ok", true },
                  { "name", listTitle },
                  { "tracks", tracks }
                }));
              } catch (Exception ex) {
                SendJson(ctx.Response, 502, "{\"ok\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}");
              }
              return;
            }

            if (path == "/__rhine/stream" && (ctx.Request.HttpMethod == "GET" || ctx.Request.HttpMethod == "HEAD")) {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string rawUrl = ctx.Request.QueryString["url"];
              Uri target;
              if (!IsSafeExternalUrl(rawUrl, out target)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"僅支援公開的 HTTP/HTTPS 串流網址\"}");
                return;
              }
              ProxyStream(ctx, target.AbsoluteUri, ctx.Request.QueryString["sid"], ctx.Request.QueryString["q"]);
              return;
            }

            if (path == "/__rhine/yt-audio" && (ctx.Request.HttpMethod == "GET" || ctx.Request.HttpMethod == "HEAD")) {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string videoId = ctx.Request.QueryString["v"];
              if (string.IsNullOrEmpty(videoId) || !VideoIdRegex.IsMatch(videoId)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"無效的 YouTube 影片代碼\"}");
                return;
              }
              ProxyStream(ctx, "https://www.youtube.com/watch?v=" + videoId, ctx.Request.QueryString["sid"], ctx.Request.QueryString["q"]);
              return;
            }

            if (path == "/__rhine/yt-prewarm" && (ctx.Request.HttpMethod == "GET" || ctx.Request.HttpMethod == "POST")) {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string videoId = ctx.Request.QueryString["v"];
              if (string.IsNullOrEmpty(videoId) || !VideoIdRegex.IsMatch(videoId)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"無效的 YouTube 影片代碼\"}");
                return;
              }
              string targetUrl = "https://www.youtube.com/watch?v=" + videoId;
              string normQ = NormalizeAudioQuality(ctx.Request.QueryString["q"]);
              EnqueuePrewarm(targetUrl, normQ);
              SendJson(ctx.Response, 200, "{\"ok\":true}");
              return;
            }

            if (path == "/__rhine/stream-prewarm" && (ctx.Request.HttpMethod == "GET" || ctx.Request.HttpMethod == "POST")) {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string rawUrl = ctx.Request.QueryString["url"];
              Uri target;
              if (!IsSafeExternalUrl(rawUrl, out target)) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"僅支援公開的 HTTP/HTTPS 串流網址\"}");
                return;
              }
              string targetUrl = target.AbsoluteUri;
              string normQ = NormalizeAudioQuality(ctx.Request.QueryString["q"]);
              EnqueuePrewarm(targetUrl, normQ);
              SendJson(ctx.Response, 200, "{\"ok\":true}");
              return;
            }

            if (path == "/__rhine/fetch-public" && ctx.Request.HttpMethod == "GET") {
              lock (procLock) { lastActivityUtc = DateTime.UtcNow; }
              string rawUrl = ctx.Request.QueryString["url"];
              Uri target;
              if (string.IsNullOrEmpty(rawUrl) || !Uri.TryCreate(rawUrl, UriKind.Absolute, out target) ||
                  target.Scheme != "https" ||
                  !(target.Host.Equals("www.youtube.com", StringComparison.OrdinalIgnoreCase) ||
                    target.Host.Equals("youtube.com", StringComparison.OrdinalIgnoreCase) ||
                    target.Host.Equals("m.youtube.com", StringComparison.OrdinalIgnoreCase) ||
                    target.Host.Equals("music.youtube.com", StringComparison.OrdinalIgnoreCase))) {
                SendJson(ctx.Response, 400, "{\"ok\":false,\"error\":\"僅允許擷取公開 YouTube 頁面\"}");
                return;
              }
              var req = (HttpWebRequest)WebRequest.Create(target);
              req.Method = "GET";
              req.Timeout = 15000;
              req.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
              req.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
              req.Headers["Accept-Language"] = "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7";
              if (target.Host.EndsWith("youtube.com", StringComparison.OrdinalIgnoreCase)) {
                req.Headers["Cookie"] = "SOCS=CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg; CONSENT=YES+cb";
              }
              try {
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var rs = resp.GetResponseStream())
                using (var ms = new MemoryStream()) {
                  rs.CopyTo(ms);
                  byte[] bytes = ms.ToArray();
                  ctx.Response.StatusCode = (int)resp.StatusCode;
                  ctx.Response.ContentType = string.IsNullOrEmpty(resp.ContentType) ? "text/html; charset=utf-8" : resp.ContentType;
                  ctx.Response.Headers["Cache-Control"] = "no-store";
                  ctx.Response.ContentLength64 = bytes.Length;
                  ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
                  ctx.Response.Close();
                }
              } catch (WebException wex) {
                int code = 502;
                using (var errResp = wex.Response as HttpWebResponse) {
                  if (errResp != null) code = (int)errResp.StatusCode;
                }
                SendJson(ctx.Response, code, "{\"ok\":false,\"error\":\"" + EscapeJson(wex.Message) + "\"}");
              }
              return;
            }

            if (path == "/sw.js" && ctx.Request.HttpMethod == "GET") {
              byte[] swBytes = Encoding.UTF8.GetBytes(
                "self.addEventListener('install',()=>self.skipWaiting());" +
                "self.addEventListener('activate',e=>e.waitUntil((async()=>{" +
                "try{const ks=await caches.keys();await Promise.all(ks.map(k=>caches.delete(k)));" +
                "await self.registration.unregister();}catch{}" +
                "})()));"
              );
              ctx.Response.StatusCode = 200;
              ctx.Response.ContentType = "application/javascript; charset=utf-8";
              ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
              ctx.Response.Headers["Pragma"] = "no-cache";
              ctx.Response.ContentLength64 = swBytes.Length;
              ctx.Response.OutputStream.Write(swBytes, 0, swBytes.Length);
              ctx.Response.Close();
              return;
            }

            if (path == "/") path = "/index.html";
            byte[] data;
            if (!assets.TryGetValue(path, out data)) {
              if (!Path.HasExtension(path) && assets.TryGetValue("/index.html", out data)) {
                path = "/index.html";
              } else {
                ctx.Response.StatusCode = 404;
                ctx.Response.Close();
                return;
              }
            }
            string ext = Path.GetExtension(path);
            string mime;
            ctx.Response.ContentType = MimeTypes.TryGetValue(ext, out mime) ? mime : "application/octet-stream";
            ctx.Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
            ctx.Response.Headers["Pragma"] = "no-cache";
            ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
            ctx.Response.ContentLength64 = data.Length;
            ctx.Response.OutputStream.Write(data, 0, data.Length);
            ctx.Response.Close();
          } catch {
            try { ctx.Response.Abort(); } catch {}
          }
        });
      }
    }) { IsBackground = true };
    serverThread.Start();

    if (useWebViewHost || browser != null) {
      bool disableGpuCompositingFallback = false;
      bool watchdogFallbackTriggered = false;
      LogEvent("INFO", "Desktop launcher started. port=" + port + " host=" + (useWebViewHost ? "webview2-frameless" : Path.GetFileName(browser)));
      while (true) {
        string mode = ReadGpuMode();
        string backend = ReadRenderBackend();
        DateTime launchUtc = DateTime.UtcNow;
        lock (procLock) {
          lastActivityUtc = launchUtc;
          restartRequested = false;
          pageConnected = false;
        }
        bool launchDark = ReadTheme() == "dark";
        bool watchdogKilled = false;
        bool earlyVulkanExit = false;
        bool webViewInitFailed = false;
        var watchdogCancel = new CancellationTokenSource();

        if (useWebViewHost) {
          string wvArgs = "--autoplay-policy=no-user-gesture-required --disable-background-mode --disable-domain-reliability" +
            (disableGpuCompositingFallback ? " --disable-gpu-compositing" : "") +
            GpuFlag(mode) + RenderBackendFlag(backend);
          LogEvent("INFO", "Launching frameless WebView2 gpuMode=" + mode + " backend=" + backend + (disableGpuCompositingFallback ? " fallback=no-gpu-compositing" : ""));
          FramelessHostForm form = null;
          form = new FramelessHostForm(prefix, profile, wvArgs, launchDark, errMsg => {
            LogEvent("WARN", "WebView2 init failed, falling back: " + errMsg);
            webViewInitFailed = true;
            try { if (form != null && !form.IsDisposed) form.Close(); } catch {}
          });
          lock (procLock) { activeHostForm = form; }
          if (!watchdogFallbackTriggered) {
            var wc = watchdogCancel.Token;
            ThreadPool.QueueUserWorkItem(__ => {
              if (wc.WaitHandle.WaitOne(14000)) return;
              bool connected;
              bool restarting;
              lock (procLock) {
                connected = pageConnected;
                restarting = restartRequested;
              }
              if (!connected && !restarting && form != null && !form.IsDisposed) {
                watchdogKilled = true;
                LogEvent("WARN", "Startup watchdog triggered after 14s without page heartbeat (webview2 gpuMode=" + mode + ", backend=" + backend + ").");
                try { form.BeginInvoke(new Action(() => { try { form.Close(); } catch {} })); } catch {}
              }
            });
          }
          Application.Run(form);
          watchdogCancel.Cancel();
          lock (procLock) { activeHostForm = null; }
          if (webViewInitFailed) {
            useWebViewHost = false;
            if (browser != null) continue;
            break;
          }
        } else {
          foreach (string lockName in new[] { "SingletonLock", "SingletonSocket", "SingletonCookie" }) {
            try {
              string lockFile = Path.Combine(profile, lockName);
              if (File.Exists(lockFile)) File.Delete(lockFile);
            } catch {}
          }
          string extraFlags = " --disable-background-mode --disable-domain-reliability --disable-features=msEdgeFirstRunExperience";
          if (disableGpuCompositingFallback) extraFlags += " --disable-gpu-compositing";
          SyncBrowserProfileTheme(profile, launchDark);
          LogEvent("INFO", "Launching browser gpuMode=" + mode + " backend=" + backend + (disableGpuCompositingFallback ? " fallback=no-gpu-compositing" : ""));
          Process proc = Process.Start(new ProcessStartInfo {
            FileName = browser,
            Arguments = "--app=\"" + prefix + "\" --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check" + extraFlags + GpuFlag(mode) + RenderBackendFlag(backend),
            UseShellExecute = false
          });
          lock (procLock) {
            activeBrowser = proc;
          }
          if (proc != null) {
            int launchPid = proc.Id;
            bool initDark = launchDark;
            ThreadPool.QueueUserWorkItem(__ => {
              for (int i = 0; i < 30; i++) {
                try { if (proc.HasExited) return; } catch { return; }
                if (ApplyWindowThemeToBrowser(initDark, launchPid)) {
                  Thread.Sleep(400);
                  ApplyWindowThemeToBrowser(initDark, launchPid);
                  return;
                }
                Thread.Sleep(200);
              }
            });
          }
          if (proc != null && !watchdogFallbackTriggered) {
            var wc = watchdogCancel.Token;
            ThreadPool.QueueUserWorkItem(__ => {
              if (wc.WaitHandle.WaitOne(14000)) return;
              bool connected;
              bool restarting;
              lock (procLock) {
                connected = pageConnected;
                restarting = restartRequested;
              }
              if (!connected && !restarting && !proc.HasExited) {
                watchdogKilled = true;
                LogEvent("WARN", "Startup watchdog triggered after 14s without page heartbeat (gpuMode=" + mode + ", backend=" + backend + ").");
                try { proc.Kill(); } catch {}
              }
            });
          }
          if (proc != null) proc.WaitForExit();
          watchdogCancel.Cancel();
        }

        bool doRestart = false;
        lock (procLock) {
          activeBrowser = null;
          activeHostForm = null;
          if (!restartRequested && !pageConnected && backend == "vulkan" && !vulkanFallbackAttempted && (DateTime.UtcNow - launchUtc).TotalSeconds < 8.0) {
            vulkanFallbackAttempted = true;
            earlyVulkanExit = true;
            WriteRenderBackend("auto");
            LogEvent("WARN", "Vulkan backend exited early; falling back to auto.");
          } else if (watchdogKilled && !watchdogFallbackTriggered) {
            watchdogFallbackTriggered = true;
            if (backend != "auto") {
              WriteRenderBackend("auto");
            } else if (!disableGpuCompositingFallback) {
              disableGpuCompositingFallback = true;
            }
            earlyVulkanExit = true;
            LogEvent("WARN", "Relaunching with safe GPU fallback.");
          }
        }
        if (earlyVulkanExit) {
          Thread.Sleep(200);
          continue;
        }
        if (!restartRequested && useWebViewHost) {
          // User closed the native host window directly.
          break;
        }
        while (true) {
          double idleSeconds;
          lock (procLock) {
            if (restartRequested) {
              doRestart = true;
              break;
            }
            idleSeconds = (DateTime.UtcNow - lastActivityUtc).TotalSeconds;
          }
          if (idleSeconds >= 10.0) break;
          Thread.Sleep(500);
        }
        if (!doRestart) break;
        Thread.Sleep(200);
      }
    } else {
      Process.Start(new ProcessStartInfo { FileName = prefix, UseShellExecute = true });
      MessageBox.Show("RhineLab Music 已在瀏覽器開啟。\n按「確定」可關閉本機伺服器。", "RhineLab Music", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    running = false;
    try { listener.Stop(); } catch {}
  }
}
