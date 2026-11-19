export type Source = "local" | "youtube" | "stream" | "spotify";
export type AudioQuality =
  | "auto"
  | "standard"
  | "high"
  | "very_high"
  | "lossless";
export interface AudioFormatInfo {
  codec?: string;
  ext?: string;
  bitrateKbps?: number;
  sampleRateHz?: number;
  bitDepth?: number;
  lossless?: boolean;
  detail?: string;
}
export interface Track {
  key: string;
  id: string;
  source: Source;
  title: string;
  artist: string;
  album: string;
  artwork?: string;
  url?: string;
  duration?: number;
  year?: number;
  metadataExpiresAt?: number;
  customTitle?: boolean;
  audioInfo?: AudioFormatInfo;
}
export function expireMetadata(track: Track, now = Date.now()): Track {
  if (
    track.source === "local" ||
    track.metadataExpiresAt === undefined ||
    now < track.metadataExpiresAt
  )
    return track;
  return {
    ...track,
    title: track.customTitle ? track.title : track.id,
    artist: "",
    album: "",
    artwork: undefined,
    duration: undefined,
    metadataExpiresAt: undefined,
  };
}
export const sourceNames: Record<Source, string> = {
  local: "本機",
  youtube: "YouTube",
  stream: "網路串流",
  spotify: "Spotify",
};
export const trackKey = (source: Source, id: string) => source + ":" + id;
export interface Playlist {
  id: string;
  name: string;
  tracks: string[];
}
export interface Playback {
  track?: Track;
  status:
    | "idle"
    | "loading"
    | "ready"
    | "playing"
    | "paused"
    | "ended"
    | "external"
    | "error";
  time: number;
  duration: number;
  message?: string;
  audioInfo?: AudioFormatInfo;
}
export interface Adapter {
  load(
    track: Track,
    publish: (event: Partial<Playback>) => void,
    signal: AbortSignal,
  ): Promise<void>;
  play?(): void | Promise<void>;
  pause?(): void;
  seek?(seconds: number): void;
  volume?(value: number): void;
  analyser?: AnalyserNode;
  destroy(): void;
}
export type Repeat = "off" | "one" | "all";
