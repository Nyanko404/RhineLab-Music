import { publicTrack, youtubeId } from "./links.ts";
import type { Track } from "./types.ts";

const youtubeKey =
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_YOUTUBE_API_KEY?.trim()
    : undefined;
export const youtubeConfigured = Boolean(youtubeKey);
export const youtubeSearchUrl = (query: string) =>
  "https://www.youtube.com/results?search_query=" + encodeURIComponent(query);

export async function fetchJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(12000);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("請求過多，稍後重試");
    if (response.status === 401 || response.status === 403)
      throw new Error("服務拒絕請求，請檢查 API 金鑰、授權或配額");
    throw new Error("服務回應 HTTP " + response.status);
  }
  return response.json() as Promise<T>;
}

async function fetchPublicPage(
  targetUrl: string,
  missingHostMessage: string,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = AbortSignal.timeout(15000);
  const res = await fetch(
    "/__rhine/fetch-public?url=" + encodeURIComponent(targetUrl),
    {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    },
  );
  if (res.status === 404) throw new Error(missingHostMessage);
  if (!res.ok) {
    let detail = "";
    try {
      const err = (await res.json()) as { error?: string };
      if (err?.error) detail = "：" + err.error;
    } catch {
      /* Ignore non-JSON error bodies. */
    }
    throw new Error("無法讀取公開頁面（HTTP " + res.status + "）" + detail);
  }
  return res.text();
}

interface YouTubeItem {
  id: string | { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    videoOwnerChannelTitle?: string;
    resourceId?: { videoId?: string };
    thumbnails?: Record<string, { url: string }>;
  };
  status?: { embeddable?: boolean; privacyStatus?: string };
}
const text = (value?: string) => {
  if (!value) return "";
  if (typeof document === "undefined") return value;
  const node = document.createElement("textarea");
  node.innerHTML = value.replace(/</g, "&lt;");
  return node.value;
};
function youtubeTrack(item: YouTubeItem): Track[] {
  const snippet = item.snippet;
  const id =
    snippet?.resourceId?.videoId ??
    (typeof item.id === "string" ? item.id : item.id.videoId);
  if (
    !id ||
    !youtubeId.test(id) ||
    !snippet ||
    item.status?.embeddable === false ||
    item.status?.privacyStatus === "private" ||
    ["Private video", "Deleted video"].includes(snippet.title ?? "")
  )
    return [];
  return [
    {
      ...publicTrack(
        "youtube",
        id,
        "https://www.youtube.com/watch?v=" + id,
        text(snippet.title),
      ),
      artist: text(snippet.videoOwnerChannelTitle || snippet.channelTitle),
      metadataExpiresAt: Date.now() + 29 * 24 * 60 * 60 * 1000,
      artwork:
        snippet.thumbnails?.high?.url ??
        snippet.thumbnails?.medium?.url ??
        snippet.thumbnails?.default?.url ??
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    },
  ];
}
async function youtubeRequest(
  resource: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  if (!youtubeKey) throw new Error("請先設定 YouTube Data API 金鑰");
  const url = new URL("https://www.googleapis.com/youtube/v3/" + resource);
  url.search = new URLSearchParams({ ...params, key: youtubeKey }).toString();
  return fetchJson<{ items?: YouTubeItem[]; nextPageToken?: string }>(
    url,
    signal,
  );
}
export async function searchYouTube(query: string, signal: AbortSignal) {
  return (
    (
      await youtubeRequest(
        "search",
        {
          part: "snippet",
          q: query,
          type: "video",
          videoEmbeddable: "true",
          maxResults: "20",
        },
        signal,
      )
    ).items?.flatMap(youtubeTrack) ?? []
  );
}
export async function resolveDesktopTrack(
  track: Track,
  signal?: AbortSignal,
): Promise<Track> {
  const targetUrl = track.url;
  if (!targetUrl) return track;
  const timeout = AbortSignal.timeout(32000);
  const res = await fetch(
    "/__rhine/resolve?url=" + encodeURIComponent(targetUrl),
    {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    },
  );
  if (res.status === 404) {
    throw new Error("串流解析需要桌面版 RhineLab-Music.exe。");
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    duration?: number;
    webpageUrl?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "無法解析此網站的音訊串流（HTTP " + res.status + "）");
  }
  return {
    ...track,
    title: track.customTitle ? track.title : data.title?.trim() || track.title,
    artist: data.artist?.trim() || track.artist,
    album: data.album?.trim() || track.album,
    artwork:
      typeof data.artwork === "string" && /^https?:\/\//i.test(data.artwork)
        ? data.artwork
        : track.artwork,
    duration:
      typeof data.duration === "number" && data.duration > 0
        ? data.duration
        : track.duration,
    url: data.webpageUrl || track.url,
    metadataExpiresAt: Date.now() + 29 * 24 * 60 * 60 * 1000,
  };
}

export async function importStreamPlaylist(
  targetUrl: string,
  signal?: AbortSignal,
): Promise<{ name: string; tracks: Track[] }> {
  const timeout = AbortSignal.timeout(38000);
  const res = await fetch(
    "/__rhine/resolve-playlist?url=" + encodeURIComponent(targetUrl),
    {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    },
  );
  if (res.status === 404) {
    throw new Error("讀取公開播放清單需要桌面版 RhineLab-Music.exe。");
  }
  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    name?: string;
    tracks?: Array<{
      id?: string;
      title?: string;
      artist?: string;
      artwork?: string;
      duration?: number;
      url?: string;
    }>;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "無法讀取播放清單（HTTP " + res.status + "）");
  }
  const expiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000;
  const tracks: Track[] = [];
  for (const item of data.tracks ?? []) {
    if (!item.url || !item.title) continue;
    tracks.push({
      ...publicTrack("stream", item.url, item.url, item.title),
      artist: item.artist ?? "",
      artwork:
        typeof item.artwork === "string" && /^https?:\/\//i.test(item.artwork)
          ? item.artwork
          : undefined,
      duration:
        typeof item.duration === "number" && item.duration > 0
          ? item.duration
          : undefined,
      metadataExpiresAt: expiresAt,
    });
  }
  return {
    name: data.name?.trim() || "網路串流播放清單",
    tracks: [...new Map(tracks.map((t) => [t.key, t])).values()],
  };
}

export async function enrichTrack(track: Track): Promise<Track> {
  if (track.source === "stream") {
    return resolveDesktopTrack(track);
  }
  if (track.source !== "youtube") return track;
  if (youtubeConfigured) {
    const [metadata] =
      (
        await youtubeRequest("videos", { part: "snippet,status", id: track.id })
      ).items?.flatMap(youtubeTrack) ?? [];
    return metadata
      ? {
          ...metadata,
          url: track.url,
          ...(track.customTitle
            ? { customTitle: true, title: track.title }
            : {}),
        }
      : track;
  }
  const oembedUrl =
    "https://www.youtube.com/oembed?url=" +
    encodeURIComponent("https://www.youtube.com/watch?v=" + track.id) +
    "&format=json";
  let raw: string | undefined;
  try {
    raw = await fetchPublicPage(oembedUrl, "missing");
  } catch {
    const res = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (res.ok) raw = await res.text();
  }
  if (!raw) {
    return {
      ...track,
      artwork: track.artwork ?? `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
    };
  }
  const data = JSON.parse(raw) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  };
  return {
    ...track,
    title: track.customTitle ? track.title : data.title?.trim() || track.title,
    artist: data.author_name?.trim() || track.artist,
    artwork:
      (typeof data.thumbnail_url === "string" &&
      data.thumbnail_url.startsWith("https://")
        ? data.thumbnail_url
        : undefined) ??
      track.artwork ??
      `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`,
    metadataExpiresAt: Date.now() + 29 * 24 * 60 * 60 * 1000,
  };
}

function extractBalancedJson(source: string, startBrace: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startBrace; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(startBrace, i + 1);
    }
  }
  return null;
}

function extractYtInitialData(html: string): Record<string, unknown> | null {
  const markers = [
    /var\s+ytInitialData\s*=\s*\{/,
    /window\[\s*["']ytInitialData["']\s*\]\s*=\s*\{/,
    /ytInitialData\s*=\s*\{/,
  ];
  for (const marker of markers) {
    const match = marker.exec(html);
    if (!match) continue;
    const braceIndex = match.index + match[0].length - 1;
    const jsonText = extractBalancedJson(html, braceIndex);
    if (!jsonText) continue;
    try {
      return JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      /* Try next marker. */
    }
  }
  return null;
}

function readRunsText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const obj = node as {
    simpleText?: string;
    content?: string;
    runs?: Array<{ text?: string }>;
  };
  if (typeof obj.simpleText === "string") return obj.simpleText;
  if (typeof obj.content === "string") return obj.content;
  if (Array.isArray(obj.runs))
    return obj.runs.map((r) => r.text ?? "").join("");
  return "";
}

function parseDurationText(raw: string): number | undefined {
  const parts = raw
    .trim()
    .split(":")
    .map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0))
    return undefined;
  let total = 0;
  for (const n of parts) total = total * 60 + n;
  return total > 0 ? total : undefined;
}

function pickThumbnail(sources: unknown, videoId: string): string {
  if (Array.isArray(sources) && sources.length) {
    for (let i = sources.length - 1; i >= 0; i--) {
      const url = (sources[i] as { url?: string })?.url;
      if (typeof url === "string" && url.startsWith("https://")) return url;
    }
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function parseYouTubePlaylistHtml(
  html: string,
  fallbackName = "YouTube 播放清單",
): { name: string; tracks: Track[] } {
  const data = extractYtInitialData(html);
  if (!data) throw new Error("無法解析 YouTube 播放清單頁面資料");

  const typed = data as {
    metadata?: { playlistMetadataRenderer?: { title?: string } };
    header?: {
      playlistHeaderRenderer?: { title?: unknown };
      pageHeaderRenderer?: { pageTitle?: string };
    };
    contents?: {
      twoColumnWatchNextResults?: {
        playlist?: {
          playlist?: { title?: string; titleText?: unknown };
        };
      };
    };
  };

  const metaTitle =
    typed?.metadata?.playlistMetadataRenderer?.title ||
    readRunsText(typed?.header?.playlistHeaderRenderer?.title) ||
    typed?.header?.pageHeaderRenderer?.pageTitle ||
    typed?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.title ||
    readRunsText(
      typed?.contents?.twoColumnWatchNextResults?.playlist?.playlist?.titleText,
    );

  const panelTracks: Track[] = [];
  const playlistTracks: Track[] = [];
  const expiresAt = Date.now() + 29 * 24 * 60 * 60 * 1000;
  const blockedTitles = new Set([
    "Private video",
    "Deleted video",
    "[Private video]",
    "[Deleted video]",
  ]);

  function walk(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    const isPanel = Boolean(obj.playlistPanelVideoRenderer);
    const renderer = (obj.playlistVideoRenderer ??
      obj.playlistPanelVideoRenderer) as
      | {
          videoId?: string;
          title?: unknown;
          shortBylineText?: unknown;
          longBylineText?: unknown;
          thumbnail?: { thumbnails?: unknown };
          lengthSeconds?: string;
          lengthText?: unknown;
        }
      | undefined;
    if (renderer && typeof renderer === "object") {
      const id = renderer.videoId;
      const title = readRunsText(renderer.title).trim();
      if (id && youtubeId.test(id) && title && !blockedTitles.has(title)) {
        const seconds = Number(renderer.lengthSeconds);
        const duration =
          Number.isFinite(seconds) && seconds > 0
            ? seconds
            : parseDurationText(readRunsText(renderer.lengthText));
        (isPanel ? panelTracks : playlistTracks).push({
          ...publicTrack(
            "youtube",
            id,
            "https://www.youtube.com/watch?v=" + id,
            title,
          ),
          artist: (
            readRunsText(renderer.shortBylineText) ||
            readRunsText(renderer.longBylineText)
          ).trim(),
          artwork: pickThumbnail(renderer.thumbnail?.thumbnails, id),
          duration,
          metadataExpiresAt: expiresAt,
        });
      }
      return;
    }
    if (obj.lockupViewModel && typeof obj.lockupViewModel === "object") {
      const l = obj.lockupViewModel as {
        contentId?: string;
        metadata?: {
          lockupMetadataViewModel?: {
            title?: { content?: string };
            metadata?: {
              contentMetadataViewModel?: {
                metadataRows?: Array<{
                  metadataParts?: Array<{ text?: { content?: string } }>;
                }>;
              };
            };
          };
        };
        contentImage?: {
          thumbnailViewModel?: {
            image?: { sources?: unknown };
          };
        };
      };
      const id = l.contentId;
      const title =
        l.metadata?.lockupMetadataViewModel?.title?.content?.trim() ?? "";
      if (id && youtubeId.test(id) && title && !blockedTitles.has(title)) {
        const artist =
          l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel
            ?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content?.trim() ?? "";
        const sources = l.contentImage?.thumbnailViewModel?.image?.sources;
        playlistTracks.push({
          ...publicTrack(
            "youtube",
            id,
            "https://www.youtube.com/watch?v=" + id,
            title,
          ),
          artist,
          artwork: pickThumbnail(sources, id),
          metadataExpiresAt: expiresAt,
        });
      }
      return;
    }
    for (const key of Object.keys(obj)) walk(obj[key]);
  }

  walk(data.contents ?? data);
  const chosen = panelTracks.length ? panelTracks : playlistTracks;
  const byKey = new Map<string, Track>();
  for (const track of chosen) {
    if (!byKey.has(track.key)) byKey.set(track.key, track);
  }
  return {
    name: metaTitle?.trim() || fallbackName,
    tracks: [...byKey.values()],
  };
}

export async function importYouTubePlaylist(
  id: string,
  signal?: AbortSignal,
  videoId?: string,
): Promise<{ name: string; tracks: Track[] }> {
  let apiError: unknown;
  if (youtubeConfigured) {
    try {
      const tracks: Track[] = [];
      let pageToken = "";
      const seen = new Set<string>();
      do {
        const page = await youtubeRequest(
          "playlistItems",
          {
            part: "snippet,status",
            playlistId: id,
            maxResults: "50",
            ...(pageToken ? { pageToken } : {}),
          },
          signal,
        );
        tracks.push(...(page.items ?? []).flatMap(youtubeTrack));
        if (pageToken) seen.add(pageToken);
        pageToken = page.nextPageToken ?? "";
        if (seen.has(pageToken)) throw new Error("YouTube 傳回重複的清單頁面");
      } while (pageToken);
      return {
        name: "YouTube " + id,
        tracks: [...new Map(tracks.map((track) => [track.key, track])).values()],
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      apiError = error;
    }
  }

  const missingHostMsg =
    "讀取 YouTube 公開播放清單需要桌面版 RhineLab-Music.exe，或設定 YouTube Data API 金鑰。";
  const watchUrl = videoId
    ? "https://www.youtube.com/watch?v=" +
      encodeURIComponent(videoId) +
      "&list=" +
      encodeURIComponent(id)
    : undefined;
  const playlistUrl =
    "https://www.youtube.com/playlist?list=" + encodeURIComponent(id);

  try {
    if (id.startsWith("RD") && watchUrl) {
      const html = await fetchPublicPage(watchUrl, missingHostMsg, signal);
      return parseYouTubePlaylistHtml(html, "YouTube 合輯");
    }
    const html = await fetchPublicPage(playlistUrl, missingHostMsg, signal);
    const parsed = parseYouTubePlaylistHtml(html, "YouTube " + id);
    if (!parsed.tracks.length && watchUrl) {
      const watchHtml = await fetchPublicPage(watchUrl, missingHostMsg, signal);
      return parseYouTubePlaylistHtml(watchHtml, parsed.name);
    }
    return parsed;
  } catch (proxyError) {
    if (watchUrl) {
      try {
        const watchHtml = await fetchPublicPage(watchUrl, missingHostMsg, signal);
        const parsed = parseYouTubePlaylistHtml(watchHtml, "YouTube " + id);
        if (parsed.tracks.length) return parsed;
      } catch {
        /* Fall through to original error. */
      }
    }
    if (apiError) throw apiError;
    throw proxyError;
  }
}
