import "../fonts.css";
import "@kitlangton/rolling-number/styles.css";
import "../model-viewer.css";
import "../decryption.css";
import "./music.css";
import {
  createRollingNumber,
  createRollingText,
} from "@kitlangton/rolling-number";
import { TerminalAudio, type Sound } from "../audio";
import { ContentTransition } from "../ui-transitions";
import { initPwa } from "../pwa";
import { escapeHtml as esc } from "../html";
import {
  normalizeQuality,
  qualityPresets,
  type AntialiasMode,
  type RenderResolution,
} from "../render-quality";
import { runBootIntro } from "./boot-intro";
import {
  getDesktopDiagnostics,
  probeDesktopHost,
  restartDesktopApp,
  setDesktopGpuMode,
  setDesktopRenderBackend,
  type DesktopHostStatus,
  type GpuMode,
  type RenderBackend,
} from "./accounts";
import { Library, observatory, type LightingMode } from "./library";
import { PlayerController } from "./player";
import {
  LocalAdapter,
  SpotifyAdapter,
  StreamAdapter,
  YouTubeAdapter,
} from "./adapters";
import {
  completeSpotifyCallback,
  defaultSpotifyClientId,
  loadSpotifySession,
  logoutSpotify,
  spotifyRedirectUri,
  startSpotifyLogin,
  syncSpotifyLibrary,
  type SpotifySession,
} from "./spotify";
import {
  button,
  cover,
  formatTime,
  icon,
  shell,
  trackRow,
  views,
  type View,
} from "./interface";
import {
  isDrmPlatformUrl,
  isSupportedStreamPlaylist,
  parseTrackLink,
  youtubePlaylistId,
} from "./links";
import { lyricAt, type LyricLine } from "./lyrics";
import {
  enrichTrack,
  importStreamPlaylist,
  importYouTubePlaylist,
  searchYouTube,
  youtubeConfigured,
  youtubeSearchUrl,
} from "./providers";
import {
  sourceNames,
  type Playlist,
  type Repeat,
  type Source,
  type Track,
} from "./types";
import {
  effectiveHomeScope,
  resolveSceneTracks,
  type HomeScope,
} from "./scope";
import { detectWebglRenderer, type MusicWall } from "./wall";

document.body.classList.add("music-app");
const root = document.querySelector<HTMLElement>("#stage")!;
root.innerHTML = shell;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  root.querySelector<T>(selector)!;
const library = new Library();
const video = $("#video-mount");
const hasDesktopAudio = async () => {
  if (desktopHost) return true;
  const status = await probeDesktopHost();
  if (status) {
    applyDesktopHostCapabilities(status);
    return true;
  }
  return false;
};
const player = new PlayerController((track) => {
  video.hidden = track.source !== "youtube" || Boolean(desktopHost);
  if (track.source === "youtube")
    return new YouTubeAdapter(
      video,
      hasDesktopAudio,
      () => library.state.prefs.audioQuality,
    );
  if (track.source === "stream")
    return new StreamAdapter(
      hasDesktopAudio,
      () => library.state.prefs.audioQuality,
    );
  if (track.source === "spotify") return new SpotifyAdapter();
  return new LocalAdapter(library);
});
const dialog = $<HTMLDialogElement>("#music-dialog");
const workspace = $<HTMLDialogElement>("#music-workspace");
let workspaceMode: "closed" | "modal" | "panel" = "closed";
$(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  $("#music-content").focus();
});
const page = $("#music-page");
const right = $("#right-content");
const notice = $("#music-notice");
const transition = new ContentTransition();
const panelTransition = new ContentTransition();
const themeMedia = matchMedia("(prefers-color-scheme: dark)");
const motionMedia = matchMedia("(prefers-reduced-motion: reduce)");
const elapsedNode = $("#elapsed");
const queueCounter = createRollingNumber($("#queue-count"), {
  value: 0,
  format: { minimumIntegerDigits: 2 },
  duration: 260,
});
const codeRollOptions = {
  duration: 460,
  motionBlur: true,
  locales: "en-US",
  format: { minimumIntegerDigits: 3, useGrouping: false },
  value: 1,
};
const objectCodeCounter = createRollingNumber($("#object-code"), codeRollOptions);
const recordCodeCounter = createRollingNumber($("#record-code"), codeRollOptions);
const textRollOptions = {
  duration: 460,
  motionBlur: true,
  transition: "direct" as const,
  stagger: "none" as const,
};
const heroTitleRoller = createRollingText($("#hero-title-text"), {
  ...textRollOptions,
  text: $("#hero-title-text").textContent ?? "",
});
const nowSourceRoller = createRollingText($("#now-source"), {
  ...textRollOptions,
  text: $("#now-source").textContent ?? "",
});
function finishRecordRollers() {
  objectCodeCounter.finish();
  recordCodeCounter.finish();
  heroTitleRoller.finish();
  nowSourceRoller.finish();
}
const canvas = $<HTMLCanvasElement>("#spectrum");
const spectrum = canvas.getContext("2d");
const bands = new Uint8Array(128);
const wave = new Uint8Array(256);
let wall: MusicWall | undefined;
let view: View = "home";
let homeScope: HomeScope = "favorites";
let panel: "details" | "notes" | "history" | "queue" | "lyrics" = "details";
let inspectedTrack = observatory;
let artworkRevision = 0;
let playlistId: string | undefined;
let searchItems: Track[] = [];
let query = "";
let searchFilter: "all" | Source = "all";
let searchStatus = "";
let searchAbort: AbortController | undefined;
let displayTracks: Track[] = [];
let selectedAlbum: string | undefined;
let currentTrack: Track | undefined;
let activeLyrics: LyricLine[] = [];
let activeLine = -2,
  activeWord = -2;
let lastStatus = "";
let latestPlayed = "";
let renderQueueStamp = "";
let lastStore = 0;
let noticeTimer = 0;
let ready = false;
let wallRequest = false;
let sound: TerminalAudio | undefined;
let previousElapsed = "";
let previousDuration = -1;
let lastSeekDisabled: boolean | undefined;
let lastSeekMax = "";
let lastAriaValueText = "";
let lastVolumeValue = "";
const viewScroll = new Map<View, number>();
let settingsReturnView: View = "home";
let panelReturnFocus: HTMLElement | null = null;
let settingsReturnFocus: HTMLElement | null = null;
let dialogReturnFocus: HTMLElement | null = null;
let detectedGpuName = "";
let desktopHost: DesktopHostStatus | null = null;
let gpuModePending: GpuMode = "auto";
let renderBackendPending: RenderBackend = "auto";
let gpuRestartRequired = false;
let artworkTargetKey: string | undefined;
let librarySelectMode = false;
let spotifySession: SpotifySession | null = loadSpotifySession();
let spotifySyncing = false;
let wallSwitchTimer: number | undefined;
function cancelWallAutoPlay() {
  if (wallSwitchTimer !== undefined) {
    clearTimeout(wallSwitchTimer);
    wallSwitchTimer = undefined;
  }
}
const selectedLibraryKeys = new Set<string>();
const reduced = () =>
  library.state.prefs.motion === "reduced" ||
  (library.state.prefs.motion === "system" && motionMedia.matches);
const dark = () =>
  library.state.prefs.theme === "dark" ||
  (library.state.prefs.theme === "system" && themeMedia.matches);

function notify(message: string) {
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.hidden = true;
  }, 4600);
}
function failure(error: unknown) {
  notify(error instanceof Error ? error.message : String(error));
}
function save() {
  void library.save().catch(failure);
}
function syncSoundPrefs() {
  const prefs = library.state.prefs;
  if (!prefs.sounds) {
    sound?.configure({
      sound: false,
      music: false,
      soundVolume: 0,
      musicVolume: 0,
    });
    return;
  }
  sound ??= new TerminalAudio();
  sound.configure({
    sound: true,
    music: false,
    soundVolume: prefs.soundVolume,
    musicVolume: 0,
  });
}
function feedback(cue: Sound = "ui-tick") {
  if (!library.state.prefs.sounds) return;
  syncSoundPrefs();
  if (!sound) return;
  if (sound.isReady) {
    sound.play(cue);
    return;
  }
  void sound
    .unlock()
    .then(() => sound?.play(cue))
    .catch(() => {});
}
function updateRenderResolutionReadout() {
  const node = root.querySelector("#render-resolution-info");
  if (!node) return;
  const raw = $("#wall").dataset.renderQuality;
  if (!raw) {
    node.textContent = "等待 3D 渲染初始化";
    return;
  }
  try {
    const info = JSON.parse(raw) as {
      width?: number;
      height?: number;
      ratio?: number;
      antialias?: AntialiasMode;
      superPerformance?: boolean;
      limited?: boolean;
    };
    const aaLabels: Record<AntialiasMode, string> = {
      off: "關閉",
      fxaa: "FXAA",
      smaa: "SMAA",
      taa: "TAA",
    };
    if (info.width && info.height) {
      const aaText = info.superPerformance
        ? " · 效能模式 (硬體 MSAA)"
        : " · AA " + (info.antialias ? aaLabels[info.antialias] ?? "SMAA" : "SMAA");
      node.textContent =
        info.width +
        " × " +
        info.height +
        " px（倍率 " +
        Number(info.ratio ?? 1).toFixed(2) +
        "x" +
        aaText +
        (info.limited ? " · 受 GPU 材質上限約束" : "") +
        "）";
    }
  } catch {
    node.textContent = "";
  }
}
let lastSyncedWindowTheme: "dark" | "light" | undefined;
function sendWindowControl(
  act: "minimize" | "maximize" | "toggle-maximize" | "close" | "drag",
) {
  const bridge = (
    window as {
      chrome?: { webview?: { postMessage?: (message: string) => void } };
    }
  ).chrome?.webview;
  if (bridge?.postMessage) {
    bridge.postMessage(act);
    return;
  }
  void fetch("/__rhine/window-control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: act }),
    keepalive: true,
  }).catch(() => {});
}
function applyDesktopHostCapabilities(status: DesktopHostStatus) {
  desktopHost = status;
  gpuModePending = status.gpuMode;
  renderBackendPending = status.renderBackend;
  if (status.frameless) {
    document.documentElement.dataset.frameless = "true";
    document.getElementById("window-controls")?.removeAttribute("hidden");
  }
}
function syncDesktopWindowTheme() {
  if (!desktopHost) return;
  const mode = dark() ? "dark" : "light";
  if (mode === lastSyncedWindowTheme) return;
  lastSyncedWindowTheme = mode;
  void fetch("/__rhine/window-theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme: mode }),
    keepalive: true,
  }).catch(() => {});
}
function syncPreferences() {
  const prefs = library.state.prefs;
  root.dataset.theme = dark() ? "dark" : "light";
  root.dataset.accent = prefs.accent;
  root.dataset.motion = reduced() ? "reduced" : "full";
  root.style.setProperty("--music-font", prefs.font + "%");
  document.documentElement.dataset.musicTheme = root.dataset.theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark() ? "#151818" : "#e9e5de");
  syncDesktopWindowTheme();
  syncSoundPrefs();
  for (const control of root.querySelectorAll<HTMLButtonElement>(
    "[data-setting-theme]",
  ))
    control.setAttribute(
      "aria-pressed",
      String(control.dataset.settingTheme === prefs.theme),
    );
  if (wall) {
    wall.configureLighting(prefs.lightingMode, prefs.lightingColor);
    wall.configureDisplay(prefs.resolution, prefs.antialias);
    void wall
      .configure(prefs.quality, dark(), reduced(), prefs.customQuality)
      .then(() => requestAnimationFrame(updateRenderResolutionReadout));
  } else if (prefs.quality === "off") {
    $("#wall").dataset.state = "off";
    $("#wall-status").textContent = "2D 模式";
  } else if (!wallRequest && !$("#music-hero").hidden) {
    wallRequest = true;
    void import("./wall")
      .then(({ MusicWall }) => {
        wall = new MusicWall(
          $("#wall"),
          $("#wall-status"),
          handleWallSelection,
          (track) => library.artwork(track),
          (key) => library.artworkVersion(key),
          (gpu) => {
            detectedGpuName = gpu;
            const node = root.querySelector("#gpu-renderer-name");
            if (node) node.textContent = gpu;
          },
          () => {
            void (desktopHost
              ? Promise.resolve(desktopHost)
              : probeDesktopHost()
            )
              .then((host) => {
                if (
                  host?.renderBackend === "vulkan" &&
                  !sessionStorage.getItem("rhine-vulkan-fallback")
                ) {
                  sessionStorage.setItem("rhine-vulkan-fallback", "1");
                  notify(
                    "此裝置驅動不支援 Vulkan，已自動切換為系統預設渲染並重啟…",
                  );
                  return setDesktopRenderBackend("auto").then(() =>
                    restartDesktopApp(),
                  );
                }
              })
              .catch(failure);
          },
          cancelWallAutoPlay,
        );
        wall.configureLighting(prefs.lightingMode, prefs.lightingColor);
        if (view === "library") wall.inspect(false);
        wall.setTracks(sceneTracks(), inspectedTrack);
        syncPreferences();
      })
      .catch(() => {
        wallRequest = false;
        $("#wall").dataset.state = "error";
        $("#wall-status").textContent = "三維模組載入失敗";
      });
  }
}
motionMedia.addEventListener("change", syncPreferences);
themeMedia.addEventListener("change", syncPreferences);

const heading = (title: string, actions = "") =>
  '<div class="section-head"><h2>' + title + "</h2>" + actions + "</div>";
const textButton = (
  label: string,
  action: string,
  glyph: Parameters<typeof icon>[0] = "plus",
) =>
  '<button type="button" class="outline" data-action="' +
  action +
  '">' +
  icon(glyph) +
  " " +
  label +
  "</button>";
const nothing = (title: string, text: string, actions = "") =>
  '<div class="empty"><div class="empty-icon">' +
  icon("disc") +
  "</div><div><strong>" +
  title +
  "</strong><p>" +
  text +
  "</p></div>" +
  actions +
  "</div>";
const rowList = (tracks: Track[], compact = false, selectable = false) =>
  '<ol class="track-list">' +
  tracks
    .map((track, index) =>
      trackRow(
        track,
        index,
        library.state.favorites.includes(track.key),
        player.state.track?.key,
        compact,
        selectable
          ? { active: true, checked: selectedLibraryKeys.has(track.key) }
          : undefined,
      ),
    )
    .join("") +
  "</ol>";
const byKeys = (keys: string[]) =>
  keys.flatMap((key) => library.find(key) ?? []);
const albumKey = (track: Track) =>
  [
    track.source,
    track.album || track.key,
    track.album ? track.artist : "",
  ].join("\u001f");
const anchor = (url: string, title: string) =>
  '<a class="outline" href="' +
  esc(url) +
  '" target="_blank" rel="noopener noreferrer">' +
  esc(title) +
  icon("arrow") +
  "</a>";

function hydrateArtwork(container: Element) {
  for (const node of container.querySelectorAll<HTMLElement>("[data-cover]")) {
    const track = resolveTrack(node.dataset.cover!);
    if (!track) continue;
    void library
      .artwork(track)
      .then((artwork) => {
        if (artwork && node.isConnected) node.innerHTML = cover(track, artwork);
      })
      .catch(failure);
  }
}
function resolveTrack(key: string) {
  return (
    library.find(key) ??
    searchItems.find((item) => item.key === key) ??
    player.queue.find((item) => item.key === key) ??
    (key === observatory.key ? observatory : undefined)
  );
}
function albumWall(tracks: Track[]) {
  const groups = new Map<string, Track>();
  for (const track of tracks)
    if (!groups.has(albumKey(track))) groups.set(albumKey(track), track);
  return (
    heading(
      "專輯牆",
      '<span class="mono result-count">' + groups.size + " 張</span>",
    ) +
    '<div class="album-wall">' +
    [...groups.values()]
      .map(
        (track) =>
          '<button data-album="' +
          esc(track.key) +
          '"><div class="album-art" data-cover="' +
          esc(track.key) +
          '">' +
          cover(track, track.artwork) +
          "</div><strong>" +
          esc(track.album || track.title) +
          "</strong><small>" +
          esc(track.artist || sourceNames[track.source]) +
          "</small></button>",
      )
      .join("") +
    "</div>"
  );
}
function sourceCards(details: boolean) {
  const values = [
    ["local", "本機檔案", "匯入音訊與封面", "files", true],
    [
      "youtube",
      "YouTube",
      youtubeConfigured ? "播放清單匯入與搜尋可用" : "公開清單與影片連結匯入",
      "link",
      true,
    ],
    [
      "stream",
      "網路串流",
      desktopHost ? "各大網站音頻串流已就緒" : "SoundCloud / Bandcamp / 直連音訊",
      "link",
      true,
    ],
  ] as const;
  return (
    '<div class="source-cards' +
    (details ? " source-details" : "") +
    '">' +
    values
      .map(
        ([id, name, description, action, configured]) =>
          '<button class="platform-tile" data-action="' +
          action +
          '" data-source="' +
          id +
          '"><i class="platform-icon ' +
          id +
          '">' +
          icon(id === "local" ? "disc" : "play") +
          "</i><span><strong>" +
          name +
          "</strong><small>" +
          description +
          "</small></span>" +
          (details
            ? '<span class="mono">' +
              (configured ? "已就緒" : "官方入口") +
              "</span>"
            : "") +
          "</button>",
      )
      .join("") +
    "</div>"
  );
}
function searchPage() {
  displayTracks = searchItems;
  return (
    '<h1>搜尋</h1><form id="full-search" class="inline-form"><label class="grow">搜尋歌曲、專輯或藝人<input type="search" name="query" value="' +
    esc(query) +
    '" autocomplete="off"></label><label>來源<select name="source">' +
    choices({ all: "全部來源", ...sourceNames }, searchFilter) +
    '</select></label><button class="solid">搜尋</button></form>' +
    (query
      ? '<div class="official-links">' +
        (searchFilter === "all" || searchFilter === "youtube"
          ? anchor(youtubeSearchUrl(query), "YouTube 搜尋")
          : "") +
        "</div>"
      : "") +
    '<p id="search-status" role="status">' +
    esc(searchStatus) +
    '</p><div id="search-results">' +
    searchResults() +
    "</div>"
  );
}
function searchResults() {
  return searchItems.length
    ? heading(
        "搜尋結果",
        '<span class="mono result-count">' + searchItems.length + " 首</span>",
      ) + rowList(searchItems)
    : nothing(
        query ? "尚無搜尋結果" : "搜尋你的音樂",
        "也可以貼上 YouTube 連結。",
        textButton("匯入連結", "link", "link"),
      );
}
function playlistPage() {
  const selected = library.state.playlists.find(
    (list) => list.id === playlistId,
  );
  displayTracks = selected ? byKeys(selected.tracks) : [];
  const actions = textButton("建立清單", "playlist-new");
  if (!selected)
    return (
      "<h1>播放清單</h1>" +
      heading("我的清單", actions) +
      (library.state.playlists.length
        ? '<div class="playlist-grid">' +
          library.state.playlists
            .map(
              (list) =>
                '<button class="platform-tile" data-playlist="' +
                esc(list.id) +
                '">' +
                icon("list") +
                "<span><strong>" +
                esc(list.name) +
                "</strong><small>" +
                list.tracks.length +
                " 首歌曲</small></span>" +
                icon("chevron") +
                "</button>",
            )
            .join("") +
          "</div>"
        : nothing(
            "還沒有播放清單",
            "建立清單後，可以從各來源加入歌曲。",
            actions,
          ))
    );
  return (
    '<button class="text-link" data-action="playlist-back">‹ 所有播放清單</button><h1>' +
    esc(selected.name) +
    "</h1>" +
    heading(
      "清單歌曲",
      '<div class="official-links">' +
        textButton("編輯清單", "playlist-edit", "settings") +
        '<button type="button" class="outline" data-action="playlist-delete" aria-label="刪除此播放清單">' +
        icon("close") +
        " 刪除清單</button>" +
        textButton("開始播放", "playlist-play", "play") +
        "</div>",
    ) +
    (displayTracks.length
      ? rowList(displayTracks)
      : nothing("清單是空的", "從歌曲選項選擇加入播放清單。"))
  );
}
function choices(values: Record<string, string>, selected: string | number) {
  return Object.entries(values)
    .map(
      ([value, label]) =>
        '<option value="' +
        esc(value) +
        '"' +
        (String(selected) === value ? " selected" : "") +
        ">" +
        esc(label) +
        "</option>",
    )
    .join("");
}
function platformAccountsSection() {
  const modeStatus = desktopHost
    ? "本機代理已就緒"
    : youtubeConfigured
      ? "API 匯入可用"
      : "桌面版支援公開清單";
  const clientId =
    library.state.prefs.spotifyClientId?.trim() || defaultSpotifyClientId();
  const spotifyStatus = spotifySession
    ? `${esc(spotifySession.displayName || spotifySession.userId || "已登入")}（${spotifySession.product === "premium" ? "Premium" : "Free"}）`
    : "未登入";
  return (
    '<section class="platform-accounts" aria-label="平台帳號與播放清單同步">' +
    "<h2>平台帳號與播放清單同步</h2>" +
    '<div class="account-grid">' +
    '<div class="account-card">' +
    '<div class="account-head"><strong>Spotify 官方帳號 (OAuth 2.0 PKCE)</strong><span class="mono">' +
    spotifyStatus +
    "</span></div>" +
    '<p class="account-note">使用官方 OAuth 2.0 PKCE 授權登入（不經手密碼），自動同步私人與收藏清單。完整曲目串流需 Spotify Premium 與瀏覽器 Widevine DRM 支援；若環境受限則保留清單並支援於 Spotify 開啟。Redirect URI：<code>' +
    esc(spotifyRedirectUri()) +
    "</code></p>" +
    '<div class="inline-form"><label class="grow">Spotify Client ID<input type="text" data-pref="spotifyClientId" placeholder="填入 Spotify Developer App Client ID" value="' +
    esc(clientId) +
    '" autocomplete="off"></label>' +
    (spotifySession
      ? '<button type="button" class="solid" data-action="spotify-sync"' +
        (spotifySyncing ? " disabled" : "") +
        ">" +
        (spotifySyncing ? "同步中…" : "立即同步清單") +
        '</button><button type="button" class="outline" data-action="spotify-logout">登出</button>'
      : '<button type="button" class="solid" data-action="spotify-login">Spotify 登入</button>') +
    "</div></div>" +
    '<div class="account-card">' +
    '<div class="account-head"><strong>YouTube 播放清單匯入</strong><span class="mono">' +
    modeStatus +
    "</span></div>" +
    '<p class="account-note">無需登入帳號或設定 API 金鑰，貼上公開 YouTube 播放清單連結（含 <code>list=...</code>）即可匯入曲目與個別封面並在站內播放。</p>' +
    '<form id="youtube-playlist-form" class="inline-form"><label class="grow">YouTube 播放清單連結<input type="text" inputmode="url" name="ytPlaylistInput" placeholder="https://www.youtube.com/playlist?list=..." autocomplete="off" required></label><button class="solid">匯入清單</button></form>' +
    "</div>" +
    "</div></section>"
  );
}

function preferencesPage() {
  const prefs = library.state.prefs;
  const custom = normalizeQuality(prefs.customQuality);
  if (!detectedGpuName) detectedGpuName = wall?.gpuName || detectWebglRenderer();
  const row = (name: string, description: string, control: string) =>
    '<div class="setting-row"><div><strong>' +
    name +
    "</strong><p>" +
    description +
    '</p></div><div class="setting-control">' +
    control +
    "</div></div>";
  const select = (
    key: string,
    label: string,
    options: Record<string, string>,
    value: string | number,
  ) =>
    '<select aria-label="' +
    label +
    '" data-pref="' +
    key +
    '">' +
    choices(options, value) +
    "</select>";
  const activeGpuMode = desktopHost?.gpuMode ?? gpuModePending;
  const activeRenderBackend = desktopHost?.renderBackend ?? renderBackendPending;
  return (
    '<h1>SYSTEM SETTINGS <small>終端偏好設定</small></h1><p class="settings-session mono">LOCAL LISTENER <span>MUSIC SESSION</span></p>' +
    row(
      "介面配色",
      "切換玻璃陣列與終端的配色",
      '<div class="setting-segments">' +
        [
          ["light", "亮色"],
          ["dark", "暗色"],
          ["system", "系統"],
        ]
          .map(
            ([value, name]) =>
              '<button data-setting-theme="' +
              value +
              '" aria-pressed="' +
              (prefs.theme === value) +
              '">' +
              name +
              "</button>",
          )
          .join("") +
        "</div>",
    ) +
    row(
      "SUPER PERFORMANCE",
      "降低即時渲染負載",
      '<input class="toggle" type="checkbox" data-pref="performance" aria-label="效能模式"' +
        (prefs.quality === "performance" ? " checked" : "") +
        ">",
    ) +
    '<div class="setting-audio"><section>' +
    row(
      "INTERFACE SOUND",
      "播放操作與切換的介面音效",
      '<input class="toggle" type="checkbox" data-pref="sounds" aria-label="啟用介面音效"' +
        (prefs.sounds ? " checked" : "") +
        ">",
    ) +
    '<label class="setting-slider">音效音量<input type="range" aria-label="音效音量" data-pref="soundVolume" min="0" max="1" step=".01" value="' +
    prefs.soundVolume +
    '"></label>' +
    "</section><section>" +
    row(
      "PLAYBACK VOLUME",
      "調整站內播放器的預設音量",
      '<span class="mono" id="settings-volume-status">' +
        Math.round(prefs.volume * 100) +
        "%</span>",
    ) +
    '<label class="setting-slider">播放音量<input type="range" aria-label="預設播放音量" data-pref="defaultVolume" min="0" max="1" step=".01" value="' +
    prefs.volume +
    '"></label></section></div>' +
    '<div class="setting-source"><strong>MUSIC SOURCE</strong><p>匯入可由瀏覽器解碼的本機音訊，或加入平台連結。</p><div class="official-links">' +
    textButton("選擇本機音樂", "files", "upload") +
    textButton("匯入平台連結", "link", "link") +
    "</div><p>試聽來源　觀測室 · Observatory</p></div>" +
    row(
      "AUDIO QUALITY",
      "目標音質（依音源與平台能力輸出；有損音源不會轉為無損）",
      select(
        "audioQuality",
        "音質選項",
        {
          auto: "自動 (Auto)",
          standard: "標準 (~128 kbps)",
          high: "高畫質 (~256 kbps)",
          very_high: "極高畫質 (~320 kbps)",
          lossless: "無損 (FLAC / ALAC / WAV)",
        },
        prefs.audioQuality,
      ),
    ) +
    row(
      "RECORD LED LIGHTING",
      "3D 唱片環形動態燈光模式與自訂單色",
      '<div class="setting-gpu">' +
        select(
          "lightingMode",
          "唱片燈光模式",
          {
            reactive: "音樂律動",
            rgb: "RGB 流光",
            breathing: "呼吸燈",
            custom: "自訂單色",
            off: "關閉燈光",
          },
          prefs.lightingMode,
        ) +
        '<input type="color" aria-label="自訂燈光顏色" data-pref="lightingColor" value="' +
        esc(prefs.lightingColor || "#ed853d") +
        '">' +
        "</div>",
    ) +
    row(
      "ANIMATION CONTROLS",
      "調整模型與終端的動態效果與啟動導引",
      '<div class="setting-gpu">' +
        select(
          "motion",
          "動畫強度",
          { system: "跟隨系統", full: "完整", reduced: "減少動態" },
          prefs.motion,
        ) +
        '<button type="button" class="outline" data-action="replay-boot">重播啟動動畫</button>' +
        "</div>",
    ) +
    row(
      "RENDER QUALITY",
      "三維畫質預設與自訂",
      select(
        "quality",
        "三維畫質",
        {
          off: "關閉 3D (off)",
          performance: "效能模式 (performance)",
          balanced: "平衡模式 (balanced)",
          original: "原始基準 (original)",
          high: "高畫質模式 (high)",
          ultra: "極致畫質模式 (ultra)",
          custom: "自訂 (custom)",
        },
        prefs.quality,
      ),
    ) +
    row(
      "TARGET RESOLUTION",
      "指定 3D 輸出目標解析度（支援 1080p / 2K / 4K 超採樣）<span class=\"mono setting-live-note\" id=\"render-resolution-info\"></span>",
      select(
        "resolution",
        "目標解析度",
        {
          native: "自動原生 (Native)",
          "1080p": "1080p (FHD)",
          "2k": "2K (1440p QHD)",
          "4k": "4K (2160p UHD)",
        },
        prefs.resolution,
      ),
    ) +
    row(
      "ANTIALIASING",
      "選擇畫面抗鋸齒演算法（支援 FXAA / SMAA / TAA 時間抗鋸齒）",
      select(
        "antialias",
        "抗鋸齒模式",
        {
          off: "關閉 (Off)",
          fxaa: "FXAA（快速邊緣抗鋸齒）",
          smaa: "SMAA（次像素形態學抗鋸齒）",
          taa: "TAA（時間採樣抗鋸齒）",
        },
        prefs.antialias,
      ),
    ) +
    '<div id="custom-quality-panel" class="custom-quality-panel"' +
    (prefs.quality === "custom" ? "" : " hidden") +
    ">" +
    row(
      "解析度倍率 (SCALE)",
      "調整渲染解析度比例",
      '<div class="setting-slider-inline"><input type="range" aria-label="解析度倍率" data-custom-quality="scale" min="50" max="200" step="5" value="' +
        custom.scale +
        '"><span class="mono" id="custom-scale-value">' +
        custom.scale +
        "%</span></div>",
    ) +
    row(
      "螢幕像素比 (PIXEL RATIO)",
      "限制高 DPI 螢幕渲染倍率",
      select(
        "customPixelRatio",
        "螢幕像素比",
        { 1: "1x", 1.5: "1.5x", 2: "2x", 3: "3x" },
        custom.pixelRatio,
      ),
    ) +
    row(
      "景深 (DEPTH OF FIELD)",
      "關閉景深或將強度設為 0% 可獲得完全銳利畫面",
      '<div class="setting-dof"><input class="toggle" type="checkbox" data-custom-quality="dofEnabled" aria-label="啟用景深"' +
        (custom.depthOfField > 0 ? " checked" : "") +
        '><input type="range" aria-label="景深強度" data-custom-quality="depthOfField" min="0" max="150" step="5" value="' +
        custom.depthOfField +
        '"><span class="mono" id="custom-dof-value">' +
        custom.depthOfField +
        "%</span></div>",
    ) +
    "</div>" +
    row(
      "DETECTED GPU",
      "當前偵測到的 WebGL 顯卡（UNMASKED_RENDERER_WEBGL）",
      '<div class="setting-gpu"><span class="mono gpu-name" id="gpu-renderer-name">' +
        esc(detectedGpuName) +
        "</span>" +
        (desktopHost
          ? '<button type="button" class="outline" data-action="desktop-diagnostics">GPU 診斷日誌</button>'
          : "") +
        "</div>",
    ) +
    row(
      "RENDER BACKEND",
      desktopHost
        ? gpuRestartRequired
          ? "已儲存至本機設定，重啟 .exe 後生效"
          : "選擇圖形渲染後端（預設由系統自動選擇；可依顯示卡驅動調整）"
        : "桌面版 .exe 專用（重啟 .exe 生效；網頁版由瀏覽器決定）",
      '<div class="setting-gpu">' +
        select(
          "renderBackend",
          "渲染後端",
          {
            auto: "系統預設 (Auto，推薦)",
            d3d11: "Direct3D 11 (Windows)",
            gl: "OpenGL (ANGLE GL)",
            vulkan: "Vulkan（實驗性）",
          },
          activeRenderBackend,
        ) +
        (desktopHost
          ? '<button type="button" class="outline" data-action="desktop-restart">重啟 .exe 套用</button>'
          : "") +
        "</div>",
    ) +
    row(
      "GPU MODE",
      desktopHost
        ? gpuRestartRequired
          ? "已儲存至本機設定，重啟 .exe 後生效"
          : "選擇桌面版獨立瀏覽器渲染器偏好（重啟 .exe 生效）"
        : "桌面版 .exe 專用（重啟 .exe 生效；網頁版由瀏覽器決定）",
      '<div class="setting-gpu">' +
        select(
          "gpuMode",
          "GPU 模式",
          { auto: "自動", high: "強制獨顯", low: "省電模式" },
          activeGpuMode,
        ) +
        (desktopHost
          ? '<button type="button" class="outline" data-action="desktop-restart">重啟 .exe 套用</button>'
          : "") +
        "</div>",
    ) +
    row(
      "TYPE SIZE",
      "字體大小",
      select(
        "font",
        "字體大小",
        { 90: "90%", 100: "100%", 110: "110%", 125: "125%" },
        prefs.font,
      ),
    ) +
    row(
      "ACCENT COLOR",
      "介面強調色",
      select(
        "accent",
        "介面強調色",
        { orange: "科技橘", amber: "琥珀", slate: "鋼藍" },
        prefs.accent,
      ),
    ) +
    platformAccountsSection() +
    '<details class="setting-shortcuts"><summary>鍵盤快捷鍵</summary><p>/ 搜尋　Space 播放或暫停　J / K 前後曲目　M 靜音</p></details>'
  );
}
function allLibraryTracks() {
  const tracks = library.state.tracks;
  const playing = player.state.track;
  return playing && !tracks.some((track) => track.key === playing.key)
    ? [playing, ...tracks]
    : tracks.length
      ? tracks
      : [observatory];
}
function sceneTracks() {
  return resolveSceneTracks(
    homeScope,
    byKeys(library.state.favorites),
    library.state.tracks,
    observatory,
    player.state.track,
  );
}
function syncHomeScopeUI() {
  const favorites = byKeys(library.state.favorites);
  const active = effectiveHomeScope(homeScope, favorites.length);
  if (favorites.length === 0) homeScope = "all";
  const favBtn = $<HTMLButtonElement>('[data-action="home-scope-favorites"]');
  const allBtn = $<HTMLButtonElement>('[data-action="home-scope-all"]');
  favBtn.setAttribute("aria-pressed", String(active === "favorites"));
  favBtn.disabled = favorites.length === 0;
  allBtn.setAttribute("aria-pressed", String(active === "all"));
  $("#scope-fav-count").textContent = String(favorites.length);
  $("#scope-all-count").textContent = String(allLibraryTracks().length);
}
function setHomeScope(next: HomeScope) {
  const favorites = byKeys(library.state.favorites);
  if (next === "favorites" && favorites.length === 0) {
    homeScope = "all";
    syncHomeScopeUI();
    notify("目前沒有收藏歌曲");
    return;
  }
  homeScope = next;
  const list = sceneTracks();
  if (!list.some((track) => track.key === inspectedTrack.key) && list[0]) {
    showRecord(list[0]);
  } else {
    showRecord(inspectedTrack);
  }
  if (view === "home") displayTracks = list;
  wall?.setTracks(list, inspectedTrack);
  syncHomeScopeUI();
}
function setWorkspace(mode: typeof workspaceMode) {
  if (workspaceMode === mode) return;
  if (workspace.open) workspace.close();
  workspaceMode = mode;
  if (mode === "modal") workspace.showModal();
  if (mode === "panel") workspace.show();
}
function renderPage(animate = false) {
  root.dataset.view = view;
  $("#saved-count").textContent = String(
    library.state.favorites.length,
  ).padStart(2, "0");
  syncHomeScopeUI();
  if (view !== "home" && view !== "library") displayTracks = [];
  const name = views.find((item) => item[0] === view)?.[2] ?? "";
  if (view === "home") {
    displayTracks = sceneTracks();
    page.replaceChildren();
  } else if (view === "search") page.innerHTML = searchPage();
  else if (view === "playlists") page.innerHTML = playlistPage();
  else if (view === "platforms")
    page.innerHTML =
      "<h1>平台管理</h1>" +
      sourceCards(true) +
      platformAccountsSection() +
      '<div class="info-panel"><h2>播放與匯入說明</h2><p>在桌面版 .exe 可透過內建串流代理播放 YouTube、YouTube Music、SoundCloud、Bandcamp、Mixcloud、Vimeo、Twitch 及直連音訊（MP3/FLAC/M4A/OGG/OPUS），並支援公開播放清單匯入與長時間自動續傳。</p></div>';
  else if (view === "settings") page.innerHTML = preferencesPage();
  else {
    const tracks =
      view === "favorites"
        ? byKeys(library.state.favorites)
        : view === "recent"
          ? byKeys(library.state.recent.map((item) => item.key))
          : allLibraryTracks();
    displayTracks =
      selectedAlbum && view === "library"
        ? tracks.filter((track) => albumKey(track) === selectedAlbum)
        : tracks;
    const libraryBatchControls =
      view === "library" && tracks.length
        ? librarySelectMode
          ? '<div class="batch-bar">' +
            textButton("全選", "library-select-all", "list") +
            textButton("取消全選", "library-select-none", "close") +
            '<button type="button" class="solid" data-action="library-delete-selected"' +
            (selectedLibraryKeys.size ? "" : " disabled") +
            ">刪除已選 (" +
            selectedLibraryKeys.size +
            ")</button>" +
            textButton("完成", "library-select-done", "close") +
            "</div>"
          : '<div class="batch-bar">' +
            (selectedAlbum
              ? textButton("所有專輯", "album-back", "library")
              : "") +
            textButton("在 3D 牆顯示全部", "home-scope-all-view", "library") +
            textButton("批量選擇", "library-select-mode", "list") +
            "</div>"
        : view === "favorites" && tracks.length
          ? '<div class="batch-bar">' +
            textButton("在 3D 牆顯示收藏", "home-scope-favorites-view", "heart") +
            "</div>"
          : selectedAlbum
            ? textButton("所有專輯", "album-back", "library")
            : "";
    page.innerHTML =
      "<h1>" +
      esc(name) +
      "</h1>" +
      libraryBatchControls +
      (displayTracks.length
        ? rowList(displayTracks, false, view === "library" && librarySelectMode)
        : nothing("目前沒有歌曲", "匯入音樂或收藏歌曲後即可在這裡瀏覽。")) +
      (view === "library" && !selectedAlbum && tracks.length
        ? albumWall(tracks)
        : "");
  }
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    ".music-nav [data-view]",
  )) {
    if (button.dataset.view === view)
      button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  if (view !== "home") {
    page.querySelector("h1")?.setAttribute("id", "workspace-title");
    $("#workspace-kicker").textContent =
      view === "settings"
        ? "RHINE LAB / SYSTEM PREFERENCES"
        : "RHINE LAB / MUSIC INDEX";
  }
  setWorkspace(
    view === "settings" ? "modal" : view === "home" ? "closed" : "panel",
  );
  if (view !== "home") page.scrollTop = viewScroll.get(view) ?? 0;
  if (animate) transition.reveal(page, reduced());
  if (view === "settings") updateRenderResolutionReadout();
  hydrateArtwork(page);
  if (view === "home" || view === "library") {
    const list = sceneTracks();
    if (!list.some((track) => track.key === inspectedTrack.key) && list[0])
      showRecord(list[0]);
    if (wall) wall.setTracks(list, inspectedTrack);
    syncPreferences();
  }
}
function closeWorkspace() {
  const targetView = view === "settings" ? settingsReturnView : "home";
  const focusTarget =
    view === "settings" ? settingsReturnFocus : panelReturnFocus;
  if (view === "settings") settingsReturnFocus = null;
  else panelReturnFocus = null;
  navigate(targetView, false);
  if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  else $("#music-content").focus();
}
function navigate(next: View, focus = false) {
  finishRecordRollers();
  if (view !== "home") viewScroll.set(view, page.scrollTop);
  const previousView = view;
  if (previousView === "home" && next !== "home" && next !== "settings") {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      panelReturnFocus = active;
    }
  }
  if (next === "settings" && previousView !== "settings") {
    settingsReturnView = previousView;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) {
      settingsReturnFocus = active;
    }
  }
  view = next;
  if (next === "library" || previousView === "library") {
    const inspection = next !== "library";
    wall?.inspect(inspection);
    root.querySelector<HTMLElement>('[data-action="wall-inspect"]')?.setAttribute(
      "aria-pressed",
      String(inspection),
    );
  }
  if (location.hash !== "#" + next) history.pushState(null, "", "#" + next);
  renderPage(true);
  closeMenu();
  if (focus && view === "search")
    $<HTMLInputElement>("#full-search input").focus();
  else if (focus && view === "home") $("#music-content").focus();
}
workspace.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeWorkspace();
});
function hashView() {
  const id = location.hash.slice(1);
  return views.find((option) => option[0] === id)?.[0] ?? "home";
}
window.addEventListener("popstate", () => {
  if (dialog.open) dialog.close();
  if (menuOpen) closeMenu();
  if (view !== "home") viewScroll.set(view, page.scrollTop);
  const previousView = view;
  view = hashView();
  if (view === "library" || previousView === "library") {
    const inspection = view !== "library";
    wall?.inspect(inspection);
    root.querySelector<HTMLElement>('[data-action="wall-inspect"]')?.setAttribute(
      "aria-pressed",
      String(inspection),
    );
  }
  renderPage(true);
  if (previousView === "settings" && view !== "settings") {
    const target = settingsReturnFocus;
    settingsReturnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  } else if (previousView !== "home" && view === "home") {
    const target = panelReturnFocus;
    panelReturnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
    else $("#music-content").focus();
  }
});

async function runSearch(value: string, filter = searchFilter) {
  searchAbort?.abort();
  const request = (searchAbort = new AbortController());
  query = value.trim();
  searchFilter = filter;
  searchStatus = query ? "搜尋中…" : "";
  searchItems = query
    ? library.state.tracks.filter(
        (track) =>
          (filter === "all" || track.source === filter) &&
          [track.title, track.artist, track.album, track.id].some((text) =>
            text.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
          ),
      )
    : [];
  navigate("search");
  if (!query) return;
  const jobs: Array<readonly [string, Promise<Track[]>]> = [];
  const messages: string[] = [];
  const use = (source: Source) => filter === "all" || filter === source;
  if (use("youtube")) {
    if (youtubeConfigured)
      jobs.push(["YouTube", searchYouTube(query, request.signal)]);
    else messages.push("YouTube 站內搜尋需要 API 金鑰");
  }
  const outcomes = await Promise.allSettled(jobs.map(([, result]) => result));
  if (request.signal.aborted) return;
  const results = new Map(searchItems.map((track) => [track.key, track]));
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      for (const track of outcome.value) results.set(track.key, track);
    } else
      messages.push(
        jobs[index][0] +
          "：" +
          (outcome.reason instanceof Error
            ? outcome.reason.message
            : "搜尋失敗"),
      );
  });
  searchItems = [...results.values()];
  searchStatus = messages.join(" · ");
  if (view === "search") {
    displayTracks = searchItems;
    $("#search-status").textContent = searchStatus;
    $("#search-results").innerHTML = searchResults();
    hydrateArtwork($("#search-results"));
  }
}
async function start(track: Track, queue?: Track[]) {
  if (queue?.length) player.setQueue(queue);
  if (view !== "home" && track.source === "youtube" && !desktopHost)
    navigate("home");
  // Keep metadata for queue entries across reloads, even when a track came from search.
  void library
    .remember(
      player.queue.some((item) => item.key === track.key)
        ? player.queue
        : [...player.queue, track],
    )
    .then(() => {
      if (view === "home" || view === "library") renderPage();
    })
    .catch(failure);
  const position =
    player.state.track?.key === track.key &&
    ["idle", "error"].includes(player.state.status)
      ? player.state.time
      : undefined;
  const promise = player.select(track, undefined, { position });
  if (track.source === "youtube" && !desktopHost) {
    const box = video.getBoundingClientRect();
    if (box.bottom > innerHeight || box.top < 0)
      video.scrollIntoView({ block: "center", behavior: "instant" });
  }
  await promise;
}
async function importFiles(files: File[]) {
  if (!files.length) return;
  await startup;
  notify("正在匯入 " + files.length + " 個檔案…");
  const added: Track[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      added.push(await library.import(file));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (added.length) {
    showRecord(added[0]);
    if (view === "home" || view === "settings") navigate("library");
    else renderPage();
  }
  notify(
    [
      added.length ? "已匯入 " + added.length + " 首" : "",
      ...errors.slice(0, 3),
    ]
      .filter(Boolean)
      .join(" · "),
  );
}
async function saveImportedPlaylist(
  name: string,
  tracks: Track[],
  openPlaylist = true,
) {
  await library.remember(tracks);
  const existing = library.state.playlists.find((p) => p.name === name);
  const keys = tracks.map((t) => t.key);
  let targetId: string;
  if (existing) {
    existing.tracks = [...new Set([...existing.tracks, ...keys])];
    targetId = existing.id;
  } else {
    targetId = crypto.randomUUID();
    library.state.playlists.push({
      id: targetId,
      name,
      tracks: keys,
    });
  }
  save();
  if (openPlaylist) {
    playlistId = targetId;
    navigate("playlists");
  } else {
    renderPage();
  }
}

async function importLink(input: string, title: string) {
  await startup;
  if (isDrmPlatformUrl(input)) {
    throw new Error("此串流平台受 DRM 版權與帳號授權保護，無法透過公開代理串流播放。");
  }
  const track = parseTrackLink(input);
  const playlist = youtubePlaylistId(input);
  if (playlist && (!track || !title)) {
    const imported = await importYouTubePlaylist(
      playlist,
      undefined,
      track?.id,
    );
    if (!imported.tracks.length) throw new Error("找不到可匯入的公開影片");
    await saveImportedPlaylist(
      title || imported.name,
      imported.tracks,
      true,
    );
    return "已匯入 " + imported.tracks.length + " 首 YouTube 影片";
  }
  if (isSupportedStreamPlaylist(input)) {
    const imported = await importStreamPlaylist(input.trim());
    if (!imported.tracks.length) throw new Error("找不到可匯入的公開曲目");
    await saveImportedPlaylist(
      title || imported.name,
      imported.tracks,
      true,
    );
    return "已匯入 " + imported.tracks.length + " 首串流曲目";
  }
  if (!track)
    throw new Error("請輸入可辨識的音訊或影片連結（YouTube、SoundCloud、Bandcamp、Mixcloud、直連音訊等）");
  let enriched = track;
  let message = "";
  try {
    enriched = await enrichTrack(track);
  } catch (err) {
    if (track.source === "stream" && !/\.(mp3|m4a|flac|ogg|opus|wav|aac|webm)(\?|$)/i.test(track.url ?? "")) {
      throw err;
    }
    message = " · 平台資訊暫時無法取得";
  }
  if (title) enriched = { ...enriched, title, customTitle: true };
  await library.remember([enriched]);
  renderPage();
  return "已匯入 " + enriched.title + message;
}
function favorite(track: Track) {
  const keys = library.state.favorites;
  const index = keys.indexOf(track.key);
  if (index < 0) {
    keys.push(track.key);
    void library
      .remember([track])
      .then(() => renderPage())
      .catch(failure);
  } else {
    keys.splice(index, 1);
    if (keys.length === 0) homeScope = "all";
  }
  save();
  if (view === "favorites" || view === "home" || view === "library")
    renderPage();
  else {
    syncHomeScopeUI();
    wall?.setTracks(sceneTracks(), inspectedTrack);
  }
  const marked = keys.includes(track.key);
  $("#saved-count").textContent = String(keys.length).padStart(2, "0");
  for (const control of root.querySelectorAll<HTMLButtonElement>(
    "[data-favorite]",
  ))
    if (control.dataset.favorite === track.key)
      control.setAttribute("aria-pressed", String(marked));
  if (inspectedTrack.key === track.key)
    $('[data-action="now-favorite"]').setAttribute(
      "aria-pressed",
      String(marked),
    );
}
function showDialog(title: string, content: string) {
  if (!dialog.open && document.activeElement instanceof HTMLElement) {
    dialogReturnFocus = document.activeElement;
  }
  dialog.innerHTML =
    '<div class="section-head"><h2 id="dialog-title">' +
    title +
    "</h2>" +
    button("close", "close", "關閉") +
    "</div>" +
    content +
    '<p class="dialog-error" role="alert"></p>';
  dialog.setAttribute("aria-labelledby", "dialog-title");
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLElement>("[autofocus]")?.focus();
}
dialog.addEventListener("close", () => {
  const focusTarget = dialogReturnFocus;
  dialogReturnFocus = null;
  if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
});
function showLinkForm(source?: string) {
  const extra =
    source === "youtube"
      ? "<p>支援 YouTube 公開播放清單（含 list=）與影片連結（含 youtu.be、music.youtube.com）。</p>"
      : "<p>支援 YouTube、SoundCloud、Bandcamp、Mixcloud、Vimeo、Twitch 與直連音訊網址。</p>";
  showDialog(
    "匯入平台連結",
    extra +
      '<form id="link-form" class="stack-form"><label>YouTube 連結（影片或公開播放清單）<input name="link" required autofocus></label>' +
      '<label>顯示名稱 <small>選填</small><input name="title" maxlength="120"></label><p>貼上公開播放清單或單曲連結即可自動匯入。</p><button class="solid">匯入連結</button></form>',
  );
}
function playlistDialog(list?: Playlist) {
  showDialog(
    list ? "編輯播放清單" : "建立播放清單",
    '<form id="playlist-form" class="stack-form" data-list="' +
      esc(list?.id ?? "") +
      '">' +
      '<label>清單名稱<input name="name" value="' +
      esc(list?.name ?? "") +
      '" maxlength="100" required autofocus></label>' +
      (list
        ? '<ol class="edit-list">' +
          byKeys(list.tracks)
            .map(
              (track, index) =>
                "<li><span>" +
                esc(track.title) +
                "</span>" +
                '<button type="button" data-reorder="' +
                index +
                '" data-direction="-1" aria-label="上移 ' +
                esc(track.title) +
                '">↑</button>' +
                '<button type="button" data-reorder="' +
                index +
                '" data-direction="1" aria-label="下移 ' +
                esc(track.title) +
                '">↓</button>' +
                '<button type="button" data-remove-track="' +
                index +
                '" aria-label="移除 ' +
                esc(track.title) +
                '">×</button></li>',
            )
            .join("") +
          "</ol>"
        : "") +
      '<div class="official-links"><button class="solid">儲存清單</button>' +
      (list
        ? '<button type="button" class="outline" data-action="playlist-delete">刪除清單</button>'
        : "") +
      "</div></form>",
  );
}
function trackMenu(track: Track) {
  const listOptions = library.state.playlists
    .map(
      (list) =>
        '<option value="' + esc(list.id) + '">' + esc(list.name) + "</option>",
    )
    .join("");
  showDialog(
    esc(track.title),
    '<div class="stack-form"><button class="outline" data-add-queue="' +
      esc(track.key) +
      '">加入播放佇列</button>' +
      (listOptions
        ? '<form id="add-to-list" data-track="' +
          esc(track.key) +
          '" class="inline-form"><label class="grow">播放清單<select name="playlist">' +
          listOptions +
          '</select></label><button class="solid">加入清單</button></form>'
        : textButton("建立清單", "playlist-new")) +
      ('<button class="outline" data-attach-lyrics="' +
        esc(track.key) +
        '">匯入 LRC 歌詞</button>') +
      ('<button class="outline" data-upload-artwork="' +
        esc(track.key) +
        '">上傳自訂封面</button>') +
      (library.hasCustomArtwork(track.key)
        ? '<button class="outline" data-remove-artwork="' +
          esc(track.key) +
          '">移除自訂封面</button>'
        : "") +
      (track.url
        ? anchor(track.url, "在 " + sourceNames[track.source] + " 開啟")
        : "") +
      (library.find(track.key)
        ? '<button class="outline" data-remove-library="' +
          esc(track.key) +
          '">移出音樂庫</button>'
        : "") +
      "</div>",
  );
}

function renderPanel(force = false) {
  if (right.contains(canvas) && (force || panel !== "details"))
    $(".spectrum-source").append($("#spectrum-label"), canvas);
  if (panel === "queue") {
    const stamp =
      player.queue.map((track) => track.key).join("|") +
      "@" +
      player.state.track?.key;
    if (!force && renderQueueStamp === stamp) return;
    renderQueueStamp = stamp;
    queueCounter.update({ value: player.queue.length, animated: !reduced() });
    right.innerHTML = player.queue.length
      ? rowList(player.queue, true)
      : '<p class="muted">佇列是空的。播放歌曲後會在此列出。</p>';
    hydrateArtwork(right);
    return;
  }
  if (!force) return;
  const track = inspectedTrack;
  if (panel === "details") {
    const hasCustomArt = library.hasCustomArtwork(track.key);
    right.innerHTML =
      '<p class="detail-kicker mono">TRACK OVERVIEW / 曲目簡介</p><p>' +
      (track.key === observatory.key
        ? "RhineLabUI 原創配樂，可直接試聽。"
        : track.source === "local"
          ? "已匯入本機音樂庫。"
          : esc(sourceNames[track.source]) + " 平台曲目。") +
      '</p><div class="official-links"><button type="button" class="outline" data-upload-artwork="' +
      esc(track.key) +
      '">' +
      icon("upload") +
      " 上傳自訂封面</button>" +
      (hasCustomArt
        ? '<button type="button" class="outline" data-remove-artwork="' +
          esc(track.key) +
          '">恢復預設封面</button>'
        : "") +
      '</div><div id="spectrum-panel"></div>';
    $("#spectrum-panel").append($("#spectrum-label"), canvas);
    ensureSpectrumLoop();
    return;
  }
  if (panel === "notes") {
    const notes = library.state.notes[track.key];
    right.innerHTML =
      '<p class="detail-kicker mono">TRACK NOTES / 曲目筆記</p><p class="track-note">' +
      esc(notes || "還沒有筆記。點選「編輯筆記」記下聆聽心得、來源或歌詞。") +
      "</p>";
    return;
  }
  if (panel === "history") {
    const entry = library.state.recent.find((item) => item.key === track.key);
    right.innerHTML =
      '<p class="detail-kicker mono">PLAY HISTORY / 播放記錄</p><p>' +
      (entry
        ? "最近播放　" + esc(new Date(entry.when).toLocaleString("zh-TW"))
        : "目前沒有播放記錄。") +
      '</p><div class="official-links"><button class="outline" data-view="recent">所有播放記錄</button></div>';
    return;
  }
  const synced = activeLyrics.some((line) => line.time >= 0);
  right.innerHTML =
    (activeLyrics.length
      ? '<ol class="lyrics">' +
        activeLyrics
          .map(
            (line) =>
              "<li>" +
              (line.words
                ? line.words
                    .map((word) => "<span>" + esc(word.text) + "</span>")
                    .join("")
                : esc(line.text)) +
              "</li>",
          )
          .join("") +
        "</ol>"
      : '<p class="muted">目前沒有歌詞。可匯入 LRC 檔案，或讀取本機歌曲內嵌的歌詞。</p>') +
    (activeLyrics.length && !synced
      ? '<p class="muted">此歌詞沒有時間標記。</p>'
      : "") +
    (player.state.track ? textButton("匯入 LRC 歌詞", "lyrics-import") : "");
  activeLine = -2;
  activeWord = -2;
  highlightLyrics();
}
function highlightLyrics() {
  if (panel !== "lyrics" || !activeLyrics.some((line) => line.time >= 0))
    return;
  const lines = right.querySelectorAll<HTMLLIElement>(".lyrics li");
  const index = lyricAt(activeLyrics, player.state.time);
  if (index !== activeLine) {
    lines[activeLine]?.removeAttribute("aria-current");
    lines[index]?.setAttribute("aria-current", "true");
    const container = right.querySelector<HTMLElement>(".lyrics");
    if (container && lines[index])
      container.scrollTop =
        lines[index].offsetTop -
        container.offsetTop -
        container.clientHeight * 0.28;
    activeLine = index;
    activeWord = -2;
  }
  const words = activeLyrics[index]?.words;
  if (words) {
    const word = lyricAt(words, player.state.time);
    if (word !== activeWord) {
      const parts = lines[index].querySelectorAll("span");
      parts[activeWord]?.classList.remove("word");
      parts[word]?.classList.add("word");
      activeWord = word;
    }
  }
}
const prewarmedUrls = new Map<string, number>();
function prewarmTrack(track?: Track) {
  if (!track) return;
  if (track.source === "local") {
    void library.getAudioUrl(track.key).catch(() => {});
    return;
  }
  if (!desktopHost) return;
  const now = Date.now();
  const q = encodeURIComponent(library.state.prefs.audioQuality);
  let endpoint = "";
  if (track.source === "youtube" && track.id) {
    endpoint = "/__rhine/yt-prewarm?v=" + encodeURIComponent(track.id) + "&q=" + q;
  } else if (track.source === "stream") {
    const targetUrl = track.url || track.id;
    if (/^https?:\/\//i.test(targetUrl)) {
      endpoint = "/__rhine/stream-prewarm?url=" + encodeURIComponent(targetUrl) + "&q=" + q;
    }
  }
  if (!endpoint) return;
  const last = prewarmedUrls.get(endpoint) ?? 0;
  if (now - last < 15 * 60 * 1000) return;
  prewarmedUrls.set(endpoint, now);
  if (prewarmedUrls.size > 64) {
    const oldest = prewarmedUrls.keys().next().value;
    if (oldest !== undefined) prewarmedUrls.delete(oldest);
  }
  void fetch(endpoint, { keepalive: true }).catch(() => {
    prewarmedUrls.delete(endpoint);
  });
}
let prewarmAdjacentTimer: number | undefined;
function prewarmAdjacentTracks(center?: Track, list = sceneTracks()) {
  if (!list.length) return;
  const idx = center ? list.findIndex((item) => item.key === center.key) : 0;
  const base = idx >= 0 ? idx : 0;
  const offsets = [1, -1, 2, 3];
  for (const offset of offsets) {
    const item = list[(base + offset + list.length) % list.length];
    prewarmTrack(item);
  }
}
function scheduleAdjacentPrewarm(center?: Track, list = sceneTracks()) {
  if (prewarmAdjacentTimer !== undefined) clearTimeout(prewarmAdjacentTimer);
  prewarmAdjacentTimer = window.setTimeout(() => {
    prewarmAdjacentTimer = undefined;
    prewarmAdjacentTracks(center, list);
  }, 1000);
}

function handleWallSelection(track: Track, userInitiated = false) {
  showRecord(track);
  if (!userInitiated) return;
  cancelWallAutoPlay();
  prewarmTrack(track);
  wallSwitchTimer = window.setTimeout(() => {
    wallSwitchTimer = undefined;
    if (view !== "home") return;
    if (
      player.state.track?.key !== track.key ||
      (player.state.status !== "playing" && player.state.status !== "loading")
    ) {
      void player.select(track, sceneTracks(), { autoplay: true });
    }
  }, 500);
}

let seekDragging = false;
let previousRecordIndex = 1;
function showRecord(track: Track) {
  const previousKey = inspectedTrack.key;
  inspectedTrack = track;
  const revision = ++artworkRevision;
  const list = sceneTracks();
  const index = list.findIndex((item) => item.key === track.key);
  const numVal = Math.max(1, index + 1);
  const source =
    track.source === "local"
      ? "LOCAL FILE"
      : sourceNames[track.source].toUpperCase();
  const animateRoll = ready && view === "home" && !reduced();
  const direction =
    numVal > previousRecordIndex
      ? "up"
      : numVal < previousRecordIndex
        ? "down"
        : "auto";
  previousRecordIndex = numVal;
  objectCodeCounter.update({ value: numVal, animated: animateRoll, direction });
  recordCodeCounter.update({ value: numVal, animated: animateRoll, direction });
  heroTitleRoller.update({ text: source, animated: animateRoll });
  nowSourceRoller.update({ text: source, animated: animateRoll });
  const titleEl = $("#now-title");
  if (titleEl.textContent !== track.title) {
    titleEl.textContent = track.title;
    if (animateRoll) {
      titleEl.classList.remove("now-title-animate");
      void titleEl.offsetWidth;
      titleEl.classList.add("now-title-animate");
    } else {
      titleEl.classList.remove("now-title-animate");
    }
  }
  if (!animateRoll) finishRecordRollers();
  $("#now-artist").textContent = track.album;
  $("#track-artist").textContent = track.artist || "—";
  $("#track-album").textContent = track.album || "—";
  $("#track-release").textContent =
    track.year === undefined ? "—" : String(track.year);
  $("#track-duration").textContent = track.duration
    ? formatTime(track.duration)
    : "—";
  const setNowArt = (art?: string) => {
    const node = $("#now-art");
    node.innerHTML = cover(track, art);
    node.style.aspectRatio = "";
    const img = node.querySelector("img");
    if (img) {
      const fit = () => {
        if (img.naturalWidth && img.naturalHeight)
          node.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      };
      if (img.complete) fit();
      else img.addEventListener("load", fit, { once: true });
    }
  };
  setNowArt(track.artwork);
  $("#now-platform").innerHTML = track.url
    ? anchor(track.url, "在 " + sourceNames[track.source] + " 開啟")
    : "";
  $('[data-action="now-favorite"]').setAttribute(
    "aria-pressed",
    String(library.state.favorites.includes(track.key)),
  );
  syncRecordPlayback();
  renderPanel(true);
  if (animateRoll && previousKey !== track.key) {
    panelTransition.reveal(right, reduced());
  }
  void library
    .artwork(track)
    .then((art) => {
      if (art && revision === artworkRevision) setNowArt(art);
    })
    .catch(failure);
}
function syncRecordPlayback() {
  const { track, status, duration } = player.state;
  const same = track?.key === inspectedTrack.key;
  if (same && duration) $("#track-duration").textContent = formatTime(duration);
  const statusBar = $("#record-status-bar");
  const statusText = $("#record-status");
  const jumpButton = $("#jump-playing");
  let nextStatusText = "正在查看";
  let nextBarState = "viewing";
  let nextJumpHidden = true;
  if (track) {
    if (same) {
      nextStatusText =
        status === "playing"
          ? "正在播放此曲目"
          : status === "paused"
            ? "已暫停此曲目"
            : status === "loading"
              ? "正在載入此曲目"
              : "已載入此曲目";
      nextBarState = status === "playing" ? "playing" : "loaded";
      nextJumpHidden = true;
    } else {
      nextStatusText =
        "正在查看 · 背景" +
        (status === "playing" ? "播放中：" : "已暫停：") +
        track.title;
      nextBarState = "other";
      nextJumpHidden = false;
    }
  }
  if (statusText.textContent !== nextStatusText)
    statusText.textContent = nextStatusText;
  if (statusBar.dataset.state !== nextBarState)
    statusBar.dataset.state = nextBarState;
  if (jumpButton.hidden !== nextJumpHidden) jumpButton.hidden = nextJumpHidden;
  const control = $<HTMLButtonElement>('[data-action="track-play"]');
  const playing = same && status === "playing";
  const disabled = same && (status === "external" || status === "loading");
  if (control.disabled !== disabled) control.disabled = disabled;
  if (control.dataset.playing !== String(playing)) {
    control.dataset.playing = String(playing);
    control.innerHTML = playing
      ? "Ⅱ PAUSE <span>暫停</span>"
      : "▶ PLAY <span>播放</span>";
    control.setAttribute("aria-label", playing ? "暫停所選曲目" : "播放所選曲目");
  }
  const audioBadge = root.querySelector<HTMLElement>("#track-audio-info");
  if (audioBadge) {
    const targetLabel: Record<string, string> = {
      auto: "自動",
      standard: "標準 128k",
      high: "高畫質 256k",
      very_high: "極高 320k",
      lossless: "無損 FLAC/ALAC",
    };
    const info = same
      ? player.state.audioInfo ?? inspectedTrack.audioInfo
      : inspectedTrack.audioInfo;
    const parts: string[] = [];
    if (info?.codec || info?.ext)
      parts.push(String(info.codec || info.ext).toUpperCase());
    if (info?.bitrateKbps) parts.push(`${info.bitrateKbps} kbps`);
    if (info?.sampleRateHz)
      parts.push(`${(info.sampleRateHz / 1000).toFixed(1)} kHz`);
    if (info?.bitDepth) parts.push(`${info.bitDepth}-bit`);
    if (info?.lossless) parts.push("無損");
    const actual = parts.length
      ? parts.join(" · ")
      : info?.detail
        ? info.detail
        : inspectedTrack.source === "youtube" && !desktopHost
          ? "YouTube 自適應串流"
          : "依來源原始格式";
    audioBadge.textContent = `目標音質：${targetLabel[library.state.prefs.audioQuality] ?? "自動"} ｜ 實際輸出：${actual}`;
    audioBadge.hidden = false;
  }
}
function updateSpectrumLabel() {
  const { track, status } = player.state;
  const analyser = status === "playing" ? player.adapter?.analyser : undefined;
  const externalOnly = Boolean(
    track &&
      track.source === "youtube" &&
      !(player.adapter instanceof YouTubeAdapter && player.adapter.isAudioOnly) &&
      !desktopHost,
  );
  $("#spectrum-label").textContent = analyser
    ? "音訊頻譜 · 即時波形"
    : externalOnly
      ? "外部播放器 · 無音訊分析"
      : "音訊頻譜 · 待機";
}
async function updateCurrent(track?: Track) {
  currentTrack = track;
  $("#mini-art").innerHTML = cover(track, track?.artwork);
  $("#mini-title").textContent = track?.title ?? "尚未播放";
  $("#mini-source").textContent = track
    ? [track.artist, track.album, sourceNames[track.source]]
        .filter(Boolean)
        .join(" ／ ")
    : "RHINE LAB MUSIC";
  updateSpectrumLabel();
  activeLyrics = [];
  if (track) showRecord(track);
  wall?.setTracks(sceneTracks(), inspectedTrack);
  renderPanel(true);
  if (!track) {
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    return;
  }
  syncMediaSession(track);
  try {
    const [art, lyrics] = await Promise.all([
      library.artwork(track),
      library.getLyrics(track.key),
    ]);
    if (currentTrack !== track) return;
    if (art) {
      $("#mini-art").innerHTML = cover(track, art);
      syncMediaSession(track, art);
    }
    activeLyrics = lyrics ?? [];
    if (panel === "lyrics") renderPanel(true);
  } catch (error) {
    failure(error);
  }
}
function syncMediaSession(track: Track, artwork?: string) {
  if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined")
    return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork:
      artwork && /^(https:\/\/|blob:)/.test(artwork) ? [{ src: artwork }] : [],
  });
}
function playbackControls() {
  const { track, status, time, duration, message } = player.state;
  if (currentTrack !== track) void updateCurrent(track);
  const stateStamp = [
    track?.key,
    status,
    message,
    player.queue.length,
    player.repeat,
    player.shuffle,
    player.muted,
    Boolean(duration),
  ].join("|");
  if (stateStamp !== lastStatus) {
    lastStatus = stateStamp;
    updateSpectrumLabel();
    const playing = status === "playing";
    const hasVideo = Boolean(
      track &&
      track.source === "youtube" &&
      !(player.adapter instanceof YouTubeAdapter && player.adapter.isAudioOnly) &&
      !(desktopHost && status === "loading") &&
      !["error", "idle"].includes(status),
    );
    video.hidden = !hasVideo;
    $("#now-art").hidden = hasVideo;
    if (hasVideo && status === "loading") {
      if (view !== "home") navigate("home");
      const box = video.getBoundingClientRect();
      if (box.bottom > innerHeight || box.top < 0)
        video.scrollIntoView({ block: "center", behavior: "instant" });
    }
    const playLabel = playing
      ? "暫停"
      : status === "error"
        ? "重試播放"
        : status === "idle" && track
          ? "載入播放器"
          : "播放";
    const control = $<HTMLButtonElement>('[data-action="play"]');
    control.innerHTML = icon(playing ? "pause" : "play");
    control.setAttribute("aria-label", playLabel);
    control.title =
      status === "external" ? (message ?? "使用平台播放器") : playLabel;
    control.disabled =
      status === "loading" ||
      status === "external" ||
      (!track && !player.queue.length);
    const canVolume =
      Boolean(player.adapter?.volume) &&
      !["loading", "external", "error"].includes(status);
    $<HTMLInputElement>("#volume").disabled = !canVolume;
    const mute = $<HTMLButtonElement>('[data-action="mute"]');
    mute.disabled = !canVolume;
    mute.innerHTML = icon(player.muted ? "mute" : "volume");
    mute.setAttribute("aria-label", player.muted ? "取消靜音" : "靜音");
    mute.setAttribute("aria-pressed", String(player.muted));
    $("#volume").title = canVolume ? "播放音量" : "此來源無法由站內調整音量";
    $('[data-action="shuffle"]').setAttribute(
      "aria-pressed",
      String(player.shuffle),
    );
    const repeatButton = $('[data-action="repeat"]');
    const repeat = { off: "關閉", one: "單曲", all: "清單" }[player.repeat];
    repeatButton.setAttribute("aria-label", "循環模式：" + repeat);
    repeatButton.title = "循環模式：" + repeat;
    repeatButton.dataset.repeat = player.repeat;
    repeatButton.setAttribute("aria-pressed", String(player.repeat !== "off"));
    const canStepTrack =
      player.queue.length > 0 ||
      sceneTracks().length > 0 ||
      library.state.tracks.length > 0;
    $<HTMLButtonElement>('[data-action="previous"]').disabled = !canStepTrack;
    $<HTMLButtonElement>('[data-action="next"]').disabled = !canStepTrack;
    const statusNode = $("#transport-status");
    statusNode.textContent =
      message ?? (status === "loading" ? "正在載入播放器…" : "");
    statusNode.hidden = !statusNode.textContent;
    root.dataset.playback = status;
    for (const row of root.querySelectorAll<HTMLElement>("[data-track-row]"))
      row.classList.toggle("is-current", row.dataset.trackRow === track?.key);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing
        ? "playing"
        : ["paused", "ready", "ended"].includes(status)
          ? "paused"
          : "none";
      const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] =
        [
          ["play", player.adapter?.play ? () => void player.play() : null],
          ["pause", player.adapter?.pause ? () => player.pause() : null],
          ["previoustrack", () => stepTrack(-1)],
          ["nexttrack", () => stepTrack(1)],
          [
            "seekto",
            player.adapter?.seek
              ? (details) => player.seek(details.seekTime ?? time)
              : null,
          ],
        ];
      for (const [action, handler] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch {
          /* Optional browser action. */
        }
      }
    }
  }
  const stamp = formatTime(time);
  if (!seekDragging && stamp !== previousElapsed) {
    previousElapsed = stamp;
    elapsedNode.textContent = stamp;
  }
  if (duration !== previousDuration) {
    previousDuration = duration;
    $("#duration").textContent = formatTime(duration);
  }
  syncRecordPlayback();
  const seek = $<HTMLInputElement>("#seek");
  const seekDisabled =
    !duration ||
    !player.adapter?.seek ||
    ["loading", "external", "error"].includes(status);
  if (seekDisabled !== lastSeekDisabled) {
    lastSeekDisabled = seekDisabled;
    seek.disabled = seekDisabled;
    seek.title = seekDisabled ? "此來源目前無法由站內跳轉" : "播放進度";
  }
  const nextMax = String(duration || 1);
  if (nextMax !== lastSeekMax) {
    lastSeekMax = nextMax;
    seek.max = nextMax;
  }
  const valueText = formatTime(time) + " / " + formatTime(duration);
  if (!seekDragging && valueText !== lastAriaValueText) {
    lastAriaValueText = valueText;
    seek.setAttribute("aria-valuetext", valueText);
  }
  if (!seekDragging) {
    const safeTime = duration ? Math.max(0, Math.min(time, duration)) : 0;
    seek.value = String(safeTime);
    seek.style.setProperty(
      "--progress",
      (duration ? Math.min(100, (safeTime / duration) * 100) : 0) + "%",
    );
  }
  if (status === "playing") {
    scheduleAdjacentPrewarm(track, player.queue.length ? player.queue : sceneTracks());
  }
  ensureSpectrumLoop();
  const nextVolume = String(player.muted ? 0 : player.volume);
  if (nextVolume !== lastVolumeValue) {
    lastVolumeValue = nextVolume;
    const volInput = $<HTMLInputElement>("#volume");
    volInput.value = nextVolume;
    volInput.style.setProperty("--progress", Number(nextVolume) * 100 + "%");
  }
  if ("mediaSession" in navigator && duration > 0 && !seek.disabled) {
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(time, duration),
        playbackRate: 1,
      });
    } catch {
      /* Optional position API. */
    }
  }
  renderPanel();
  highlightLyrics();
  if (status === "playing" && track && latestPlayed !== track.key) {
    latestPlayed = track.key;
    library.state.recent = [
      { key: track.key, when: Date.now() },
      ...library.state.recent.filter((item) => item.key !== track.key),
    ].slice(0, 100);
    if (view === "home" || view === "recent") renderPage();
    if (panel === "history") renderPanel(true);
  }
  if (status === "loading") latestPlayed = "";
  if (
    ready &&
    track &&
    status !== "loading" &&
    status !== "idle" &&
    (Date.now() - lastStore > 2500 || status !== "playing")
  )
    persistSession();
}
function persistSession() {
  const { track, status, time } = player.state;
  if (!track || status === "loading" || status === "idle") return;
  const session = {
    key: track.key,
    position: time,
    queue: player.queue.map((item) => item.key),
  };
  if (JSON.stringify(session) === JSON.stringify(library.state.session)) return;
  lastStore = Date.now();
  library.state.session = session;
  save();
}
player.addEventListener("change", playbackControls);

let lyricsKey: string | undefined;
let playlistDraft: Playlist | undefined;
let menuOpen = false;
function closeMenu() {
  menuOpen = false;
  root.dataset.menu = "closed";
  $("#music-nav").hidden = true;
  $('[data-action="menu"]').setAttribute("aria-expanded", "false");
}
function stepTrack(direction: 1 | -1) {
  if (player.queue.length <= 1) {
    const fallback =
      sceneTracks().length > 1 ? sceneTracks() : allLibraryTracks();
    if (fallback.length) {
      player.setQueue(fallback);
    }
  }
  if (!player.state.track && player.queue.length) {
    const index = Math.max(
      0,
      player.queue.findIndex((item) => item.key === inspectedTrack.key),
    );
    const targetTrack =
      player.queue[
        (index + direction + player.queue.length) % player.queue.length
      ];
    if (targetTrack) void start(targetTrack, player.queue);
    return;
  }
  if (direction > 0) void player.next();
  else void player.previous();
}
function action(name: string, target: HTMLElement) {
  const track = player.state.track;
  const list = library.state.playlists.find((item) => item.id === playlistId);
  switch (name) {
    case "home-scope-favorites":
      setHomeScope("favorites");
      break;
    case "home-scope-all":
      setHomeScope("all");
      break;
    case "home-scope-favorites-view":
      setHomeScope("favorites");
      navigate("home", true);
      break;
    case "home-scope-all-view":
      setHomeScope("all");
      navigate("home", true);
      break;
    case "files":
      $<HTMLInputElement>("#music-files").click();
      break;
    case "link":
      showLinkForm(target.dataset.source);
      break;
    case "close":
      dialog.close();
      break;
    case "workspace-close":
      closeWorkspace();
      break;
    case "inspect-playing":
      if (player.state.track) {
        showRecord(player.state.track);
        if (view !== "home") navigate("home", true);
        else wall?.setTracks(sceneTracks(), inspectedTrack);
      }
      break;
    case "track-play":
      if (track?.key === inspectedTrack.key) void player.toggle();
      else void start(inspectedTrack, sceneTracks());
      break;
    case "track-options":
      trackMenu(inspectedTrack);
      break;
    case "edit-notes":
      showDialog(
        "編輯曲目筆記",
        '<form id="note-form" class="stack-form"><label>曲目筆記<textarea name="notes" maxlength="4000" rows="6" autofocus>' +
          esc(library.state.notes[inspectedTrack.key] ?? "") +
          '</textarea></label><button class="solid">儲存筆記</button></form>',
      );
      $<HTMLFormElement>("#note-form").dataset.key = inspectedTrack.key;
      break;
    case "play":
      cancelWallAutoPlay();
      if (
        view === "home" &&
        player.state.status !== "playing" &&
        inspectedTrack.key !== track?.key
      ) {
        void start(inspectedTrack, sceneTracks());
      } else if (
        track &&
        track.source === "youtube" &&
        ["idle", "error"].includes(player.state.status)
      ) {
        void start(track);
      } else void player.toggle();
      break;
    case "previous":
      cancelWallAutoPlay();
      stepTrack(-1);
      break;
    case "next":
      cancelWallAutoPlay();
      stepTrack(1);
      break;
    case "shuffle":
      player.setShuffle(!player.shuffle);
      library.state.prefs.shuffle = player.shuffle;
      save();
      break;
    case "repeat": {
      const values: Repeat[] = ["off", "all", "one"];
      player.setRepeat(
        values[(values.indexOf(player.repeat) + 1) % values.length],
      );
      library.state.prefs.repeat = player.repeat;
      save();
      break;
    }
    case "mute":
      if (player.adapter?.volume) {
        player.setVolume(player.volume, !player.muted);
        library.state.prefs.muted = player.muted;
        save();
      }
      break;
    case "wall-inspect":
      if (wall) target.setAttribute("aria-pressed", String(wall.inspect()));
      break;
    case "wall-reset": {
      wall?.resetView();
      const activeTrack = player.state.track;
      if (
        activeTrack &&
        activeTrack.key === inspectedTrack.key &&
        player.adapter
      ) {
        player.seek(0);
        if (player.state.status !== "playing") void player.play();
      } else {
        void start(inspectedTrack, sceneTracks());
      }
      notify("從頭播放：" + inspectedTrack.title);
      break;
    }
    case "win-minimize":
      sendWindowControl("minimize");
      break;
    case "win-maximize":
      sendWindowControl("toggle-maximize");
      break;
    case "win-close":
      sendWindowControl("close");
      break;
    case "replay-boot":
      if (workspace.open) closeWorkspace();
      void runBootIntro(root, { dark: dark(), reduced: reduced(), onReplay: true });
      break;
    case "desktop-diagnostics": {
      void getDesktopDiagnostics()
        .then((diag) => {
          if (!diag) {
            notify("無法讀取桌面診斷日誌");
            return;
          }
          showDialog(
            "GPU 與啟動診斷紀錄",
            `<p class="mono">GPU Mode: ${esc(diag.gpuMode)} ｜ Backend: ${esc(diag.renderBackend)}</p>` +
              `<p class="mono">Log: ${esc(diag.logPath)}</p>` +
              `<pre class="diag-log">${esc((diag.logs || []).join("\n") || "尚無紀錄")}</pre>`,
          );
        })
        .catch(failure);
      break;
    }
    case "spotify-login": {
      const inputEl = root.querySelector<HTMLInputElement>(
        '[data-pref="spotifyClientId"]',
      );
      const clientId =
        inputEl?.value.trim() ||
        library.state.prefs.spotifyClientId?.trim() ||
        defaultSpotifyClientId();
      if (clientId) {
        library.state.prefs.spotifyClientId = clientId;
        save();
      }
      void startSpotifyLogin(clientId).catch(failure);
      break;
    }
    case "spotify-sync":
      if (!spotifySession || spotifySyncing) break;
      spotifySyncing = true;
      renderPage();
      void syncSpotifyLibrary(spotifySession)
        .then(async ({ tracks, playlists }) => {
          if (tracks.length) await library.remember(tracks);
          for (const pl of playlists) {
            const existing = library.state.playlists.find(
              (item) => item.id === pl.id,
            );
            if (existing) existing.tracks = pl.tracks;
            else library.state.playlists.push(pl);
          }
          await library.save();
          notify(`已同步 Spotify：${tracks.length} 首曲目、${playlists.length} 個清單`);
        })
        .catch(failure)
        .finally(() => {
          spotifySyncing = false;
          if (view === "settings" || view === "platforms") renderPage();
        });
      break;
    case "spotify-logout":
      logoutSpotify();
      spotifySession = null;
      if (player.state.track?.source === "spotify") player.destroy();
      renderPage();
      notify("已登出 Spotify 帳號");
      break;
    case "wall-prev":
    case "wall-next": {
      const direction = name === "wall-prev" ? -1 : 1;
      if (wall) wall.step(direction);
      else {
        const tracks = sceneTracks();
        const index = tracks.findIndex(
          (item) => item.key === inspectedTrack.key,
        );
        handleWallSelection(
          tracks[
            (Math.max(0, index) + direction + tracks.length) % tracks.length
          ],
          true,
        );
      }
      break;
    }
    case "viewer":
      target.focus({ preventScroll: true });
      if (
        !wall?.openViewer(
          root,
          inspectedTrack,
          $("#record-number").textContent ?? "",
          dark(),
          reduced(),
        )
      )
        notify("啟用三維畫質後即可開啟 360° 模型。");
      break;
    case "now-favorite":
      favorite(inspectedTrack);
      break;
    case "lyrics-import":
      if (track) {
        lyricsKey = track.key;
        $<HTMLInputElement>("#music-lyrics").click();
      }
      break;
    case "playlist-new":
      playlistDraft = undefined;
      playlistDialog();
      break;
    case "playlist-edit":
      if (list) {
        playlistDraft = { ...list, tracks: [...list.tracks] };
        playlistDialog(playlistDraft);
      }
      break;
    case "playlist-delete":
      if (list)
        showDialog(
          "刪除播放清單",
          "<p>要刪除「" +
            esc(list.name) +
            '」嗎？</p><button class="solid" data-action="playlist-delete-confirm">確認刪除</button>',
        );
      break;
    case "playlist-delete-confirm":
      if (list) {
        void library
          .deletePlaylist(list.id)
          .then(() => {
            playlistId = undefined;
            dialog.close();
            renderPage();
            notify("已刪除播放清單");
          })
          .catch(failure);
      }
      break;
    case "library-select-mode":
      librarySelectMode = true;
      selectedLibraryKeys.clear();
      renderPage();
      break;
    case "library-select-done":
      librarySelectMode = false;
      selectedLibraryKeys.clear();
      renderPage();
      break;
    case "library-select-all":
      for (const item of displayTracks) selectedLibraryKeys.add(item.key);
      renderPage();
      break;
    case "library-select-none":
      selectedLibraryKeys.clear();
      renderPage();
      break;
    case "library-delete-selected": {
      const keys = [...selectedLibraryKeys];
      if (!keys.length) break;
      void library
        .removeMany(keys)
        .then(() => {
          if (player.state.track && keys.includes(player.state.track.key)) {
            player.destroy();
          }
          selectedLibraryKeys.clear();
          librarySelectMode = false;
          wall?.setTracks(sceneTracks(), inspectedTrack);
          renderPage();
          notify("已刪除 " + keys.length + " 首曲目");
        })
        .catch(failure);
      break;
    }
    case "playlist-back":
      playlistId = undefined;
      renderPage(true);
      break;
    case "playlist-play":
      if (displayTracks.length) void start(displayTracks[0], displayTracks);
      break;
    case "album-back":
      selectedAlbum = undefined;
      renderPage(true);
      break;
    case "menu":
      if (menuOpen) closeMenu();
      else {
        menuOpen = true;
        root.dataset.menu = "open";
        $("#music-nav").hidden = false;
        target.setAttribute("aria-expanded", "true");
      }
      break;
    case "desktop-restart":
      if (!desktopHost) {
        notify("請在桌面版 RhineLab-Music.exe 中重啟應用程式");
        break;
      }
      notify("正在重啟 RhineLab Music 以套用 GPU 設定…");
      void restartDesktopApp().catch(failure);
      break;
  }
}
$('[data-action="menu"]').setAttribute("aria-controls", "music-nav");
closeMenu();
let hoverPrewarmTimer: number | undefined;
root.addEventListener("pointerover", (event) => {
  if (!ready || !desktopHost) return;
  const playEl = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-play]",
  );
  if (!playEl) return;
  const key = playEl.dataset.play;
  if (!key) return;
  const track = resolveTrack(key);
  if (!track || track.source === "local") return;
  if (hoverPrewarmTimer !== undefined) clearTimeout(hoverPrewarmTimer);
  hoverPrewarmTimer = window.setTimeout(() => {
    hoverPrewarmTimer = undefined;
    prewarmTrack(track);
  }, 200);
});
root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "button, a.music-brand",
  );
  if (!target || !ready) return;
  if (target.matches("a.music-brand")) {
    event.preventDefault();
    feedback("tick");
    navigate("home", true);
    return;
  }
  const data = target.dataset;
  const act = data.action ?? "";
  let cue: Sound = "ui-tick";
  if (
    ["wall-reset", "track-play", "play", "now-favorite"].includes(act) ||
    Boolean(data.favorite)
  ) {
    cue = "confirm";
  } else if (
    act === "workspace-close" ||
    (act === "close" && dialog.open)
  ) {
    cue = "page-close";
  } else if (
    Boolean(data.panel) ||
    [
      "wall-inspect",
      "previous",
      "next",
      "home-scope-favorites",
      "home-scope-all",
      "shuffle",
      "repeat",
      "mute",
    ].includes(act)
  ) {
    cue = "tick";
  } else if (data.view && view === "home" && data.view !== "home") {
    cue = "page-open";
  }
  feedback(cue);
  if (data.settingTheme) {
    library.state.prefs.theme =
      data.settingTheme as typeof library.state.prefs.theme;
    syncPreferences();
    save();
  } else if (data.view) {
    if (data.view === "playlists") playlistId = undefined;
    if (data.view === "library" && !target.closest("#music-page"))
      selectedAlbum = undefined;
    navigate(data.view as View, true);
  }
  else if (data.panel) {
    panel = data.panel as typeof panel;
    for (const item of root.querySelectorAll<HTMLElement>("[data-panel]"))
      item.setAttribute("aria-pressed", String(item === target));
    renderPanel(true);
    panelTransition.reveal(right, reduced());
  } else if (data.playlist) {
    playlistId = data.playlist;
    renderPage(true);
  } else if (data.album) {
    const track = resolveTrack(data.album);
    if (track) {
      selectedAlbum = albumKey(track);
      navigate("library", true);
    }
  } else if (data.play) {
    const track = resolveTrack(data.play);
    if (track) {
      if (view === "library") homeScope = "all";
      else if (view === "favorites" && library.state.favorites.length > 0)
        homeScope = "favorites";
      syncHomeScopeUI();
      void start(track, right.contains(target) ? player.queue : displayTracks);
    }
  } else if (data.favorite) {
    const track = resolveTrack(data.favorite);
    if (track) favorite(track);
  } else if (data.trackMenu) {
    const track = resolveTrack(data.trackMenu);
    if (track) trackMenu(track);
  } else if (data.addQueue) {
    const track = resolveTrack(data.addQueue);
    if (track) {
      void library
        .remember([track])
        .then(() => {
          player.setQueue([...player.queue, track]);
          dialog.close();
          if (!player.state.track)
            library.state.session = {
              key: track.key,
              position: 0,
              queue: player.queue.map((item) => item.key),
            };
          save();
          notify("已加入播放佇列");
        })
        .catch(failure);
    }
  } else if (data.removeLibrary) {
    const track = library.find(data.removeLibrary);
    if (track)
      showDialog(
        "移出音樂庫",
        "<p>要移除「" +
          esc(track.title) +
          "」及其收藏和清單參照嗎？</p>" +
          '<button class="solid" data-confirm-remove="' +
          esc(track.key) +
          '">確認移除</button>',
      );
  } else if (data.confirmRemove) {
    const key = data.confirmRemove;
    (target as HTMLButtonElement).disabled = true;
    void library
      .remove(key)
      .then(() => {
        if (player.state.track?.key === key) player.destroy();
        player.setQueue(player.queue.filter((item) => item.key !== key));
        searchItems = searchItems.filter((item) => item.key !== key);
        dialog.close();
        renderPage();
        notify("已移出音樂庫");
      })
      .catch((error) => {
        (target as HTMLButtonElement).disabled = false;
        failure(error);
      });
  } else if (data.attachLyrics) {
    lyricsKey = data.attachLyrics;
    $<HTMLInputElement>("#music-lyrics").click();
  } else if (data.uploadArtwork) {
    artworkTargetKey = data.uploadArtwork;
    $<HTMLInputElement>("#music-artwork").click();
  } else if (data.removeArtwork) {
    const key = data.removeArtwork;
    void library
      .removeArtwork(key)
      .then(() => {
        if (inspectedTrack.key === key) showRecord(inspectedTrack);
        if (currentTrack?.key === key) void updateCurrent(currentTrack);
        wall?.refreshArtwork();
        if (dialog.open) trackMenu(resolveTrack(key) ?? inspectedTrack);
        renderPage();
        notify("已恢復預設封面");
      })
      .catch(failure);
  } else if (
    playlistDraft &&
    (data.reorder !== undefined || data.removeTrack !== undefined)
  ) {
    const index = Number(data.reorder ?? data.removeTrack);
    const to = index + Number(data.direction);
    const name =
      dialog.querySelector<HTMLInputElement>('input[name="name"]')?.value;
    if (name !== undefined) playlistDraft.name = name;
    if (data.removeTrack !== undefined) playlistDraft.tracks.splice(index, 1);
    else if (to >= 0 && to < playlistDraft.tracks.length) {
      const tracks = playlistDraft.tracks;
      [tracks[index], tracks[to]] = [tracks[to], tracks[index]];
    }
    playlistDialog(playlistDraft);
  } else if (data.action) action(data.action, target);
});

root.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  const fields = new FormData(form);
  const read = (key: string) => String(fields.get(key) ?? "").trim();
  event.preventDefault();
  if (!ready) return;
  if (form.id === "full-search") {
    void runSearch(read("query"), read("source") as typeof searchFilter);
  } else if (form.id === "link-form") {
    const submit = form.querySelector("button")!;
    submit.disabled = true;
    void importLink(read("link"), read("title"))
      .then((message) => {
        if (dialog.contains(form)) dialog.close();
        notify(message);
      })
      .catch((error) => {
        if (dialog.contains(form))
          dialog.querySelector(".dialog-error")!.textContent =
            error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        submit.disabled = false;
      });
  } else if (form.id === "note-form") {
    const key = form.dataset.key!;
    if (read("notes")) library.state.notes[key] = read("notes");
    else delete library.state.notes[key];
    save();
    dialog.close();
    if (panel === "notes") renderPanel(true);
    notify("已儲存曲目筆記");
  } else if (form.id === "playlist-form") {
    const name = read("name");
    if (!name) {
      dialog.querySelector(".dialog-error")!.textContent = "請輸入清單名稱";
      return;
    }
    const entry = {
      id: playlistDraft?.id ?? crypto.randomUUID(),
      name,
      tracks: playlistDraft?.tracks ?? [],
    };
    const index = library.state.playlists.findIndex(
      (item) => item.id === entry.id,
    );
    if (index >= 0) library.state.playlists[index] = entry;
    else library.state.playlists.push(entry);
    playlistId = entry.id;
    playlistDraft = undefined;
    save();
    dialog.close();
    navigate("playlists", true);
  } else if (form.id === "youtube-playlist-form") {
    const input = read("ytPlaylistInput");
    const playlist = youtubePlaylistId(input);
    if (!playlist) {
      notify("請輸入含 list= 的有效 YouTube 播放清單連結");
      return;
    }
    const videoId = parseTrackLink(input)?.id;
    const submit = form.querySelector("button")!;
    submit.disabled = true;
    notify("正在匯入 YouTube 播放清單…");
    void importYouTubePlaylist(playlist, undefined, videoId)
      .then(async ({ name, tracks }) => {
        if (!tracks.length) throw new Error("找不到可匯入的公開影片");
        await saveImportedPlaylist(name, tracks, false);
        notify("已從 YouTube 匯入「" + name + "」（" + tracks.length + " 首）");
      })
      .catch(failure)
      .finally(() => {
        submit.disabled = false;
      });
  } else if (form.id === "add-to-list") {
    const track = resolveTrack(form.dataset.track!);
    const list = library.state.playlists.find(
      (item) => item.id === read("playlist"),
    );
    if (track && list)
      void library
        .remember([track])
        .then(() => {
          if (!list.tracks.includes(track.key)) list.tracks.push(track.key);
          save();
          dialog.close();
          if (view === "playlists") renderPage();
          notify("已加入「" + list.name + "」");
        })
        .catch(failure);
  }
});
root.addEventListener("cancel", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id === "music-files") notify("已取消選擇本機音樂");
  else if (input.id === "music-lyrics") notify("已取消選擇歌詞檔案");
  else if (input.id === "music-artwork") notify("已取消選擇封面圖片");
}, true);
root.addEventListener("input", (event) => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.selectTrack) {
    const key = input.dataset.selectTrack;
    const checked = (input as HTMLInputElement).checked;
    if (checked) selectedLibraryKeys.add(key);
    else selectedLibraryKeys.delete(key);
    input.closest("[data-track-row]")?.classList.toggle("is-selected", checked);
    const deleteBtn = root.querySelector<HTMLButtonElement>(
      '[data-action="library-delete-selected"]',
    );
    if (deleteBtn) {
      deleteBtn.disabled = selectedLibraryKeys.size === 0;
      deleteBtn.textContent = "刪除已選 (" + selectedLibraryKeys.size + ")";
    }
    return;
  }
  if (input.dataset.customQuality) {
    const prefs = library.state.prefs;
    const custom = (prefs.customQuality = normalizeQuality(prefs.customQuality));
    if (input.dataset.customQuality === "scale") {
      custom.scale = Number(input.value);
      const label = root.querySelector("#custom-scale-value");
      if (label) label.textContent = custom.scale + "%";
    } else if (input.dataset.customQuality === "depthOfField") {
      custom.depthOfField = Number(input.value);
      const label = root.querySelector("#custom-dof-value");
      if (label) label.textContent = custom.depthOfField + "%";
      const toggle = root.querySelector<HTMLInputElement>(
        '[data-custom-quality="dofEnabled"]',
      );
      if (toggle) toggle.checked = custom.depthOfField > 0;
    }
    syncPreferences();
    return;
  }
  if (input.dataset.pref === "soundVolume") {
    library.state.prefs.soundVolume = Number(input.value);
    syncPreferences();
  }
});
root.addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement | HTMLSelectElement;
  if (input.id === "music-files") {
    const fileInput = input as HTMLInputElement;
    void importFiles(Array.from(fileInput.files ?? []));
    fileInput.value = "";
  } else if (input.id === "music-lyrics") {
    const fileInput = input as HTMLInputElement;
    const file = fileInput.files?.[0],
      track = lyricsKey;
    if (file && track)
      void library
        .setLyrics(track, file)
        .then((lines) => {
          if (track === player.state.track?.key) {
            activeLyrics = lines;
            renderPanel(true);
          }
          if (dialog.open) dialog.close();
          notify("已匯入 " + lines.length + " 行歌詞");
        })
        .catch(failure);
    fileInput.value = "";
  } else if (input.id === "music-artwork") {
    const fileInput = input as HTMLInputElement;
    const file = fileInput.files?.[0],
      key = artworkTargetKey;
    if (file && key)
      void library
        .setArtwork(key, file)
        .then(() => {
          if (inspectedTrack.key === key) showRecord(inspectedTrack);
          if (currentTrack?.key === key) void updateCurrent(currentTrack);
          wall?.refreshArtwork();
          if (dialog.open) trackMenu(resolveTrack(key) ?? inspectedTrack);
          renderPage();
          notify("已套用自訂封面貼圖");
        })
        .catch(failure);
    fileInput.value = "";
  } else if (input.dataset.customQuality === "dofEnabled") {
    const prefs = library.state.prefs;
    const custom = (prefs.customQuality = normalizeQuality(prefs.customQuality));
    custom.depthOfField = (input as HTMLInputElement).checked ? 100 : 0;
    const slider = root.querySelector<HTMLInputElement>(
      '[data-custom-quality="depthOfField"]',
    );
    if (slider) slider.value = String(custom.depthOfField);
    const label = root.querySelector("#custom-dof-value");
    if (label) label.textContent = custom.depthOfField + "%";
    syncPreferences();
    save();
  } else if (input.dataset.customQuality) {
    save();
  } else if (input.dataset.pref) {
    const prefs = library.state.prefs;
    switch (input.dataset.pref) {
      case "theme":
        prefs.theme = input.value as typeof prefs.theme;
        break;
      case "accent":
        prefs.accent = input.value as typeof prefs.accent;
        break;
      case "quality":
        prefs.quality = input.value as typeof prefs.quality;
        $<HTMLInputElement>('[data-pref="performance"]').checked =
          prefs.quality === "performance";
        {
          const customPanel = root.querySelector<HTMLElement>(
            "#custom-quality-panel",
          );
          if (customPanel) customPanel.hidden = prefs.quality !== "custom";
        }
        break;
      case "resolution":
        prefs.resolution = input.value as RenderResolution;
        break;
      case "antialias":
        prefs.antialias = input.value as AntialiasMode;
        prefs.customQuality = {
          ...normalizeQuality(prefs.customQuality),
          antialias: prefs.antialias,
        };
        break;
      case "customPixelRatio":
        prefs.customQuality = {
          ...normalizeQuality(prefs.customQuality),
          pixelRatio: Number(input.value),
        };
        break;
      case "renderBackend": {
        const backend = input.value as RenderBackend;
        renderBackendPending = backend;
        if (desktopHost) {
          void setDesktopRenderBackend(backend)
            .then((res) => {
              desktopHost = {
                ...desktopHost,
                desktop: true,
                gpuMode: desktopHost?.gpuMode ?? gpuModePending,
                renderBackend: res.renderBackend,
              };
              gpuRestartRequired = res.restartRequired;
              renderPage();
              notify("已儲存渲染後端設定，重啟 .exe 後生效");
            })
            .catch(failure);
        } else {
          notify("渲染後端設定僅在桌面版 .exe 生效");
        }
        return;
      }
      case "gpuMode": {
        const mode = input.value as GpuMode;
        gpuModePending = mode;
        if (desktopHost) {
          void setDesktopGpuMode(mode)
            .then((res) => {
              desktopHost = {
                ...desktopHost,
                desktop: true,
                gpuMode: res.gpuMode,
                renderBackend: desktopHost?.renderBackend ?? renderBackendPending,
              };
              gpuRestartRequired = res.restartRequired;
              renderPage();
              notify("已儲存 GPU 模式，重啟 .exe 後生效");
            })
            .catch(failure);
        } else {
          notify("GPU 模式僅在桌面版 .exe 生效");
        }
        return;
      }
      case "motion":
        prefs.motion = input.value as typeof prefs.motion;
        break;
      case "font":
        prefs.font = Number(input.value);
        break;
      case "performance":
        prefs.quality = (input as HTMLInputElement).checked
          ? "performance"
          : "original";
        $<HTMLSelectElement>('[data-pref="quality"]').value = prefs.quality;
        {
          const customPanel = root.querySelector<HTMLElement>(
            "#custom-quality-panel",
          );
          if (customPanel) customPanel.hidden = true;
        }
        break;
      case "soundVolume":
        prefs.soundVolume = Number(input.value);
        syncPreferences();
        save();
        if (prefs.sounds) feedback("confirm");
        return;
      case "defaultVolume":
        prefs.volume = Number(input.value);
        player.setVolume(prefs.volume, player.muted);
        $("#settings-volume-status").textContent =
          Math.round(prefs.volume * 100) + "%";
        break;
      case "sounds":
        prefs.sounds = (input as HTMLInputElement).checked;
        syncPreferences();
        save();
        if (prefs.sounds) feedback("confirm");
        return;
      case "audioQuality":
        prefs.audioQuality = input.value as typeof prefs.audioQuality;
        syncRecordPlayback();
        break;
      case "lightingMode":
        prefs.lightingMode = input.value as LightingMode;
        break;
      case "lightingColor":
        prefs.lightingColor = input.value;
        break;
      case "spotifyClientId":
        prefs.spotifyClientId = input.value.trim();
        break;
    }
    syncPreferences();
    save();
  } else if (input.id === "volume") {
    library.state.prefs.volume = player.volume;
    library.state.prefs.muted = player.muted;
    save();
  }
});
const seekInput = $<HTMLInputElement>("#seek");
let seekThrottleTimer: number | undefined;
let lastSeekSentAt = 0;
const syncSeekPreview = (val: number) => {
  const dur = player.state.duration || 0;
  const clamped = dur ? Math.max(0, Math.min(val, dur)) : 0;
  const stamp = formatTime(clamped);
  if (stamp !== previousElapsed) {
    previousElapsed = stamp;
    elapsedNode.textContent = stamp;
  }
  seekInput.style.setProperty(
    "--progress",
    (dur ? Math.min(100, (clamped / dur) * 100) : 0) + "%",
  );
  const valueText = stamp + " / " + formatTime(dur);
  if (valueText !== lastAriaValueText) {
    lastAriaValueText = valueText;
    seekInput.setAttribute("aria-valuetext", valueText);
  }
};
seekInput.addEventListener("pointerdown", () => {
  seekDragging = true;
});
window.addEventListener("pointerup", () => {
  seekDragging = false;
});
seekInput.addEventListener("input", () => {
  seekDragging = true;
  const val = Number(seekInput.value);
  syncSeekPreview(val);
  const now = performance.now();
  if (now - lastSeekSentAt >= 120) {
    lastSeekSentAt = now;
    clearTimeout(seekThrottleTimer);
    seekThrottleTimer = undefined;
    player.seek(val);
  } else {
    clearTimeout(seekThrottleTimer);
    seekThrottleTimer = window.setTimeout(() => {
      seekThrottleTimer = undefined;
      lastSeekSentAt = performance.now();
      player.seek(Number(seekInput.value));
    }, 120);
  }
});
seekInput.addEventListener("change", () => {
  clearTimeout(seekThrottleTimer);
  seekThrottleTimer = undefined;
  seekDragging = false;
  const val = Number(seekInput.value);
  syncSeekPreview(val);
  lastSeekSentAt = performance.now();
  player.seek(val);
});
$<HTMLInputElement>("#volume").addEventListener("input", (event) =>
  player.setVolume(Number((event.target as HTMLInputElement).value), false),
);
window.addEventListener("keydown", (event) => {
  if (
    !ready ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    dialog.open ||
    wall?.viewerOpen
  )
    return;
  if (event.key === "Escape" && menuOpen) {
    event.preventDefault();
    closeMenu();
    $('[data-action="menu"]').focus();
    return;
  }
  if (event.key === "Escape" && view !== "home") {
    event.preventDefault();
    closeWorkspace();
    return;
  }
  if (
    (event.target as HTMLElement)?.closest(
      "input, textarea, select, button, a, [contenteditable]",
    )
  )
    return;
  const keys: Record<string, () => void> = {
    "/": () => navigate("search", true),
    " ": () => void player.toggle(),
    j: () => stepTrack(-1),
    k: () => stepTrack(1),
    m: () => action("mute", $('[data-action="mute"]')),
  };
  const callback = keys[event.key.toLowerCase()];
  if (callback) {
    event.preventDefault();
    callback();
  }
});
let dragDepth = 0;
root.addEventListener("dragenter", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dragDepth++;
  root.dataset.drop = "true";
});
root.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
root.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    delete root.dataset.drop;
  }
});
root.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.files.length) return;
  event.preventDefault();
  dragDepth = 0;
  delete root.dataset.drop;
  void importFiles(Array.from(event.dataTransfer.files));
});
function network() {
  $("#network").dataset.online = String(navigator.onLine);
  $("#network span").textContent = navigator.onLine
    ? "MUSIC SESSION"
    : "OFFLINE SESSION";
}
window.addEventListener("offline", network);
window.addEventListener("online", () => {
  network();
  if (view === "search" && query) void runSearch(query);
  if (
    player.state.status === "error" &&
    player.state.track?.source === "youtube"
  )
    notify("已重新連線，可重試播放");
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) persistSession();
  else ensureSpectrumLoop();
});
window.addEventListener("pagehide", persistSession);

let lastSpectrum = 0;
let spectrumRaf = 0;
let visualState: string | undefined;
let bassAvg = 0;
let beatEnvelope = 0;
const spectrumPeaks = new Float32Array(54);
function ensureSpectrumLoop() {
  if (spectrumRaf || !spectrum || document.hidden) return;
  const playing = player.state.status === "playing";
  const canvasVisible = right.contains(canvas);
  if (!playing && !canvasVisible) return;
  spectrumRaf = requestAnimationFrame(drawSpectrum);
}
function drawSpectrum(now: number) {
  spectrumRaf = 0;
  if (!spectrum || document.hidden) return;
  const { status, track } = player.state;
  const analyser = status === "playing" ? player.adapter?.analyser : undefined;
  const canvasVisible = right.contains(canvas);
  const dt = lastSpectrum
    ? Math.min(0.05, Math.max(0.001, (now - lastSpectrum) / 1000))
    : 0.016;
  lastSpectrum = now;
  if (canvasVisible) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (rect.width > 10 && rect.height > 10) {
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
        visualState = undefined;
      }
    }
    const state = [analyser ? "active" : "idle", dark(), canvas.width, canvas.height].join(":");
    const hasPeaks = analyser ? true : spectrumPeaks.some((p) => p > 0.004);
    if (analyser || hasPeaks || visualState !== state) {
      visualState = state;
      if (analyser) {
        analyser.getByteFrequencyData(bands);
        analyser.getByteTimeDomainData(wave);
      }
      const { width, height } = canvas;
      spectrum.clearRect(0, 0, width, height);
      const darkTheme = dark();
      const grad = spectrum.createLinearGradient(0, height, 0, 0);
      if (darkTheme) {
        grad.addColorStop(0, "rgba(228, 160, 116, 0.45)");
        grad.addColorStop(0.55, "#ed853d");
        grad.addColorStop(1, "#ffd39c");
      } else {
        grad.addColorStop(0, "rgba(139, 83, 46, 0.42)");
        grad.addColorStop(0.6, "#8b532e");
        grad.addColorStop(1, "#c86528");
      }
      const count = spectrumPeaks.length;
      const cellW = width / count;
      const barW = Math.max(2 * dpr, cellW - Math.max(2.5 * dpr, cellW * 0.28));
      const padBottom = 5 * dpr;
      const maxH = Math.max(8, height - padBottom - 4 * dpr);
      const fall = dt * 0.72;
      for (let index = 0; index < count; index++) {
        let signal = 0;
        if (analyser) {
          const slot = Math.floor(Math.pow(index / count, 1.35) * 96);
          const freq = bands[slot] / 255;
          const waveIdx = Math.floor((index / count) * wave.length);
          const timeAmp = Math.min(1, Math.abs(wave[waveIdx] - 128) / 96);
          signal = Math.min(1, freq * 0.8 + timeAmp * 0.3);
        }
        spectrumPeaks[index] = Math.max(
          signal,
          spectrumPeaks[index] - fall,
          0,
        );
        const barH = Math.max(2.5 * dpr, signal * maxH);
        const x = index * cellW + (cellW - barW) * 0.5;
        spectrum.fillStyle = grad;
        spectrum.globalAlpha = signal > 0.01 ? 0.55 + signal * 0.45 : 0.22;
        spectrum.fillRect(x, height - barH - padBottom, barW, barH);
        if (spectrumPeaks[index] > 0.02) {
          const peakY = height - spectrumPeaks[index] * maxH - padBottom - 2 * dpr;
          spectrum.globalAlpha = darkTheme ? 0.88 : 0.78;
          spectrum.fillRect(x, Math.max(0, peakY), barW, Math.max(1.5, 1.6 * dpr));
        }
      }
      spectrum.globalAlpha = 1;
    }
  } else if (analyser && !reduced()) {
    analyser.getByteFrequencyData(bands);
  }
  if (analyser && !reduced() && wall) {
    const avg = (start: number, end: number) => {
      let sum = 0;
      for (let i = start; i < end; i++) sum += bands[i];
      return sum / (end - start) / 255;
    };
    const low = avg(0, 8);
    bassAvg = bassAvg * Math.exp(-dt * 2.5) + low * (1 - Math.exp(-dt * 2.5));
    const onset = Math.max(0, low - bassAvg * 1.18) * 3.5;
    beatEnvelope = Math.max(
      beatEnvelope * Math.exp(-dt * 9.0),
      Math.min(1, onset),
    );
    wall.pulse(
      {
        low,
        mid: avg(8, 32),
        high: avg(32, 64),
        activity: avg(0, 32),
      },
      beatEnvelope,
    );
  } else if (
    status === "playing" &&
    track &&
    !analyser &&
    !reduced() &&
    wall
  ) {
    const t = now / 1000;
    const pulse = 0.28 + 0.18 * Math.sin(t * 4.2);
    wall.pulse(
      {
        low: pulse,
        mid: 0.22 + 0.1 * Math.cos(t * 2.7),
        high: 0.18,
        activity: pulse,
      },
      Math.max(0, Math.sin(t * 4.2)) * 0.35,
    );
  } else {
    bassAvg = 0;
    beatEnvelope = 0;
    wall?.pulse(undefined, 0);
  }
  if (status === "playing" || (canvasVisible && spectrumPeaks.some((p) => p > 0.004))) {
    spectrumRaf = requestAnimationFrame(drawSpectrum);
  }
}

async function boot() {
  try {
    await library.init();
  } catch {
    notify("本機資料庫無法開啟。這個分頁的匯入與偏好將暫存在記憶體。");
  }
  void probeDesktopHost().then((status) => {
    if (!status) return;
    applyDesktopHostCapabilities(status);
    window.setInterval(() => {
      void fetch("/__rhine/heartbeat", {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    }, 3000);
    if (view === "settings" || view === "platforms") renderPage();
    syncDesktopWindowTheme();
    prewarmAdjacentTracks(inspectedTrack, sceneTracks());
  });
  const prefs = library.state.prefs;
  homeScope = library.state.favorites.length > 0 ? "favorites" : "all";
  player.repeat = prefs.repeat;
  player.shuffle = prefs.shuffle;
  player.volume = prefs.volume;
  player.muted = prefs.muted;
  view = hashView();
  ready = true;
  syncPreferences();
  void runBootIntro(root, { dark: dark(), reduced: reduced() });
  renderPage();
  network();
  $("#saved-count").textContent = String(
    library.state.favorites.length,
  ).padStart(2, "0");
  const updateClock = () => {
    $("#session-clock").textContent = new Date().toLocaleTimeString("en-GB");
  };
  updateClock();
  window.setInterval(updateClock, 1000);
  await updateCurrent();
  if (!currentTrack) showRecord(sceneTracks()[0]);
  playbackControls();
  ensureSpectrumLoop();
  const saved = library.state.session;
  if (saved) {
    const track = library.find(saved.key);
    if (track) {
      player.setQueue(byKeys(saved.queue));
      // Restore platform choices without loading remote frames on page entry.
      if (track.source === "local")
        void player.select(track, undefined, {
          autoplay: false,
          position: saved.position,
        });
      else player.restoreRemote(track, saved.position);
    }
  }
  void completeSpotifyCallback()
    .then(async (session) => {
      if (!session) return;
      spotifySession = session;
      notify("Spotify 登入成功，正在同步播放清單…");
      const { tracks, playlists } = await syncSpotifyLibrary(session);
      if (tracks.length) await library.remember(tracks);
      for (const pl of playlists) {
        const existing = library.state.playlists.find(
          (item) => item.id === pl.id,
        );
        if (existing) existing.tracks = pl.tracks;
        else library.state.playlists.push(pl);
      }
      await library.save();
      renderPage();
      notify(`已自動同步 Spotify：${tracks.length} 首曲目`);
    })
    .catch(failure);
  void initPwa(notify);
}
const startup = boot();
