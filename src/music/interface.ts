import { escapeHtml as esc } from "../html";
import { sourceNames, type Track } from "./types";

const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-6h6v6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  heart:
    '<path d="M20.9 4.8a5.5 5.5 0 0 0-7.8 0L12 5.9l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.3 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
  library:
    '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  link: '<path d="M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2m2 6a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2"/>',
  settings:
    '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 3v6m8 0v6m-5 0v6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path fill="currentColor" stroke="none" d="M8 5v14l11-7z"/>',
  pause: '<path stroke-width="3" d="M9 5v14m6-14v14"/>',
  prev: '<path d="M5 5v14"/><path fill="currentColor" stroke="none" d="m19 5-11 7 11 7z"/>',
  next: '<path d="M19 5v14"/><path fill="currentColor" stroke="none" d="m5 5 11 7-11 7z"/>',
  volume:
    '<path d="M4 9h4l5-4v14l-5-4H4zM16 8a6 6 0 0 1 0 8m2-10a9 9 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zM16 9l5 6m0-6-5 6"/>',
  shuffle:
    '<path d="m17 3 4 4-4 4m0 2 4 4-4 4M3 7h3c5 0 6 10 11 10h4M3 17h3c5 0 6-10 11-10h4"/>',
  repeat:
    '<path d="m16 2 4 4-4 4m-8 12-4-4 4-4M4 12V9a3 3 0 0 1 3-3h13m0 6v3a3 3 0 0 1-3 3H4"/>',
  disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M6 12a6 6 0 0 1 6-6m6 6a6 6 0 0 1-6 6"/>',
  arrow: '<path d="M5 19 19 5M8 5h11v11"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12m0-12L6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
} as const;
export type Icon = keyof typeof icons;
export const icon = (name: Icon) =>
  '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  icons[name] +
  "</svg>";
export const views = [
  ["home", "home", "首頁"],
  ["search", "search", "搜尋"],
  ["favorites", "heart", "收藏"],
  ["playlists", "list", "播放清單"],
  ["recent", "clock", "最近播放"],
  ["library", "library", "音樂資料庫"],
  ["platforms", "link", "平台管理"],
  ["settings", "settings", "設定"],
] as const satisfies ReadonlyArray<readonly [string, Icon, string]>;
export type View = (typeof views)[number][0];

export const button = (action: string, glyph: Icon, label: string, css = "") =>
  '<button type="button" class="icon-button ' +
  css +
  '" data-action="' +
  action +
  '" aria-label="' +
  label +
  '" title="' +
  label +
  '">' +
  icon(glyph) +
  "</button>";
const nav = (items: (typeof views)[number][]) =>
  items
    .map(
      ([id, glyph, name]) =>
        '<button data-view="' +
        id +
        '">' +
        icon(glyph) +
        "<span>" +
        name +
        "</span></button>",
    )
    .join("");

export const shell = `
  <a class="skip-link" href="#music-content">跳到音樂內容</a>
  <div id="wall" data-state="loading" aria-label="三維唱片展示"></div>
  <div class="terminal-wash" aria-hidden="true"></div>
  <header class="music-header">
    <a href="#home" class="music-brand" aria-label="RhineLab Music 首頁"><span>RHINE LAB</span><small>LOCAL MUSIC PLAYER</small><span class="system-name">ANALYSIS <b>OS</b></span></a>
    <nav id="terminal-nav" aria-label="終端快捷鍵">
      <button data-view="search" class="index-button">${icon("search")} MUSIC INDEX <kbd>/</kbd></button>
      <button data-view="favorites" class="saved-button">＋ SAVED <span id="saved-count">00</span></button>
      <button data-view="settings" class="setting-button" aria-label="設定">${icon("clock")}<small>設定</small></button>
      ${button("menu", "menu", "開啟導覽", "mobile-menu")}
      <div class="window-controls" id="window-controls" hidden role="group" aria-label="視窗控制">
        <button type="button" class="win-btn" data-action="win-minimize" aria-label="最小化" title="最小化"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" fill="none"/></svg></button>
        <button type="button" class="win-btn" data-action="win-maximize" aria-label="最大化或還原" title="最大化或還原"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="2.2" y="2.2" width="7.6" height="7.6" stroke="currentColor" stroke-width="1.2" fill="none"/></svg></button>
        <button type="button" class="win-btn win-close" data-action="win-close" aria-label="關閉視窗" title="關閉視窗"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.2" fill="none"/></svg></button>
      </div>
    </nav>
    <nav class="music-nav" id="music-nav" aria-label="音樂導覽" hidden>
      ${nav([...views])}
      <a class="archive-link" href="?archive=1" target="_blank" rel="noopener noreferrer">${icon("arrow")} 原始檔案終端</a>
    </nav>
  </header>
  <main class="terminal-content" id="music-content" tabindex="-1">
    <section id="music-hero" class="inspection" aria-label="唱片模型與音樂庫">
      <button class="library-back" data-view="library">← <span>LIBRARY OVERVIEW</span><kbd>ESC</kbd></button>
      <div class="home-scope" role="group" aria-label="3D 牆顯示範圍">
        <button type="button" data-action="home-scope-favorites" aria-pressed="true">收藏清單 (<span id="scope-fav-count">0</span>)</button>
        <button type="button" data-action="home-scope-all" aria-pressed="false">全部歌曲 (<span id="scope-all-count">0</span>)</button>
      </div>
      <div class="object-index">
        <strong id="object-number">NO.<span id="object-code">001</span></strong>
        <p class="mono">MUSIC LIBRARY</p>
        <p class="object-instruction mono">DRAG ↔ / WHEEL ZOOM <span>↻</span></p>
        <div class="object-nav" role="group" aria-label="唱片檢視控制">
          <button type="button" class="icon-button" data-action="wall-inspect" aria-pressed="true" aria-label="回主頁陣列／切換唱片特寫" title="回主頁陣列／切換唱片特寫">${icon("library")}</button>
          <button type="button" class="icon-button" data-action="wall-reset" aria-label="從頭重新播放此曲目" title="從頭重新播放此曲目"><span aria-hidden="true">↻</span></button>
        </div>
        <span id="wall-status" class="sr-only">載入三維陣列…</span>
      </div>
    </section>
    <article class="music-right" aria-label="曲目資料">
      <header class="record-meta mono"><span id="record-number">TRACK X-<span id="record-code">001</span></span><span id="now-source">LOCAL FILE</span></header>
      <div class="record-status-bar mono" id="record-status-bar"><span id="record-status">正在查看</span><button type="button" class="text-link" id="jump-playing" data-action="inspect-playing" hidden>回到播放中 ↗</button></div>
      <div class="record-heading">
        <div id="now-art" class="now-art"></div>
        <div class="now-caption">
          <h1 id="hero-title"><span id="hero-title-text">LOCAL FILE</span></h1>
          <h2 id="now-title">觀測室 · Observatory</h2>
        </div>
        <p id="now-artist"></p>
      </div>
      <div id="video-mount" hidden></div>
      <div id="now-platform"></div>
      <dl class="track-facts">
        <div><dt>ARTIST / 藝術家</dt><dd id="track-artist">—</dd></div>
        <div><dt>ALBUM / 專輯</dt><dd id="track-album">—</dd></div>
        <div><dt>RELEASE / 發行</dt><dd id="track-release">—</dd></div>
        <div><dt>DURATION / 時長</dt><dd id="track-duration">—</dd></div>
      </dl>
      <div id="track-audio-info" class="mono audio-quality-badge" hidden></div>
      <div class="right-tabs" role="group" aria-label="曲目分頁">
        <button data-panel="details" aria-pressed="true"><small>01</small> 曲目簡介</button>
        <button data-panel="notes" aria-pressed="false"><small>02</small> 曲目筆記</button>
        <button data-panel="history" aria-pressed="false"><small>03</small> 播放記錄</button>
        <button data-panel="lyrics" aria-pressed="false">歌詞</button>
        <button data-panel="queue" aria-pressed="false">播放佇列 <span id="queue-count">00</span></button>
      </div>
      <div id="right-content"></div>
      <div class="record-actions">
        <button class="solid" data-action="now-favorite" aria-label="收藏目前歌曲">＋ SAVE TRACK <span>收藏曲目</span></button>
        <button class="outline" data-action="track-play" aria-label="播放所選曲目">▶ PLAY <span>播放</span></button>
        <button class="outline" data-action="edit-notes">EDIT <span>編輯筆記</span></button>
        <button class="outline" data-action="track-options">MORE <span>曲目選項</span></button>
      </div>
    </article>
  </main>
  <footer class="terminal-footer">
    <div class="transport" aria-label="播放控制">
      <div class="transport-buttons">
        ${button("previous", "prev", "上一首")}${button("play", "play", "播放", "play-main")}${button("next", "next", "下一首")}
      </div>
      <button type="button" class="transport-track" data-action="inspect-playing" aria-label="查看目前播放曲目"><div id="mini-art"></div><div><strong id="mini-title">尚未播放</strong><small id="mini-source">RHINE LAB MUSIC</small></div></button>
      <div class="progress"><span id="elapsed">0:00</span><input id="seek" aria-label="播放進度" type="range" min="0" max="1" value="0" step="any" disabled><span id="duration">0:00</span></div>
      <div class="transport-mode">${button("shuffle", "shuffle", "隨機播放")}${button("repeat", "repeat", "循環模式")}</div>
      <div class="transport-volume">${button("mute", "volume", "靜音")}<input id="volume" type="range" min="0" max="1" value="0.8" step="0.01" aria-label="播放音量"></div>
      <button class="outline file-button" data-action="files" aria-label="匯入本機音樂">${icon("upload")} <span>匯入本機音樂</span></button>
      <div id="transport-status" class="transport-status" role="status" hidden></div>
    </div>
    <div class="session-footer mono"><span id="network"><i></i><span>MUSIC SESSION</span></span><span class="session-user">LOCAL LISTENER ／ <time id="session-clock"></time></span><button data-action="link">匯入平台連結 ↗</button></div>
  </footer>
  <dialog id="music-workspace" aria-labelledby="workspace-title">
    <div class="workspace-header"><span class="mono" id="workspace-kicker">RHINE LAB / MUSIC INDEX</span>
      <button data-action="workspace-close">CLOSE ${icon("close")}</button></div>
    <div id="music-page"></div>
  </dialog>
  <input id="music-files" type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac,.webm,.aiff" multiple hidden>
  <input id="music-lyrics" type="file" accept=".lrc,text/plain" hidden>
  <input id="music-artwork" type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif" hidden>
  <dialog id="music-dialog"></dialog>
  <div id="music-notice" role="status" hidden></div>
  <div id="pwa-update-notice" class="music-update" role="status" hidden><span>新版本已就緒</span><button data-pwa-action="update">更新並重啟 ↻</button></div>
  <div class="spectrum-source" hidden><span id="spectrum-label">本機音訊頻譜</span><canvas id="spectrum" width="480" height="86" aria-label="音訊視覺化"></canvas></div>
`;

export function cover(track?: Track, artwork?: string) {
  const safe = artwork && /^(?:https:\/\/|blob:)/i.test(artwork) ? artwork : "";
  return safe
    ? '<img src="' + esc(safe) + '" alt="" decoding="async">'
    : '<div class="disc-cover">' +
        icon("disc") +
        '<em class="mono">' +
        (track ? esc(sourceNames[track.source]) : "RHINE / LAB") +
        "</em></div>";
}
export function trackRow(
  track: Track,
  index: number,
  favorite: boolean,
  current?: string,
  compact = false,
  selection?: { active: boolean; checked: boolean },
) {
  return (
    '<li class="track-row' +
    (track.key === current ? " is-current" : "") +
    (selection?.checked ? " is-selected" : "") +
    '" data-track-row="' +
    esc(track.key) +
    '">' +
    (selection?.active
      ? '<label class="track-check"><input type="checkbox" class="track-select" data-select-track="' +
        esc(track.key) +
        '" aria-label="選取 ' +
        esc(track.title) +
        '"' +
        (selection.checked ? " checked" : "") +
        "></label>"
      : "") +
    '<button class="track-main" data-play="' +
    esc(track.key) +
    '" aria-label="播放 ' +
    esc(track.title) +
    '">' +
    '<span class="track-index mono">' +
    String(index + 1).padStart(2, "0") +
    '</span><span class="row-art" data-cover="' +
    esc(track.key) +
    '">' +
    cover(track, track.artwork) +
    "</span>" +
    '<span class="track-info"><strong>' +
    esc(track.title) +
    "</strong><small>" +
    esc(
      [track.artist, !compact && track.album].filter(Boolean).join(" · ") ||
        sourceNames[track.source],
    ) +
    "</small></span></button>" +
    (compact
      ? ""
      : '<span class="source-chip mono">' +
        esc(sourceNames[track.source]) +
        "</span>" +
        '<button class="icon-button favorite" aria-pressed="' +
        favorite +
        '" data-favorite="' +
        esc(track.key) +
        '" aria-label="收藏 ' +
        esc(track.title) +
        '">' +
        icon("heart") +
        "</button>") +
    '<button class="icon-button" data-track-menu="' +
    esc(track.key) +
    '" aria-label="' +
    esc(track.title) +
    ' 的選項">' +
    icon("list") +
    "</button></li>"
  );
}

export const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return Math.floor(whole / 60) + ":" + String(whole % 60).padStart(2, "0");
};
