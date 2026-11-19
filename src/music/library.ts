import { assetUrl } from "../asset-url";
import {
  normalizeQuality,
  qualityPresets,
  type AntialiasMode,
  type RenderQuality,
  type RenderResolution,
} from "../render-quality";
import { parseLyrics, type LyricLine } from "./lyrics";
import {
  expireMetadata,
  trackKey,
  type AudioQuality,
  type Playlist,
  type Repeat,
  type Track,
} from "./types";

export type LightingMode = "reactive" | "rgb" | "breathing" | "custom" | "off";

export const observatory: Track = {
  key: "local:observatory",
  id: "observatory",
  source: "local",
  title: "觀測室 · Observatory",
  artist: "LBEILC",
  album: "RhineLabUI 原創配樂",
  audioInfo: { codec: "MP3", ext: "mp3", lossless: false, detail: "內建原創音軌" },
};
export interface Preferences {
  theme: "light" | "dark" | "system";
  accent: "orange" | "amber" | "slate";
  quality:
    | "original"
    | "balanced"
    | "performance"
    | "high"
    | "ultra"
    | "custom"
    | "off";
  customQuality?: RenderQuality;
  resolution: RenderResolution;
  antialias: AntialiasMode;
  motion: "full" | "reduced" | "system";
  font: number;
  sounds: boolean;
  soundVolume: number;
  volume: number;
  muted: boolean;
  repeat: Repeat;
  shuffle: boolean;
  lightingMode: LightingMode;
  lightingColor: string;
  audioQuality: AudioQuality;
  spotifyClientId?: string;
}
export const defaults: Preferences = {
  theme: "light",
  accent: "orange",
  quality: "original",
  customQuality: { ...qualityPresets.original },
  resolution: "native",
  antialias: "smaa",
  motion: "full",
  font: 100,
  sounds: true,
  soundVolume: 0.65,
  volume: 0.8,
  muted: false,
  repeat: "off",
  shuffle: false,
  lightingMode: "reactive",
  lightingColor: "#ed853d",
  audioQuality: "auto",
};
export interface LibraryState {
  tracks: Track[];
  favorites: string[];
  playlists: Playlist[];
  recent: { key: string; when: number }[];
  notes: Record<string, string>;
  customArtworks?: string[];
  prefs: Preferences;
  session?: { key: string; position: number; queue: string[] };
}
const empty = (): LibraryState => ({
  tracks: [],
  favorites: [],
  playlists: [],
  recent: [],
  notes: {},
  customArtworks: [],
  prefs: { ...defaults, customQuality: { ...qualityPresets.original } },
});
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error("本機資料庫開啟逾時"));
      }
    }, 4500);
    const request = indexedDB.open("rhine-music", 1);
    request.onupgradeneeded = () => {
      for (const name of ["settings", "audio", "artwork", "lyrics"])
        request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(request.error);
      }
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new Error("另一個分頁正在使用舊版音樂資料庫"));
      }
    };
  });

export class Library {
  state = empty();
  private db?: IDBDatabase;
  private revisions = Promise.resolve();
  private urls = new Map<string, Promise<string | undefined>>();
  private memory = new Map<string, unknown>();

  async init() {
    this.db = await open();
    try {
      const saved = await this.read<LibraryState>("settings", "library");
      if (saved)
        this.state = {
          ...empty(),
          ...saved,
          customArtworks: Array.isArray(saved.customArtworks)
            ? saved.customArtworks
            : [],
          prefs: {
            ...defaults,
            ...saved.prefs,
            resolution:
              saved.prefs?.resolution === "1080p" ||
              saved.prefs?.resolution === "2k" ||
              saved.prefs?.resolution === "4k" ||
              saved.prefs?.resolution === "native"
                ? saved.prefs.resolution
                : defaults.resolution,
            antialias:
              saved.prefs?.antialias === "off" ||
              saved.prefs?.antialias === "fxaa" ||
              saved.prefs?.antialias === "smaa" ||
              saved.prefs?.antialias === "taa"
                ? saved.prefs.antialias
                : defaults.antialias,
            motion:
              saved.prefs?.motion === "reduced" ||
              saved.prefs?.motion === "system" ||
              saved.prefs?.motion === "full"
                ? saved.prefs.motion
                : defaults.motion,
            customQuality: normalizeQuality(saved.prefs?.customQuality),
          },
        };
      await this.pruneExpired();
    } catch (error) {
      this.db.close();
      this.db = undefined;
      throw error;
    }
  }

  private read<T>(store: string, key: string): Promise<T | undefined> {
    if (!this.db)
      return Promise.resolve(
        this.memory.get(store + ":" + key) as T | undefined,
      );
    const transaction = this.db.transaction(store, "readonly");
    return new Promise((resolve, reject) => {
      const request = transaction.objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private write(entries: [string, string, unknown][]) {
    if (!this.db) {
      for (const [store, key, value] of entries)
        this.memory.set(store + ":" + key, value);
      return Promise.resolve();
    }
    const transaction = this.db.transaction(
      [...new Set(entries.map(([store]) => store))],
      "readwrite",
    );
    return new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("資料未能儲存"));
      try {
        for (const [store, key, value] of entries)
          transaction.objectStore(store).put(value, key);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  }

  private enqueue(operation: () => Promise<void>) {
    const next = this.revisions.then(operation);
    this.revisions = next.catch(() => {});
    return next;
  }

  save() {
    return this.enqueue(() =>
      this.write([["settings", "library", this.state]]),
    );
  }

  find(key: string) {
    return this.state.tracks.find((track) => track.key === key);
  }

  async pruneExpired() {
    const before = this.state.tracks;
    const after = before.map((track) => expireMetadata(track));
    if (after.some((track, index) => track !== before[index])) {
      this.state.tracks = after;
      await this.save();
    }
  }

  async remember(tracks: Track[]) {
    await this.enqueue(async () => {
      const updated = new Map(
        this.state.tracks.map((track) => [track.key, track]),
      );
      const invalidated: string[] = [];
      for (const raw of tracks) {
        const track = expireMetadata(raw);
        const previous = updated.get(track.key);
        if (
          previous &&
          previous.artwork !== track.artwork &&
          !this.hasCustomArtwork(track.key)
        ) {
          invalidated.push(track.key);
        }
        updated.set(
          track.key,
          previous
            ? {
                ...previous,
                ...track,
                title: track.customTitle
                  ? track.title
                  : previous.customTitle || track.title === track.id
                    ? previous.title
                    : track.title,
                customTitle: track.customTitle || previous.customTitle,
                album: track.album || previous.album,
                artist: track.artist || previous.artist,
              }
            : track,
        );
      }
      const snapshot = { ...this.state, tracks: [...updated.values()] };
      await this.write([["settings", "library", snapshot]]);
      this.state.tracks = snapshot.tracks;
      for (const key of invalidated) this.invalidateArtwork(key);
    });
  }

  private audioUrls = new Map<string, string>();

  async getAudio(key: string, signal?: AbortSignal) {
    if (key !== observatory.key) return this.read<Blob>("audio", key);
    const response = await fetch(assetUrl("audio/observatory-preview.mp3"), {
      signal,
    });
    if (!response.ok) throw new Error("無法載入原創配樂");
    return response.blob();
  }

  async getAudioUrl(key: string, signal?: AbortSignal) {
    const cached = this.audioUrls.get(key);
    if (cached) {
      this.audioUrls.delete(key);
      this.audioUrls.set(key, cached);
      return cached;
    }
    const file = await this.getAudio(key, signal);
    signal?.throwIfAborted();
    if (!file) return undefined;
    const stillCached = this.audioUrls.get(key);
    if (stillCached) return stillCached;
    if (this.audioUrls.size >= 16) {
      const oldest = this.audioUrls.keys().next().value;
      if (oldest !== undefined) {
        const oldUrl = this.audioUrls.get(oldest);
        this.audioUrls.delete(oldest);
        if (oldUrl) URL.revokeObjectURL(oldUrl);
      }
    }
    const url = URL.createObjectURL(file);
    this.audioUrls.set(key, url);
    return url;
  }
  getLyrics(key: string) {
    return this.read<LyricLine[]>("lyrics", key);
  }

  async setLyrics(key: string, file: File) {
    const lyrics = parseLyrics(await file.text());
    if (!lyrics.length) throw new Error("找不到帶時間標記的 LRC 歌詞");
    await this.write([["lyrics", key, lyrics]]);
    return lyrics;
  }

  private artworkVersions = new Map<string, number>();

  hasCustomArtwork(key: string) {
    return this.state.customArtworks?.includes(key) ?? false;
  }

  artworkVersion(key: string) {
    return this.artworkVersions.get(key) ?? 0;
  }

  private invalidateArtwork(key: string) {
    void this.urls
      .get(key)
      ?.then((url) => {
        if (url) URL.revokeObjectURL(url);
      })
      .catch(() => {});
    this.urls.delete(key);
    this.artworkVersions.set(key, (this.artworkVersions.get(key) ?? 0) + 1);
  }

  async artwork(track: Track) {
    if (!this.urls.has(track.key)) {
      const url = this.read<Blob>("artwork", track.key).then((blob) =>
        blob
          ? URL.createObjectURL(blob)
          : track.source === "local"
            ? undefined
            : track.artwork,
      );
      this.urls.set(track.key, url);
      void url.catch(() => this.urls.delete(track.key));
    }
    return this.urls.get(track.key);
  }

  async setArtwork(key: string, file: File) {
    if (
      !file.type.startsWith("image/") &&
      !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)
    )
      throw new Error(file.name + "：不支援的圖片格式");
    await this.enqueue(async () => {
      const list = new Set(this.state.customArtworks ?? []);
      list.add(key);
      const snapshot = {
        ...this.state,
        customArtworks: [...list],
      };
      await this.write([
        ["artwork", key, file],
        ["settings", "library", snapshot],
      ]);
      this.state.customArtworks = snapshot.customArtworks;
      this.invalidateArtwork(key);
    });
  }

  async removeArtwork(key: string) {
    await this.enqueue(async () => {
      const customArtworks = (this.state.customArtworks ?? []).filter(
        (item) => item !== key,
      );
      const snapshot = { ...this.state, customArtworks };
      if (!this.db) {
        this.memory.delete("artwork:" + key);
        await this.write([["settings", "library", snapshot]]);
      } else {
        const tx = this.db.transaction(["artwork", "settings"], "readwrite");
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error("無法移除自訂封面"));
          tx.objectStore("artwork").delete(key);
          tx.objectStore("settings").put(snapshot, "library");
        });
      }
      this.state.customArtworks = customArtworks;
      this.invalidateArtwork(key);
    });
  }

  remove(key: string) {
    return this.removeMany([key]);
  }

  removeMany(keys: string[]) {
    const target = new Set(keys);
    if (!target.size) return Promise.resolve();
    return this.enqueue(async () => {
      const drop = (items: string[]) =>
        items.filter((candidate) => !target.has(candidate));
      const state = this.state;
      const notes = { ...state.notes };
      for (const key of target) delete notes[key];
      const snapshot = {
        ...state,
        notes,
        customArtworks: drop(state.customArtworks ?? []),
        tracks: state.tracks.filter((track) => !target.has(track.key)),
        favorites: drop(state.favorites),
        playlists: state.playlists.map((list) => ({
          ...list,
          tracks: drop(list.tracks),
        })),
        recent: state.recent.filter((entry) => !target.has(entry.key)),
        session:
          !state.session || target.has(state.session.key)
            ? undefined
            : { ...state.session, queue: drop(state.session.queue) },
      };
      if (!this.db) {
        for (const key of target) {
          for (const store of ["audio", "artwork", "lyrics"])
            this.memory.delete(store + ":" + key);
        }
        await this.write([["settings", "library", snapshot]]);
      } else {
        const tx = this.db.transaction(
          ["audio", "artwork", "lyrics", "settings"],
          "readwrite",
        );
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error("無法移除歌曲"));
          for (const key of target) {
            for (const store of ["audio", "artwork", "lyrics"])
              tx.objectStore(store).delete(key);
          }
          tx.objectStore("settings").put(snapshot, "library");
        });
      }
      Object.assign(state, snapshot);
      for (const key of target) {
        void this.urls
          .get(key)
          ?.then((url) => {
            if (url) URL.revokeObjectURL(url);
          })
          .catch(() => {});
        this.urls.delete(key);
        const audioUrl = this.audioUrls.get(key);
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
          this.audioUrls.delete(key);
        }
      }
    });
  }

  deletePlaylist(id: string) {
    return this.enqueue(async () => {
      const playlists = this.state.playlists.filter((list) => list.id !== id);
      if (playlists.length === this.state.playlists.length) return;
      const snapshot = { ...this.state, playlists };
      await this.write([["settings", "library", snapshot]]);
      this.state.playlists = playlists;
    });
  }

  async import(file: File) {
    if (
      !file.type.startsWith("audio/") &&
      !/\.(mp3|wav|flac|ogg|opus|m4a|aac|webm|aiff?)$/i.test(file.name)
    )
      throw new Error(file.name + "：不支援的音訊檔案");
    const id = crypto.randomUUID();
    const key = trackKey("local", id);
    const track: Track = {
      key,
      id,
      source: "local",
      title: file.name.replace(/\.[^.]+$/, ""),
      artist: "",
      album: "",
    };
    const entries: [string, string, unknown][] = [["audio", key, file]];
    let lyrics: LyricLine[] | undefined;
    // A playable file can have absent or damaged tags. Let the browser determine decoding support.
    try {
      const { parseBlob, TimestampFormat } = await import("music-metadata");
      const metadata = await parseBlob(file, { skipPostHeaders: true });
      const { title, artist, album, picture, year } = metadata.common;
      const extMatch = file.name.match(/\.([^.]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : undefined;
      Object.assign(track, {
        title: title || track.title,
        artist: artist || "",
        album: album || "",
        year,
        duration: metadata.format.duration,
        audioInfo: {
          codec: metadata.format.codec || ext?.toUpperCase(),
          ext,
          bitrateKbps: metadata.format.bitrate
            ? Math.round(metadata.format.bitrate / 1000)
            : undefined,
          sampleRateHz: metadata.format.sampleRate,
          bitDepth: metadata.format.bitsPerSample,
          lossless: Boolean(metadata.format.lossless),
        },
      });
      const cover = picture?.find((item) =>
        /image\/(jpeg|png|webp|gif)/i.test(item.format),
      );
      if (cover)
        entries.push([
          "artwork",
          key,
          new Blob([Uint8Array.from(cover.data)], { type: cover.format }),
        ]);
      const embedded = metadata.common.lyrics?.[0];
      if (embedded?.syncText?.length) {
        lyrics = embedded.syncText
          .map((line) => ({
            time:
              embedded.timeStampFormat === TimestampFormat.milliseconds &&
              typeof line.timestamp === "number"
                ? line.timestamp / 1000
                : -1,
            text: line.text,
          }))
          .sort((a, b) => a.time - b.time);
      } else if (embedded?.text) {
        lyrics = parseLyrics(embedded.text);
        if (!lyrics.length)
          lyrics = embedded.text
            .split(/\r?\n/)
            .filter(Boolean)
            .map((text) => ({ time: -1, text }));
      }
    } catch {
      /* Metadata is optional. */
    }
    if (lyrics?.length) entries.push(["lyrics", key, lyrics]);
    await this.enqueue(async () => {
      const snapshot = { ...this.state, tracks: [...this.state.tracks, track] };
      await this.write([...entries, ["settings", "library", snapshot]]);
      this.state.tracks = snapshot.tracks;
    });
    return track;
  }
}
