using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class InstallerProgram {
  const string AppName = "RhineLab Music";
  const string AppVersion = "1.0.0";
  const string ExeName = "RhineLab-Music.exe";
  const string UninstName = "Uninstall-RhineLab-Music.exe";
  const string UninstallRegSubKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\RhineLabMusic";
  const string PayloadResourceName = "RhineLabMusic.payload.zip";
  const string WebView2ClientGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

  [STAThread]
  static int Main(string[] args) {
    bool silent = false;
    bool uninstall = false;
    bool noLaunch = false;
    bool noShortcuts = false;
    bool noReg = false;
    string targetDir = "";

    for (int i = 0; i < args.Length; i++) {
      string a = (args[i] ?? "").Trim();
      if (string.Equals(a, "/S", StringComparison.OrdinalIgnoreCase) ||
          string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase)) {
        silent = true;
      } else if (string.Equals(a, "--uninstall", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a, "/uninstall", StringComparison.OrdinalIgnoreCase)) {
        uninstall = true;
      } else if (string.Equals(a, "--no-launch", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a, "/NO-LAUNCH", StringComparison.OrdinalIgnoreCase)) {
        noLaunch = true;
      } else if (string.Equals(a, "--no-shortcuts", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a, "/NO-SHORTCUTS", StringComparison.OrdinalIgnoreCase)) {
        noShortcuts = true;
      } else if (string.Equals(a, "--no-reg", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a, "/NO-REG", StringComparison.OrdinalIgnoreCase)) {
        noReg = true;
      } else if (a.StartsWith("/D=", StringComparison.OrdinalIgnoreCase)) {
        targetDir = a.Substring(3).Trim().Trim('"');
      } else if (a.StartsWith("--dir=", StringComparison.OrdinalIgnoreCase)) {
        targetDir = a.Substring(6).Trim().Trim('"');
      }
    }

    if (uninstall) {
      return RunUninstall(targetDir, silent, noShortcuts, noReg);
    }

    if (silent) {
      string installDir = string.IsNullOrEmpty(targetDir) ? DefaultInstallDir() : Path.GetFullPath(targetDir);
      try {
        PerformInstall(installDir, !noShortcuts, !noShortcuts, !noLaunch, !noReg, null);
        return 0;
      } catch (Exception ex) {
        Console.Error.WriteLine(ex.ToString());
        return 1;
      }
    }

    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    string initialDir = string.IsNullOrEmpty(targetDir) ? DefaultInstallDir() : Path.GetFullPath(targetDir);
    using (var form = new InstallerForm(initialDir)) {
      Application.Run(form);
      return form.Succeeded ? 0 : 1;
    }
  }

  public static string DefaultInstallDir() {
    string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    return Path.Combine(Path.Combine(localAppData, "Programs"), AppName);
  }

  public static string DetectWebView2Version() {
    string[] regPaths = new[] {
      @"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\" + WebView2ClientGuid,
      @"SOFTWARE\Microsoft\EdgeUpdate\Clients\" + WebView2ClientGuid
    };
    RegistryKey[] roots = new[] { Registry.LocalMachine, Registry.CurrentUser };
    for (int r = 0; r < roots.Length; r++) {
      for (int p = 0; p < regPaths.Length; p++) {
        try {
          using (RegistryKey key = roots[r].OpenSubKey(regPaths[p])) {
            if (key != null) {
              object pv = key.GetValue("pv");
              if (pv != null) {
                string ver = pv.ToString().Trim();
                if (!string.IsNullOrEmpty(ver) && ver != "0.0.0.0") return ver;
              }
            }
          }
        } catch {}
      }
    }
    return null;
  }

  static void StopRunningApp(string installDir) {
    string normDir = Path.GetFullPath(installDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
    Process[] procs = Process.GetProcessesByName("RhineLab-Music");
    for (int i = 0; i < procs.Length; i++) {
      Process proc = procs[i];
      try {
        bool match = false;
        try {
          string file = proc.MainModule != null ? proc.MainModule.FileName : "";
          if (!string.IsNullOrEmpty(file) && file.StartsWith(normDir, StringComparison.OrdinalIgnoreCase)) {
            match = true;
          }
        } catch {
          match = true;
        }
        if (match) {
          try { proc.CloseMainWindow(); } catch {}
          if (!proc.WaitForExit(2500)) {
            proc.Kill();
            proc.WaitForExit(3000);
          }
        }
      } catch {} finally {
        try { proc.Dispose(); } catch {}
      }
    }
  }

  static string DesktopShortcutPath() {
    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
  }

  static string StartMenuFolderPath() {
    return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
  }

  static void CreateShortcut(string shortcutPath, string targetExe, string workingDir, string arguments, string description) {
    string dir = Path.GetDirectoryName(shortcutPath);
    if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
    if (shellType == null) return;
    object shell = null;
    object shortcut = null;
    try {
      shell = Activator.CreateInstance(shellType);
      shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
      Type scType = shortcut.GetType();
      scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
      scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
      scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetExe + ",0" });
      if (!string.IsNullOrEmpty(arguments)) {
        scType.InvokeMember("Arguments", BindingFlags.SetProperty, null, shortcut, new object[] { arguments });
      }
      if (!string.IsNullOrEmpty(description)) {
        scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
      }
      scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
    } finally {
      if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
      if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
    }
  }

  static long DirSizeBytes(string dir) {
    long total = 0;
    try {
      string[] files = Directory.GetFiles(dir, "*", SearchOption.AllDirectories);
      for (int i = 0; i < files.Length; i++) {
        try { total += new FileInfo(files[i]).Length; } catch {}
      }
    } catch {}
    return total;
  }

  public static void PerformInstall(
    string installDir,
    bool createDesktopShortcut,
    bool createStartMenuShortcut,
    bool launchAfter,
    bool writeRegistry,
    Action<int, string> onProgress
  ) {
    Action<int, string> report = (pct, text) => {
      if (onProgress != null) onProgress(pct, text);
    };

    report(8, "檢查目前執行中的程式…");
    string fullDir = Path.GetFullPath(installDir);
    Directory.CreateDirectory(fullDir);
    StopRunningApp(fullDir);

    report(20, "正在解壓縮應用程式檔案…");
    Assembly asm = Assembly.GetExecutingAssembly();
    using (Stream resStream = asm.GetManifestResourceStream(PayloadResourceName)) {
      if (resStream == null) {
        throw new InvalidOperationException("找不到內嵌安裝封裝資源：" + PayloadResourceName);
      }
      using (var archive = new ZipArchive(resStream, ZipArchiveMode.Read)) {
        int count = Math.Max(1, archive.Entries.Count);
        for (int i = 0; i < archive.Entries.Count; i++) {
          ZipArchiveEntry entry = archive.Entries[i];
          string rel = entry.FullName.Replace('/', Path.DirectorySeparatorChar);
          string dest = Path.GetFullPath(Path.Combine(fullDir, rel));
          string rootCheck = fullDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
          if (!dest.StartsWith(rootCheck, StringComparison.OrdinalIgnoreCase)) continue;
          if (string.IsNullOrEmpty(entry.Name)) {
            Directory.CreateDirectory(dest);
            continue;
          }
          string parent = Path.GetDirectoryName(dest);
          if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
          using (Stream entryStream = entry.Open())
          using (var outFile = new FileStream(dest, FileMode.Create, FileAccess.Write, FileShare.None)) {
            entryStream.CopyTo(outFile);
          }
          try {
            File.SetLastWriteTimeUtc(dest, entry.LastWriteTime.UtcDateTime);
          } catch {}
          int pct = 20 + (int)Math.Round(55.0 * (i + 1) / count);
          report(pct, "寫入 " + entry.Name);
        }
      }
    }

    report(80, "建立解除安裝工具…");
    string targetExe = Path.Combine(fullDir, ExeName);
    string uninstPath = Path.Combine(fullDir, UninstName);
    string currentSetupExe = Process.GetCurrentProcess().MainModule != null
      ? Process.GetCurrentProcess().MainModule.FileName
      : asm.Location;
    if (!string.IsNullOrEmpty(currentSetupExe) &&
        File.Exists(currentSetupExe) &&
        !string.Equals(Path.GetFullPath(currentSetupExe), Path.GetFullPath(uninstPath), StringComparison.OrdinalIgnoreCase)) {
      File.Copy(currentSetupExe, uninstPath, true);
    }

    report(88, "建立捷徑…");
    if (createDesktopShortcut) {
      CreateShortcut(DesktopShortcutPath(), targetExe, fullDir, "", AppName);
    }
    if (createStartMenuShortcut) {
      string smDir = StartMenuFolderPath();
      CreateShortcut(Path.Combine(smDir, AppName + ".lnk"), targetExe, fullDir, "", AppName);
      CreateShortcut(Path.Combine(smDir, "解除安裝 " + AppName + ".lnk"), uninstPath, fullDir, "--uninstall", "解除安裝 " + AppName);
    }

    if (writeRegistry) {
      report(94, "登錄 Windows 應用程式資訊…");
      using (RegistryKey reg = Registry.CurrentUser.CreateSubKey(UninstallRegSubKey)) {
        if (reg != null) {
          int sizeKb = (int)Math.Max(1024, DirSizeBytes(fullDir) / 1024);
          reg.SetValue("DisplayName", AppName, RegistryValueKind.String);
          reg.SetValue("DisplayVersion", AppVersion, RegistryValueKind.String);
          reg.SetValue("Publisher", AppName, RegistryValueKind.String);
          reg.SetValue("InstallLocation", fullDir, RegistryValueKind.String);
          reg.SetValue("DisplayIcon", targetExe + ",0", RegistryValueKind.String);
          reg.SetValue("UninstallString", "\"" + uninstPath + "\" --uninstall", RegistryValueKind.String);
          reg.SetValue("EstimatedSize", sizeKb, RegistryValueKind.DWord);
          reg.SetValue("NoModify", 1, RegistryValueKind.DWord);
          reg.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
      }
    }

    report(100, "安裝完成！");
    if (launchAfter && File.Exists(targetExe)) {
      Process.Start(new ProcessStartInfo {
        FileName = targetExe,
        WorkingDirectory = fullDir,
        UseShellExecute = true
      });
    }
  }

  static int RunUninstall(string targetDir, bool silent, bool noShortcuts, bool noReg) {
    string installDir = targetDir;
    if (string.IsNullOrEmpty(installDir)) {
      try {
        using (RegistryKey reg = Registry.CurrentUser.OpenSubKey(UninstallRegSubKey)) {
          if (reg != null) {
            object loc = reg.GetValue("InstallLocation");
            if (loc != null) installDir = loc.ToString();
          }
        }
      } catch {}
    }
    if (string.IsNullOrEmpty(installDir)) {
      installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    }
    installDir = Path.GetFullPath(installDir);

    if (!silent) {
      DialogResult confirm = MessageBox.Show(
        "確定要移除 " + AppName + " 嗎？\n\n安裝位置：" + installDir + "\n（您的個人歌單與設定將會安全保留）",
        "解除安裝 " + AppName,
        MessageBoxButtons.YesNo,
        MessageBoxIcon.Question
      );
      if (confirm != DialogResult.Yes) return 0;
    }

    try {
      StopRunningApp(installDir);
      if (!noShortcuts) {
        try {
          string ds = DesktopShortcutPath();
          if (File.Exists(ds)) File.Delete(ds);
        } catch {}
        try {
          string sm = StartMenuFolderPath();
          if (Directory.Exists(sm)) Directory.Delete(sm, true);
        } catch {}
      }
      if (!noReg) {
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallRegSubKey, false); } catch {}
      }

      string currentExe = Process.GetCurrentProcess().MainModule != null
        ? Path.GetFullPath(Process.GetCurrentProcess().MainModule.FileName)
        : "";
      string normDir = installDir.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
      bool runningInsideTarget = !string.IsNullOrEmpty(currentExe) &&
        currentExe.StartsWith(normDir, StringComparison.OrdinalIgnoreCase);

      if (Directory.Exists(installDir)) {
        if (runningInsideTarget) {
          foreach (string file in Directory.GetFiles(installDir)) {
            if (string.Equals(Path.GetFullPath(file), currentExe, StringComparison.OrdinalIgnoreCase)) continue;
            try { File.Delete(file); } catch {}
          }
          Process.Start(new ProcessStartInfo {
            FileName = "cmd.exe",
            Arguments = "/c ping -n 2 127.0.0.1 >nul & rmdir /s /q \"" + installDir + "\"",
            CreateNoWindow = true,
            UseShellExecute = false
          });
        } else {
          Directory.Delete(installDir, true);
        }
      }

      if (!silent) {
        MessageBox.Show(AppName + " 已解除安裝完成。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Information);
      }
      return 0;
    } catch (Exception ex) {
      if (!silent) {
        MessageBox.Show("解除安裝過程發生錯誤：" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
      } else {
        Console.Error.WriteLine(ex.ToString());
      }
      return 1;
    }
  }

  sealed class InstallerForm : Form {
    TextBox pathBox;
    Button browseBtn;
    CheckBox desktopCheck;
    CheckBox startMenuCheck;
    CheckBox launchCheck;
    ProgressBar progressBar;
    Label statusLabel;
    Button installBtn;
    Button closeBtn;
    public bool Succeeded;

    public InstallerForm(string initialDir) {
      Text = AppName + " v" + AppVersion + " 安裝精靈";
      ClientSize = new Size(560, 410);
      FormBorderStyle = FormBorderStyle.FixedDialog;
      MaximizeBox = false;
      StartPosition = FormStartPosition.CenterScreen;
      BackColor = Color.FromArgb(21, 24, 24);
      ForeColor = Color.FromArgb(242, 238, 228);
      Font = new Font("Microsoft JhengHei UI", 9.5f, FontStyle.Regular);
      try {
        Icon appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (appIcon != null) Icon = appIcon;
      } catch {}

      Color panelBg = Color.FromArgb(30, 34, 34);
      Color borderCol = Color.FromArgb(56, 62, 60);
      Color accent = Color.FromArgb(217, 138, 78);
      Color muted = Color.FromArgb(164, 170, 166);

      var kicker = new Label {
        Text = "RHINE LAB // DESKTOP INSTALLER",
        Location = new Point(28, 22),
        AutoSize = true,
        ForeColor = accent,
        Font = new Font("Consolas", 8.5f, FontStyle.Bold)
      };
      var title = new Label {
        Text = AppName + " v" + AppVersion,
        Location = new Point(26, 44),
        AutoSize = true,
        Font = new Font("Microsoft JhengHei UI", 16f, FontStyle.Bold),
        ForeColor = ForeColor
      };
      var subtitle = new Label {
        Text = "Windows 64 位元獨立桌面音訊終端 · 離線封裝完整資源與 yt-dlp 核心",
        Location = new Point(28, 78),
        AutoSize = true,
        ForeColor = muted,
        Font = new Font("Microsoft JhengHei UI", 8.8f)
      };

      string wv2 = DetectWebView2Version();
      var wvPanel = new Panel {
        Location = new Point(28, 108),
        Size = new Size(504, 34),
        BackColor = panelBg
      };
      wvPanel.Paint += (s, e) => {
        using (var pen = new Pen(borderCol)) e.Graphics.DrawRectangle(pen, 0, 0, wvPanel.Width - 1, wvPanel.Height - 1);
      };
      if (!string.IsNullOrEmpty(wv2)) {
        wvPanel.Controls.Add(new Label {
          Text = "✓ WebView2 Runtime 已就緒（版本 " + wv2 + "）",
          Location = new Point(12, 8),
          AutoSize = true,
          ForeColor = Color.FromArgb(132, 204, 152),
          Font = new Font("Microsoft JhengHei UI", 8.8f)
        });
      } else {
        wvPanel.Controls.Add(new Label {
          Text = "⚠ 尚未偵測到 WebView2 Runtime：",
          Location = new Point(12, 8),
          AutoSize = true,
          ForeColor = Color.FromArgb(240, 184, 102),
          Font = new Font("Microsoft JhengHei UI", 8.8f)
        });
        var link = new LinkLabel {
          Text = "點此取得官方執行環境",
          Location = new Point(225, 8),
          AutoSize = true,
          LinkColor = accent,
          ActiveLinkColor = Color.White,
          Font = new Font("Microsoft JhengHei UI", 8.8f)
        };
        link.LinkClicked += (s, e) => {
          try {
            Process.Start(new ProcessStartInfo {
              FileName = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/",
              UseShellExecute = true
            });
          } catch {}
        };
        wvPanel.Controls.Add(link);
      }

      var dirLabel = new Label {
        Text = "安裝目標資料夾：",
        Location = new Point(28, 158),
        AutoSize = true,
        ForeColor = ForeColor
      };
      pathBox = new TextBox {
        Text = initialDir,
        Location = new Point(28, 184),
        Size = new Size(412, 26),
        BackColor = panelBg,
        ForeColor = ForeColor,
        BorderStyle = BorderStyle.FixedSingle
      };
      browseBtn = new Button {
        Text = "瀏覽…",
        Location = new Point(448, 182),
        Size = new Size(84, 28),
        FlatStyle = FlatStyle.Flat,
        BackColor = panelBg,
        ForeColor = ForeColor
      };
      browseBtn.FlatAppearance.BorderColor = borderCol;
      browseBtn.Click += (s, e) => {
        using (var dlg = new FolderBrowserDialog()) {
          dlg.Description = "選擇 " + AppName + " 安裝資料夾";
          dlg.SelectedPath = pathBox.Text;
          if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath)) {
            string chosen = dlg.SelectedPath;
            string leaf = Path.GetFileName(chosen.TrimEnd(Path.DirectorySeparatorChar));
            if (!string.Equals(leaf, AppName, StringComparison.OrdinalIgnoreCase)) {
              chosen = Path.Combine(chosen, AppName);
            }
            pathBox.Text = chosen;
          }
        }
      };

      desktopCheck = new CheckBox {
        Text = "建立桌面捷徑",
        Location = new Point(28, 224),
        AutoSize = true,
        Checked = true
      };
      startMenuCheck = new CheckBox {
        Text = "加入開始功能表",
        Location = new Point(28, 250),
        AutoSize = true,
        Checked = true
      };
      launchCheck = new CheckBox {
        Text = "安裝完成後立即啟動 " + AppName,
        Location = new Point(28, 276),
        AutoSize = true,
        Checked = true
      };

      progressBar = new ProgressBar {
        Location = new Point(28, 314),
        Size = new Size(504, 10),
        Minimum = 0,
        Maximum = 100,
        Value = 0
      };
      statusLabel = new Label {
        Text = "準備就緒，將寫入獨立執行檔、授權與版本紀錄。",
        Location = new Point(28, 332),
        Size = new Size(504, 20),
        ForeColor = muted,
        Font = new Font("Microsoft JhengHei UI", 8.5f)
      };

      installBtn = new Button {
        Text = "開始安裝",
        Location = new Point(320, 362),
        Size = new Size(116, 32),
        FlatStyle = FlatStyle.Flat,
        BackColor = accent,
        ForeColor = Color.FromArgb(20, 20, 18),
        Font = new Font("Microsoft JhengHei UI", 9.5f, FontStyle.Bold)
      };
      installBtn.FlatAppearance.BorderSize = 0;

      closeBtn = new Button {
        Text = "取消",
        Location = new Point(446, 362),
        Size = new Size(86, 32),
        FlatStyle = FlatStyle.Flat,
        BackColor = panelBg,
        ForeColor = ForeColor
      };
      closeBtn.FlatAppearance.BorderColor = borderCol;
      closeBtn.Click += (s, e) => Close();

      installBtn.Click += (s, e) => StartInstall();

      Controls.AddRange(new Control[] {
        kicker, title, subtitle, wvPanel,
        dirLabel, pathBox, browseBtn,
        desktopCheck, startMenuCheck, launchCheck,
        progressBar, statusLabel, installBtn, closeBtn
      });
    }

    void StartInstall() {
      string dest = (pathBox.Text ?? "").Trim();
      if (string.IsNullOrEmpty(dest)) {
        MessageBox.Show("請輸入有效的安裝資料夾路徑。", AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return;
      }
      bool mkDesktop = desktopCheck.Checked;
      bool mkStart = startMenuCheck.Checked;
      bool autoLaunch = launchCheck.Checked;

      installBtn.Enabled = false;
      browseBtn.Enabled = false;
      pathBox.Enabled = false;
      desktopCheck.Enabled = false;
      startMenuCheck.Enabled = false;
      launchCheck.Enabled = false;
      closeBtn.Enabled = false;

      var worker = new Thread(() => {
        try {
          PerformInstall(dest, mkDesktop, mkStart, autoLaunch, true, (pct, msg) => {
            if (!IsDisposed) {
              try {
                BeginInvoke(new Action(() => {
                  progressBar.Value = Math.Max(0, Math.Min(100, pct));
                  statusLabel.Text = msg;
                }));
              } catch {}
            }
          });
          if (!IsDisposed) {
            BeginInvoke(new Action(() => {
              Succeeded = true;
              progressBar.Value = 100;
              statusLabel.Text = "安裝完成！";
              closeBtn.Text = "完成";
              closeBtn.Enabled = true;
              if (autoLaunch) Close();
            }));
          }
        } catch (Exception ex) {
          if (!IsDisposed) {
            BeginInvoke(new Action(() => {
              statusLabel.Text = "安裝失敗：" + ex.Message;
              installBtn.Enabled = true;
              browseBtn.Enabled = true;
              pathBox.Enabled = true;
              desktopCheck.Enabled = true;
              startMenuCheck.Enabled = true;
              launchCheck.Enabled = true;
              closeBtn.Enabled = true;
              MessageBox.Show("安裝過程中發生錯誤：\n" + ex.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }));
          }
        }
      });
      worker.IsBackground = true;
      worker.Start();
    }
  }
}
