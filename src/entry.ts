import { isWallpaper } from "./wallpaper";

const params = new URLSearchParams(location.search);
const showArchive =
  isWallpaper ||
  ["archive", "review", "scene", "freeze", "time"].some((key) =>
    params.has(key),
  );

if (showArchive) {
  document.title = "RHINE LAB · ANALYSIS OS";
  document.documentElement.lang = "zh-CN";
  void import("./main");
} else {
  void import("./music/app");
}
