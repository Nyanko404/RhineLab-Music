import { trackKey, type Source, type Track } from "./types.ts";

export const youtubeId = /^[\w-]{11}$/;
const youtubeHosts = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
];

const streamHostSuffixes = [
  "soundcloud.com",
  "bandcamp.com",
  "bilibili.com",
  "b23.tv",
  "mixcloud.com",
  "vimeo.com",
  "twitch.tv",
  "nicovideo.jp",
  "audiomack.com",
  "archive.org",
  "music.163.com",
  "y.qq.com",
  "dailymotion.com",
  "hearthis.at",
  "jamendo.com",
];

const drmHostSuffixes = [
  "spotify.com",
  "music.apple.com",
  "tidal.com",
  "music.amazon.com",
  "deezer.com",
  "qobuz.com",
];

const directAudioExt = /\.(mp3|m4a|flac|ogg|opus|wav|aac|webm)$/i;

function hostMatches(hostname: string, suffixes: string[]): boolean {
  const host = hostname.toLowerCase();
  return suffixes.some(
    (suffix) => host === suffix || host.endsWith("." + suffix),
  );
}

export function isDrmPlatformUrl(input: string): boolean {
  const trimmed = input.trim();
  if (/^(spotify|apple-music):/i.test(trimmed)) return true;
  try {
    const url = new URL(normalizeUrlInput(trimmed));
    return hostMatches(url.hostname, drmHostSuffixes);
  } catch {
    return false;
  }
}

export function isSupportedStreamPlaylist(input: string): boolean {
  try {
    const url = new URL(normalizeUrlInput(input));
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (hostMatches(host, ["soundcloud.com"]) && path.includes("/sets/"))
      return true;
    if (hostMatches(host, ["bandcamp.com"]) && path.startsWith("/album/"))
      return true;
    if (
      hostMatches(host, ["bilibili.com"]) &&
      (path.includes("/medialist/") || path.includes("/favlist"))
    )
      return true;
    return false;
  } catch {
    return false;
  }
}

function normalizeUrlInput(input: string): string {
  const trimmed = input.trim();
  if (/^http:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)) {
    return "https://" + trimmed.slice(7);
  }
  if (/^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)) {
    return "https://" + trimmed;
  }
  return trimmed;
}

export const youtubePlaylistId = (input: string) => {
  try {
    const url = new URL(normalizeUrlInput(input));
    const list = url.searchParams.get("list");
    return url.protocol === "https:" &&
      (youtubeHosts.includes(url.hostname) || url.hostname === "youtu.be") &&
      list &&
      /^[\w-]{2,120}$/.test(list)
      ? list
      : null;
  } catch {
    return null;
  }
};

export function publicTrack(
  source: Exclude<Source, "local">,
  id: string,
  url: string,
  title?: string,
): Track {
  return {
    key: trackKey(source, id),
    source,
    id,
    title: title || id,
    album: "",
    artist: "",
    url,
  };
}

export function parseTrackLink(input: string): Track | null {
  input = normalizeUrlInput(input);
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const hostLower = url.hostname.toLowerCase();
    const [, type, value] = url.pathname.split("/");
    if (youtubeHosts.includes(hostLower) || hostLower === "youtu.be") {
      if (url.protocol !== "https:") return null;
      const id =
        hostLower === "youtu.be"
          ? type
          : (url.searchParams.get("v") ?? value);
      if (id && youtubeId.test(id)) {
        const host =
          hostLower === "music.youtube.com"
            ? hostLower
            : "www.youtube.com";
        return publicTrack("youtube", id, "https://" + host + "/watch?v=" + id);
      }
      return null;
    }
    if (
      hostLower.includes("youtube.com") ||
      hostLower.includes("youtu.be") ||
      hostMatches(hostLower, drmHostSuffixes)
    ) {
      return null;
    }
    if (
      hostMatches(hostLower, streamHostSuffixes) ||
      directAudioExt.test(url.pathname)
    ) {
      const slug = decodeURIComponent(
        url.pathname.split("/").filter(Boolean).pop() ?? hostLower,
      ).replace(/\.[a-z0-9]{2,5}$/i, "");
      return publicTrack("stream", url.href, url.href, slug || hostLower);
    }
  } catch {
    return null;
  }
  return null;
}
