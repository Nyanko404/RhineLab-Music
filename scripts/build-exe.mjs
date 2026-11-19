import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
if (!existsSync(csc)) {
  throw new Error("找不到 .NET Framework csc.exe：" + csc);
}

const distDir = resolve("dist");
if (!existsSync(distDir)) {
  throw new Error("找不到 dist 目錄，請先執行 npm run build");
}

const webViewCandidates = [
  process.env.WEBVIEW2_SDK_DIR,
  resolve("vendor/webview2"),
  "E:\\Codex\\tools\\webview2",
].filter(Boolean);
const webViewDir = webViewCandidates.find(
  (dir) =>
    existsSync(resolve(dir, "Microsoft.Web.WebView2.Core.dll")) &&
    existsSync(resolve(dir, "Microsoft.Web.WebView2.WinForms.dll")) &&
    existsSync(resolve(dir, "WebView2Loader.dll")),
);
if (!webViewDir) {
  throw new Error(
    "找不到 WebView2 SDK 二進位檔 (Microsoft.Web.WebView2.Core.dll / WinForms.dll / WebView2Loader.dll)，請置於 vendor/webview2 或 E:\\Codex\\tools\\webview2，或設定 WEBVIEW2_SDK_DIR",
  );
}
const wvCore = resolve(webViewDir, "Microsoft.Web.WebView2.Core.dll");
const wvWinForms = resolve(webViewDir, "Microsoft.Web.WebView2.WinForms.dll");
const wvLoader = resolve(webViewDir, "WebView2Loader.dll");
console.log("Embedding WebView2 SDK:", webViewDir);

const ytDlpCandidates = [
  process.env.YTDLP_PATH,
  resolve("vendor/yt-dlp.exe"),
  "E:\\Codex\\tools\\yt-dlp.exe",
].filter(Boolean);
const ytDlpPath = ytDlpCandidates.find((p) => existsSync(p));
if (!ytDlpPath) {
  throw new Error(
    "找不到 yt-dlp.exe，請先下載至 vendor/yt-dlp.exe 或 E:\\Codex\\tools\\yt-dlp.exe，或設定 YTDLP_PATH",
  );
}
console.log("Embedding yt-dlp sidecar:", ytDlpPath);

const outDir = resolve("release/desktop");
mkdirSync(outDir, { recursive: true });
const zipPath = resolve(outDir, "dist.zip");
const exePath = resolve(outDir, "RhineLab-Music.exe");
const iconPng = resolve("public/icons/icon-512.png");
const icoPath = resolve("public/icons/rhine-music.ico");

if (existsSync(iconPng)) {
  const sizes = [16, 32, 48, 64, 256];
  const tempFiles = sizes.map((size) =>
    resolve(outDir, size === 256 ? `icon-${size}.png` : `icon-${size}.dib`),
  );
  const psScript = [
    "Add-Type -AssemblyName System.Drawing",
    `$src = [System.Drawing.Image]::FromFile('${iconPng.replace(/'/g, "''")}')`,
    ...sizes.map((size, i) => {
      const outPath = tempFiles[i].replace(/'/g, "''");
      if (size === 256) {
        return `
      $bmp = New-Object System.Drawing.Bitmap(${size}, ${size}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($src, 0, 0, ${size}, ${size})
      $g.Dispose()
      $bmp.Save('${outPath}', [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()`;
      }
      const andStride = Math.ceil(size / 32) * 4;
      const andBytes = andStride * size;
      return `
      $bmp = New-Object System.Drawing.Bitmap(${size}, ${size}, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($src, 0, 0, ${size}, ${size})
      $g.Dispose()
      $rect = New-Object System.Drawing.Rectangle(0, 0, ${size}, ${size})
      $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $rowBytes = ${size} * 4
      $pixels = New-Object byte[] ($rowBytes * ${size})
      for ($y = 0; $y -lt ${size}; $y++) {
        $srcPtr = [IntPtr]::Add($bd.Scan0, $y * $bd.Stride)
        $dstOff = (${size} - 1 - $y) * $rowBytes
        [System.Runtime.InteropServices.Marshal]::Copy($srcPtr, $pixels, $dstOff, $rowBytes)
      }
      $bmp.UnlockBits($bd)
      $bmp.Dispose()
      $fs = [System.IO.File]::Open('${outPath}', [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
      $bw = New-Object System.IO.BinaryWriter($fs)
      $bw.Write([int]40)
      $bw.Write([int]${size})
      $bw.Write([int](${size} * 2))
      $bw.Write([int16]1)
      $bw.Write([int16]32)
      $bw.Write([int]0)
      $bw.Write([int]($rowBytes * ${size}))
      $bw.Write([int]0)
      $bw.Write([int]0)
      $bw.Write([int]0)
      $bw.Write([int]0)
      $bw.Write($pixels)
      $bw.Write((New-Object byte[] ${andBytes}))
      $bw.Close()
      $fs.Dispose()`;
    }),
    "$src.Dispose()",
  ].join("\n");
  execFileSync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    stdio: "inherit",
  });

  const images = sizes.map((size, i) => ({
    size,
    data: readFileSync(tempFiles[i]),
  }));
  for (const p of tempFiles) if (existsSync(p)) rmSync(p);

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  writeFileSync(
    icoPath,
    Buffer.concat([header, ...entries, ...images.map((i) => i.data)]),
  );
  console.log("Generated multi-resolution launcher icon:", icoPath);
}

if (existsSync(zipPath)) rmSync(zipPath);
if (existsSync(exePath)) rmSync(exePath);

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path "${distDir}\\*" -DestinationPath "${zipPath}" -Force`,
  ],
  { stdio: "inherit" },
);

const cscArgs = [
  "/nologo",
  "/target:winexe",
  "/platform:x64",
  "/optimize+",
  `/out:${exePath}`,
  ...(existsSync(icoPath) ? [`/win32icon:${icoPath}`] : []),
  "/reference:System.Drawing.dll",
  "/reference:System.IO.Compression.dll",
  "/reference:System.Web.Extensions.dll",
  "/reference:System.Windows.Forms.dll",
  `/reference:${wvCore}`,
  `/reference:${wvWinForms}`,
  `/resource:${zipPath},RhineLabMusic.dist.zip`,
  `/resource:${wvCore},RhineLabMusic.Microsoft.Web.WebView2.Core.dll`,
  `/resource:${wvWinForms},RhineLabMusic.Microsoft.Web.WebView2.WinForms.dll`,
  `/resource:${wvLoader},RhineLabMusic.WebView2Loader.dll`,
  ...(ytDlpPath ? [`/resource:${ytDlpPath},RhineLabMusic.yt-dlp.exe`] : []),
  resolve("scripts/launcher.cs"),
];

execFileSync(csc, cscArgs, { stdio: "inherit" });

rmSync(zipPath);
const sha256 = createHash("sha256").update(readFileSync(exePath)).digest("hex");
writeFileSync(
  resolve(outDir, "SHA256SUMS.txt"),
  `${sha256}  RhineLab-Music.exe\r\n`,
  "utf8",
);
console.log("Built standalone 64-bit executable:", exePath);
console.log("SHA-256:", sha256);
