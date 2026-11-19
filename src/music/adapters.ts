import type { Library } from "./library";
import {
  controlSpotifyApi,
  ensureFreshSpotifyToken,
  loadSpotifySession,
  type SpotifySession,
} from "./spotify";
import type { Adapter, AudioQuality, Playback, Track } from "./types";

type Publish = (event: Partial<Playback>) => void;
let nextStreamSid = 0;
let sharedAudioContext: AudioContext | undefined;
function getSharedAudioContext() {
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

export class LocalAdapter implements Adapter {
  private audio = new Audio();
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private objectUrl?: string;
  private gain?: GainNode;
  private level = 1;
  analyser?: AnalyserNode;
  private library: Library;

  constructor(library: Library) {
    this.library = library;
  }

  async load(track: Track, publish: Publish, signal: AbortSignal) {
    const url = await this.library.getAudioUrl(track.key, signal);
    signal.throwIfAborted();
    if (!url) throw new Error("找不到本機音訊，請重新匯入檔案");
    const audio = this.audio;
    audio.preload = "auto";
    const progress = () => ({
      time: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });
    audio.addEventListener("timeupdate", () => publish(progress()), { signal });
    audio.addEventListener("durationchange", () => publish(progress()), {
      signal,
    });
    audio.addEventListener(
      "playing",
      () => publish({ status: "playing", message: undefined }),
      { signal },
    );
    audio.addEventListener(
      "pause",
      () => {
        if (!audio.ended) publish({ status: "paused" });
      },
      { signal },
    );
    audio.addEventListener(
      "ended",
      () => publish({ ...progress(), status: "ended" }),
      { signal },
    );
    const readError = () => new Error("瀏覽器無法解碼此音訊，請確認檔案與格式");
    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("讀取音訊逾時")),
        12000,
      );
      audio.addEventListener(
        "loadedmetadata",
        () => {
          clearTimeout(timeout);
          publish({ ...progress(), status: "ready", audioInfo: track.audioInfo });
          resolve();
        },
        { once: true, signal },
      );
      audio.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          const error = readError();
          publish({ status: "error", message: error.message });
          reject(error);
        },
        { signal },
      );
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          reject(signal.reason);
        },
        { once: true },
      );
    });
    this.objectUrl = url;
    audio.src = url;
    audio.load();
    await loaded;
  }

  async play() {
    const audio = this.audio;
    if (!this.context && typeof AudioContext !== "undefined") {
      try {
        this.context = getSharedAudioContext();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.72;
        this.gain = this.context.createGain();
        this.source = this.context.createMediaElementSource(audio);
        this.source
          .connect(this.analyser)
          .connect(this.gain)
          .connect(this.context.destination);
        this.volume(this.level);
      } catch {
        this.source = undefined;
        this.analyser = undefined;
        this.gain = undefined;
        this.context = undefined;
      }
    }
    // Begin both operations in the same gesture to satisfy browser playback policy.
    void this.context?.resume().catch(() => {});
    await audio.play();
  }

  pause() {
    this.audio.pause();
  }
  seek(value: number) {
    this.audio.currentTime = value;
  }
  volume(value: number) {
    this.level = value;
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.012);
      this.audio.volume = 1;
    } else if (this.gain) {
      this.gain.gain.value = value;
      this.audio.volume = 1;
    } else this.audio.volume = value;
    this.audio.muted = value === 0;
  }
  destroy() {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.objectUrl = undefined;
    try { this.source?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.gain?.disconnect(); } catch {}
    this.source = undefined;
    this.analyser = undefined;
    this.gain = undefined;
    this.context = undefined;
  }
}

interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  destroy(): void;
  getDuration(): number;
  getCurrentTime(): number;
}
interface YouTubeAPI {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: {
        onReady: () => void;
        onStateChange: (event: { data: number }) => void;
        onError: (event: { data: number }) => void;
        onAutoplayBlocked: () => void;
      };
    },
  ) => YouTubePlayer;
}
interface YouTubeWindow extends Window {
  YT?: YouTubeAPI;
}
let youtubeApi: Promise<YouTubeAPI> | undefined;
function loadYouTubeAPI() {
  if ((window as YouTubeWindow).YT?.Player)
    return Promise.resolve((window as YouTubeWindow).YT!);
  return (youtubeApi ??= new Promise<YouTubeAPI>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    const poll = window.setInterval(() => {
      const api = (window as YouTubeWindow).YT;
      if (api?.Player) {
        cleanup();
        resolve(api);
      }
    }, 50);
    const timeout = window.setTimeout(fail, 12000);
    function cleanup() {
      clearInterval(poll);
      clearTimeout(timeout);
    }
    function fail() {
      cleanup();
      script.remove();
      youtubeApi = undefined;
      reject(new Error("YouTube 播放器無法連線，請稍後重試或在 YouTube 開啟"));
    }
    script.addEventListener("error", fail, { once: true });
    document.head.append(script);
  }));
}
function embed(url: URL, title: string) {
  const frame = document.createElement("iframe");
  frame.src = url.href;
  frame.title = title;
  frame.referrerPolicy = "strict-origin-when-cross-origin";
  frame.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  frame.allowFullscreen = true;
  return frame;
}

export class YouTubeAdapter implements Adapter {
  private player?: YouTubePlayer;
  private frame?: HTMLIFrameElement;
  private audio?: HTMLAudioElement;
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;
  private level = 1;
  private ticker?: number;
  private observer?: IntersectionObserver;
  private mount: HTMLElement;
  private visible = false;
  private publish?: Publish;
  private preferAudioStream: boolean | (() => Promise<boolean>);
  private getAudioQuality: () => AudioQuality;
  private streamSid?: string;
  analyser?: AnalyserNode;
  isAudioOnly = false;

  constructor(
    mount: HTMLElement,
    preferAudioStream: boolean | (() => Promise<boolean>) = false,
    getAudioQuality: () => AudioQuality = () => "auto",
  ) {
    this.mount = mount;
    this.preferAudioStream = preferAudioStream;
    this.getAudioQuality = getAudioQuality;
  }

  private async loadAudioStream(
    track: Track,
    publish: Publish,
    signal: AbortSignal,
  ) {
    const audio = (this.audio = new Audio());
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    const sid = (this.streamSid = String(++nextStreamSid));
    const q = this.getAudioQuality();
    const baseUrl =
      "/__rhine/yt-audio?v=" +
      encodeURIComponent(track.id) +
      "&sid=" +
      encodeURIComponent(sid) +
      "&q=" +
      encodeURIComponent(q);
    const progress = () => ({
      time: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });
    audio.addEventListener("timeupdate", () => publish(progress()), { signal });
    audio.addEventListener("durationchange", () => publish(progress()), {
      signal,
    });
    let streamInfoLoaded = false;
    const fetchStreamInfo = () => {
      if (streamInfoLoaded || signal.aborted) return;
      streamInfoLoaded = true;
      void fetch(
        "/__rhine/stream-info?v=" +
          encodeURIComponent(track.id) +
          "&q=" +
          encodeURIComponent(q),
        { signal, cache: "no-store" },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (info?.ok && !signal.aborted) {
            publish({
              audioInfo: {
                codec: info.codec || undefined,
                ext: info.ext || undefined,
                bitrateKbps: info.bitrateKbps || undefined,
                sampleRateHz: info.sampleRateHz || undefined,
                lossless: info.codec === "flac" || info.ext === "flac",
              },
            });
          }
        })
        .catch(() => {});
    };
    audio.addEventListener(
      "playing",
      () => {
        publish({ status: "playing", message: undefined });
        fetchStreamInfo();
      },
      { signal },
    );
    audio.addEventListener(
      "pause",
      () => {
        if (!audio.ended) publish({ status: "paused" });
      },
      { signal },
    );
    audio.addEventListener(
      "ended",
      () => publish({ ...progress(), status: "ended" }),
      { signal },
    );
    let settled = false;
    let recoveries = 0;
    let recovering = false;
    const attemptRecover = () => {
      if (recovering || signal.aborted || recoveries >= 3) return false;
      recoveries++;
      recovering = true;
      const resumeAt = audio.currentTime || 0;
      const wasPlaying = !audio.paused;
      publish({ message: "串流重連中（第 " + recoveries + " 次）…" });
      const onReady = () => {
        recovering = false;
        if (signal.aborted) return;
        if (resumeAt > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, audio.duration);
        }
        if (wasPlaying) void audio.play().catch(() => {});
        publish({ message: undefined });
      };
      audio.addEventListener("loadedmetadata", onReady, { once: true, signal });
      audio.src = baseUrl + "&_r=" + Date.now();
      audio.load();
      return true;
    };
    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        settled = true;
        reject(new Error("讀取 YouTube 音訊逾時"));
      }, 30000);
      audio.addEventListener(
        "loadedmetadata",
        () => {
          clearTimeout(timeout);
          settled = true;
          this.isAudioOnly = true;
          publish({ ...progress(), status: "ready" });
          resolve();
        },
        { once: true, signal },
      );
      audio.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            reject(new Error("無法載入 YouTube 音訊串流"));
          } else {
            recovering = false;
            if (!attemptRecover()) {
              publish({
                status: "error",
                message: "YouTube 音訊串流中斷，請稍後重試或在 YouTube 開啟",
              });
            }
          }
        },
        { signal },
      );
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          settled = true;
          reject(signal.reason);
        },
        { once: true },
      );
    });
    audio.src = baseUrl;
    audio.load();
    await loaded;
  }

  async load(track: Track, publish: Publish, signal: AbortSignal) {
    this.publish = publish;
    const useAudioStream =
      typeof this.preferAudioStream === "function"
        ? await this.preferAudioStream()
        : this.preferAudioStream;
    signal.throwIfAborted();
    if (useAudioStream) {
      try {
        await this.loadAudioStream(track, publish, signal);
        return;
      } catch (error) {
        this.audio?.pause();
        this.audio?.removeAttribute("src");
        this.audio?.load();
        this.audio = undefined;
        this.isAudioOnly = false;
        throw error;
      }
    }
    const api = await loadYouTubeAPI();
    signal.throwIfAborted();
    const url = new URL(
      "https://www.youtube.com/embed/" + encodeURIComponent(track.id),
    );
    url.search = new URLSearchParams({
      enablejsapi: "1",
      origin: location.origin,
      playsinline: "1",
      autoplay: "0",
    }).toString();
    const frame = (this.frame = embed(url, "YouTube · " + track.title));
    this.mount.replaceChildren(frame);
    this.observer = new IntersectionObserver(
      ([entry]) => {
        this.visible = entry.isIntersecting && entry.intersectionRatio >= 0.51;
      },
      { threshold: [0, 0.51] },
    );
    this.observer.observe(frame);
    const measureVisibility = () => {
      const rect = frame.getBoundingClientRect();
      this.visible =
        rect.width >= 200 &&
        rect.height >= 200 &&
        Math.max(
          0,
          Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top),
        ) *
          Math.max(
            0,
            Math.min(innerWidth, rect.right) - Math.max(0, rect.left),
          ) >=
          rect.width * rect.height * 0.51;
    };
    const progress = () => ({
      time: this.player?.getCurrentTime() || 0,
      duration: this.player?.getDuration() || 0,
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("YouTube 播放器載入逾時")),
        15000,
      );
      const cleanup = () => clearTimeout(timeout);
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(signal.reason);
        },
        { once: true },
      );
      this.player = new api.Player(frame, {
        events: {
          onReady: () => {
            cleanup();
            if (signal.aborted) return;
            measureVisibility();
            if (!this.visible) requestAnimationFrame(measureVisibility);
            publish({ status: "ready", ...progress() });
            this.ticker = window.setInterval(() => {
              if (!document.hidden) publish(progress());
            }, 350);
            resolve();
          },
          onStateChange: ({ data }) => {
            if (signal.aborted) return;
            if (data === 1) {
              publish({ status: "playing", message: undefined, ...progress() });
            } else if (data === 2) publish({ status: "paused", ...progress() });
            else if (data === 0) publish({ status: "ended", ...progress() });
          },
          onError: ({ data }) => {
            cleanup();
            clearInterval(this.ticker);
            const message =
              data === 153
                ? "YouTube 拒絕此網頁的來源，請透過 HTTP(S) 開啟並保留 Referer"
                : "無法播放此曲目（" + data + "）";
            if (!signal.aborted) publish({ status: "error", message });
            reject(new Error(message));
          },
          onAutoplayBlocked: () => {
            if (!signal.aborted)
              publish({
                status: "ready",
                message: "瀏覽器阻擋自動播放，請點擊播放按鈕",
              });
          },
        },
      });
    });
  }

  async play() {
    if (this.audio) {
      const audio = this.audio;
      if (!this.context && typeof AudioContext !== "undefined") {
        try {
          this.context = getSharedAudioContext();
          this.analyser = this.context.createAnalyser();
          this.analyser.fftSize = 256;
          this.analyser.smoothingTimeConstant = 0.72;
          this.gain = this.context.createGain();
          this.source = this.context.createMediaElementSource(audio);
          this.source
            .connect(this.analyser)
            .connect(this.gain)
            .connect(this.context.destination);
          this.volume(this.level);
        } catch {
          this.source = undefined;
          this.analyser = undefined;
          this.gain = undefined;
          this.context = undefined;
        }
      }
      void this.context?.resume().catch(() => {});
      await audio.play();
      return;
    }
    if (!this.visible && this.frame) {
      this.frame.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
    this.player?.playVideo();
  }
  pause() {
    if (this.audio) {
      this.audio.pause();
      return;
    }
    this.player?.pauseVideo();
  }
  seek(value: number) {
    if (this.audio) {
      this.audio.currentTime = value;
      return;
    }
    this.player?.seekTo(value, true);
  }
  volume(value: number) {
    this.level = value;
    if (this.audio) {
      if (this.gain && this.context) {
        this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.012);
        this.audio.volume = 1;
      } else if (this.gain) {
        this.gain.gain.value = value;
        this.audio.volume = 1;
      } else this.audio.volume = value;
      this.audio.muted = value === 0;
      return;
    }
    this.player?.setVolume(Math.round(value * 100));
    if (value === 0) this.player?.mute();
    else this.player?.unMute();
  }
  destroy() {
    clearInterval(this.ticker);
    this.observer?.disconnect();
    if (this.audio) {
      const sid = this.streamSid;
      const wasProxy = Boolean(sid) || this.audio.src.includes("/__rhine/");
      this.streamSid = undefined;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      try { this.source?.disconnect(); } catch {}
      try { this.analyser?.disconnect(); } catch {}
      try { this.gain?.disconnect(); } catch {}
      this.source = undefined;
      this.analyser = undefined;
      this.gain = undefined;
      this.context = undefined;
      this.audio = undefined;
      if (wasProxy && typeof fetch === "function") {
        const abortUrl = sid
          ? "/__rhine/stream-abort?sid=" + encodeURIComponent(sid)
          : "/__rhine/stream-abort";
        void fetch(abortUrl, {
          method: "POST",
          keepalive: true,
        }).catch(() => {});
      }
    }
    try {
      this.player?.destroy();
    } catch {
      /* Ignore partially initialized player teardown errors. */
    }
    this.frame?.remove();
  }
}

export class StreamAdapter implements Adapter {
  private audio = new Audio();
  private context?: AudioContext;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;
  private level = 1;
  private preferProxy: boolean | (() => Promise<boolean>);
  private getAudioQuality: () => AudioQuality;
  private streamSid?: string;
  analyser?: AnalyserNode;

  constructor(
    preferProxy: boolean | (() => Promise<boolean>) = false,
    getAudioQuality: () => AudioQuality = () => "auto",
  ) {
    this.preferProxy = preferProxy;
    this.getAudioQuality = getAudioQuality;
  }

  async load(track: Track, publish: Publish, signal: AbortSignal) {
    const targetUrl = track.url || track.id;
    const useProxy =
      typeof this.preferProxy === "function"
        ? await this.preferProxy()
        : this.preferProxy;
    signal.throwIfAborted();
    if (!useProxy && !/\.(mp3|m4a|flac|ogg|opus|wav|aac|webm)(\?|$)/i.test(targetUrl)) {
      throw new Error("此網路串流需要桌面版 RhineLab-Music.exe 代理播放");
    }
    const sid = useProxy ? (this.streamSid = String(++nextStreamSid)) : undefined;
    const q = this.getAudioQuality();
    const baseUrl = useProxy
      ? "/__rhine/stream?url=" +
        encodeURIComponent(targetUrl) +
        "&sid=" +
        encodeURIComponent(sid!) +
        "&q=" +
        encodeURIComponent(q)
      : targetUrl;

    const audio = this.audio;
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    const progress = () => ({
      time: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    });
    audio.addEventListener("timeupdate", () => publish(progress()), { signal });
    audio.addEventListener("durationchange", () => publish(progress()), {
      signal,
    });
    audio.addEventListener(
      "playing",
      () => publish({ status: "playing", message: undefined }),
      { signal },
    );
    audio.addEventListener(
      "pause",
      () => {
        if (!audio.ended) publish({ status: "paused" });
      },
      { signal },
    );
    audio.addEventListener(
      "ended",
      () => publish({ ...progress(), status: "ended" }),
      { signal },
    );

    let settled = false;
    let recoveries = 0;
    let recovering = false;
    const attemptRecover = () => {
      if (recovering || signal.aborted || recoveries >= 3) return false;
      recoveries++;
      recovering = true;
      const resumeAt = audio.currentTime || 0;
      const wasPlaying = !audio.paused;
      publish({ message: "串流重連中（第 " + recoveries + " 次）…" });
      const onReady = () => {
        recovering = false;
        if (signal.aborted) return;
        if (resumeAt > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = Math.min(resumeAt, audio.duration);
        }
        if (wasPlaying) void audio.play().catch(() => {});
        publish({ message: undefined });
      };
      audio.addEventListener("loadedmetadata", onReady, { once: true, signal });
      audio.src = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "_r=" + Date.now();
      audio.load();
      return true;
    };

    const loaded = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => {
          settled = true;
          reject(new Error("讀取網路音訊串流逾時"));
        },
        32000,
      );
      audio.addEventListener(
        "loadedmetadata",
        () => {
          clearTimeout(timeout);
          settled = true;
          publish({ ...progress(), status: "ready" });
          resolve();
        },
        { once: true, signal },
      );
      audio.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          if (!settled) {
            settled = true;
            reject(new Error("無法載入此網路音訊串流"));
          } else {
            recovering = false;
            if (!attemptRecover()) {
              publish({
                status: "error",
                message: "網路音訊串流中斷，請稍後重試",
              });
            }
          }
        },
        { signal },
      );
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          settled = true;
          reject(signal.reason);
        },
        { once: true },
      );
    });

    audio.src = baseUrl;
    audio.load();
    await loaded;
  }

  async play() {
    const audio = this.audio;
    if (!this.context && typeof AudioContext !== "undefined") {
      try {
        this.context = getSharedAudioContext();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.72;
        this.gain = this.context.createGain();
        this.source = this.context.createMediaElementSource(audio);
        this.source
          .connect(this.analyser)
          .connect(this.gain)
          .connect(this.context.destination);
        this.volume(this.level);
      } catch {
        this.source = undefined;
        this.analyser = undefined;
        this.gain = undefined;
        this.context = undefined;
      }
    }
    void this.context?.resume().catch(() => {});
    await audio.play();
  }

  pause() {
    this.audio.pause();
  }
  seek(value: number) {
    this.audio.currentTime = value;
  }
  volume(value: number) {
    this.level = value;
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.012);
      this.audio.volume = 1;
    } else if (this.gain) {
      this.gain.gain.value = value;
      this.audio.volume = 1;
    } else this.audio.volume = value;
    this.audio.muted = value === 0;
  }
  destroy() {
    const sid = this.streamSid;
    const wasProxy = Boolean(sid) || this.audio.src.includes("/__rhine/");
    this.streamSid = undefined;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    try { this.source?.disconnect(); } catch {}
    try { this.analyser?.disconnect(); } catch {}
    try { this.gain?.disconnect(); } catch {}
    this.source = undefined;
    this.analyser = undefined;
    this.gain = undefined;
    this.context = undefined;
    if (wasProxy && typeof fetch === "function") {
      const abortUrl = sid
        ? "/__rhine/stream-abort?sid=" + encodeURIComponent(sid)
        : "/__rhine/stream-abort";
      void fetch(abortUrl, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    }
  }
}

interface SpotifyPlayerInstance {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: unknown) => void): void;
  togglePlay(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(positionMs: number): Promise<void>;
  setVolume(volume: number): Promise<void>;
}
interface SpotifyWindow extends Window {
  Spotify?: {
    Player: new (opts: {
      name: string;
      getOAuthToken: (cb: (token: string) => void) => void;
      volume?: number;
    }) => SpotifyPlayerInstance;
  };
  onSpotifyWebPlaybackSDKReady?: () => void;
}
let spotifySdkPromise: Promise<NonNullable<SpotifyWindow["Spotify"]>> | undefined;
function loadSpotifySdk() {
  const w = window as SpotifyWindow;
  if (w.Spotify?.Player) return Promise.resolve(w.Spotify);
  return (spotifySdkPromise ??= new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      spotifySdkPromise = undefined;
      reject(new Error("Spotify Web Playback SDK 載入逾時"));
    }, 10000);
    w.onSpotifyWebPlaybackSDKReady = () => {
      clearTimeout(timeout);
      if (w.Spotify?.Player) resolve(w.Spotify);
      else reject(new Error("Spotify Web Playback SDK 初始化失敗"));
    };
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      spotifySdkPromise = undefined;
      reject(new Error("無法連線 Spotify Web Playback SDK"));
    };
    document.head.append(script);
  }));
}

export class SpotifyAdapter implements Adapter {
  private sdkPlayer?: SpotifyPlayerInstance;
  private deviceId?: string;
  private session?: SpotifySession;
  private trackId = "";
  private level = 0.8;
  private ticker?: number;
  private positionMs = 0;
  private durationMs = 0;
  private paused = true;

  async load(track: Track, publish: Publish, signal: AbortSignal) {
    this.trackId = track.id;
    const raw = loadSpotifySession();
    if (!raw) {
      publish({
        status: "external",
        message: "尚未登入 Spotify 帳號，請先於「平台帳號」授權登入。",
        audioInfo: track.audioInfo,
      });
      return;
    }
    this.session = await ensureFreshSpotifyToken(raw);
    signal.throwIfAborted();

    if (this.session.product !== "premium") {
      publish({
        status: "external",
        message:
          "Spotify Web Playback SDK 僅支援 Premium 帳號；目前為免費方案，請點擊連結於 Spotify 開啟完整曲目。",
        audioInfo: {
          codec: "Spotify",
          detail: "受限於 Spotify Free 方案，無法於站內串流完整曲目",
        },
      });
      return;
    }

    try {
      const Spotify = await loadSpotifySdk();
      signal.throwIfAborted();
      const player = (this.sdkPlayer = new Spotify.Player({
        name: "RhineLab Music",
        getOAuthToken: (cb) => {
          const current = loadSpotifySession();
          if (!current) return;
          void ensureFreshSpotifyToken(current)
            .then((fresh) => {
              this.session = fresh;
              cb(fresh.accessToken);
            })
            .catch(() => {});
        },
        volume: this.level,
      }));

      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Spotify 裝置連線逾時")),
          10000,
        );
        const onAbort = () => {
          clearTimeout(timeout);
          try {
            player.disconnect();
          } catch {}
          reject(signal.reason);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        player.addListener("ready", (data) => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          this.deviceId = (data as { device_id: string }).device_id;
          resolve();
        });
        player.addListener("initialization_error", (e) => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          reject(new Error((e as { message?: string }).message || "DRM / EME 初始化失敗"));
        });
        player.addListener("authentication_error", (e) => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          reject(new Error((e as { message?: string }).message || "Spotify 授權驗證失敗"));
        });
        player.addListener("account_error", (e) => {
          clearTimeout(timeout);
          signal.removeEventListener("abort", onAbort);
          reject(new Error((e as { message?: string }).message || "需要 Spotify Premium"));
        });
        player.addListener("player_state_changed", (rawState) => {
          const st = rawState as {
            paused?: boolean;
            position?: number;
            duration?: number;
          } | null;
          if (!st || signal.aborted) return;
          const wasPlaying = !this.paused;
          const prevPos = this.positionMs;
          const nextPaused = Boolean(st.paused);
          const nextPos = st.position ?? 0;
          const nextDur = st.duration ?? (track.duration ?? 0) * 1000;
          this.paused = nextPaused;
          this.positionMs = nextPos;
          this.durationMs = nextDur;
          if (
            wasPlaying &&
            nextPaused &&
            nextPos === 0 &&
            nextDur > 0 &&
            prevPos >= Math.max(1000, nextDur - 3000)
          ) {
            publish({
              status: "ended",
              time: nextDur / 1000,
              duration: nextDur / 1000,
              message: undefined,
            });
            return;
          }
          publish({
            status: nextPaused ? "paused" : "playing",
            time: this.positionMs / 1000,
            duration: this.durationMs / 1000,
            message: undefined,
          });
        });
        void player.connect().then((ok) => {
          if (!ok) {
            clearTimeout(timeout);
            signal.removeEventListener("abort", onAbort);
            reject(new Error("無法連接 Spotify Web Playback SDK"));
          }
        });
      });

      this.ticker = window.setInterval(() => {
        if (!this.paused && !document.hidden) {
          this.positionMs += 300;
          publish({
            time: Math.min(this.positionMs, this.durationMs) / 1000,
            duration: this.durationMs / 1000,
          });
        }
      }, 300);

      publish({
        status: "ready",
        duration: track.duration ?? 0,
        audioInfo: {
          codec: "Spotify SDK",
          detail: "官方 Web Playback SDK（受瀏覽器 DRM 保護，無原始音訊分析）",
        },
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      publish({
        status: "external",
        message:
          "Spotify 內嵌播放受環境 DRM/EME 或帳號限制（" +
          msg +
          "）；清單已同步，可點擊「在 Spotify 開啟」播放。",
        audioInfo: {
          codec: "Spotify",
          detail: "受平台 DRM/EME 限制，改為外部開啟",
        },
      });
    }
  }

  async play() {
    if (!this.session || !this.deviceId) return;
    if (this.paused && this.positionMs > 0) {
      await this.sdkPlayer?.resume();
    } else {
      await controlSpotifyApi(
        this.session,
        "PUT",
        "/me/player/play?device_id=" + encodeURIComponent(this.deviceId),
        { uris: ["spotify:track:" + this.trackId] },
      );
    }
  }
  pause() {
    void this.sdkPlayer?.pause().catch(() => {});
  }
  seek(seconds: number) {
    void this.sdkPlayer?.seek(Math.round(seconds * 1000)).catch(() => {});
  }
  volume(value: number) {
    this.level = value;
    void this.sdkPlayer?.setVolume(value).catch(() => {});
  }
  destroy() {
    clearInterval(this.ticker);
    try {
      this.sdkPlayer?.disconnect();
    } catch {}
    this.sdkPlayer = undefined;
    this.deviceId = undefined;
  }
}
