import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
if (!existsSync(csc)) {
  throw new Error("找不到 .NET Framework csc.exe：" + csc);
}

const desktopDir = resolve("release/desktop");
const exeName = "RhineLab-Music.exe";
const exePath = resolve(desktopDir, exeName);
const shaFile = resolve(desktopDir, "SHA256SUMS.txt");
const syncNames = ["README.txt", "CHANGELOG.md", "third-party-notices.txt"];
const packageNames = [exeName, ...syncNames, "SHA256SUMS.txt"];

for (const name of packageNames) {
  const full = resolve(desktopDir, name);
  if (!existsSync(full)) {
    throw new Error("找不到 release/desktop 必要檔案：" + full);
  }
}

const exeHash = createHash("sha256").update(readFileSync(exePath)).digest("hex");
const shaLine = readFileSync(shaFile, "utf8").trim().split(/\s+/)[0]?.toLowerCase();
if (shaLine !== exeHash) {
  throw new Error(
    `SHA256SUMS.txt (${shaLine}) 與 ${exeName} (${exeHash}) 不符`,
  );
}

const exeStat = statSync(exePath);
for (const name of syncNames) {
  utimesSync(resolve(desktopDir, name), exeStat.atime, exeStat.mtime);
}

const shareDir = resolve("release/share");
mkdirSync(shareDir, { recursive: true });

const portableName = "RhineLab-Music-Portable-v1.0.0-Win64.zip";
const portableZip = resolve(shareDir, portableName);
const setupName = "RhineLab-Music-Setup-v1.0.0.exe";
const setupExe = resolve(shareDir, setupName);
const shareShaFile = resolve(shareDir, "SHA256SUMS.txt");
const icoPath = resolve("public/icons/rhine-music.ico");

if (existsSync(portableZip)) rmSync(portableZip);
if (existsSync(setupExe)) rmSync(setupExe);

const archiveInputs = packageNames
  .map((name) => `'${resolve(desktopDir, name).replace(/'/g, "''")}'`)
  .join(", ");
const escapedZip = portableZip.replace(/'/g, "''");
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    if (existsSync(portableZip)) rmSync(portableZip);
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$ErrorActionPreference = 'Stop'; Compress-Archive -Path @(${archiveInputs}) -DestinationPath '${escapedZip}' -CompressionLevel Optimal -Force`,
      ],
      { stdio: "inherit" },
    );
    if (statSync(portableZip).size > 10 * 1024 * 1024) break;
  } catch (err) {
    if (attempt === 6) throw err;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
}
if (!existsSync(portableZip) || statSync(portableZip).size <= 10 * 1024 * 1024) {
  throw new Error("Portable ZIP 壓縮失敗或容量異常：" + portableZip);
}

const cscArgs = [
  "/nologo",
  "/target:winexe",
  "/platform:x64",
  "/optimize+",
  `/out:${setupExe}`,
  ...(existsSync(icoPath) ? [`/win32icon:${icoPath}`] : []),
  "/reference:System.Drawing.dll",
  "/reference:System.IO.Compression.dll",
  "/reference:System.Windows.Forms.dll",
  `/resource:${portableZip},RhineLabMusic.payload.zip`,
  resolve("scripts/installer.cs"),
];

execFileSync(csc, cscArgs, { stdio: "inherit" });

const setupHash = createHash("sha256").update(readFileSync(setupExe)).digest("hex");
const portableHash = createHash("sha256")
  .update(readFileSync(portableZip))
  .digest("hex");

writeFileSync(
  shareShaFile,
  `${setupHash}  ${setupName}\r\n${portableHash}  ${portableName}\r\n`,
  "utf8",
);

const setupMb = (statSync(setupExe).size / (1024 * 1024)).toFixed(2);
const portableMb = (statSync(portableZip).size / (1024 * 1024)).toFixed(2);

console.log(`Built shareable installer: ${setupExe} (${setupMb} MiB)`);
console.log(`  SHA-256: ${setupHash}`);
console.log(`Built portable archive:    ${portableZip} (${portableMb} MiB)`);
console.log(`  SHA-256: ${portableHash}`);
console.log(`Wrote checksum manifest:   ${shareShaFile}`);
