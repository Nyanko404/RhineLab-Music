import { trackKey, type Playlist, type Track } from "./types.ts";

const STORAGE_KEY = "rhine-spotify-auth-v1";
const PKCE_KEY = "rhine-spotify-pkce-v1";

export const SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "streaming",
  "user-read-playback-state",
  "user-modify-playback-state",
].join(" ");

export interface SpotifySession {
  clientId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  userId?: string;
  displayName?: string;
  product?: string;
}

export function defaultSpotifyClientId(): string {
  const env =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string | undefined> })
          .env
      : undefined;
  return env?.VITE_SPOTIFY_CLIENT_ID?.trim() ?? "";
}

export function spotifyRedirectUri(): string {
  return location.origin + location.pathname;
}

export function loadSpotifySession(): SpotifySession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SpotifySession;
    if (!parsed?.accessToken || !parsed?.clientId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSpotifySession(session: SpotifySession | null) {
  try {
    if (!session) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {}
}

export function logoutSpotify() {
  saveSpotifySession(null);
  try {
    sessionStorage.removeItem(PKCE_KEY);
  } catch {}
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createPkceChallenge() {
  const random = new Uint8Array(64);
  crypto.getRandomValues(random);
  const verifier = base64Url(random);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = base64Url(new Uint8Array(digest));
  return { verifier, challenge };
}

export async function startSpotifyLogin(clientId: string) {
  const id = clientId.trim();
  if (!id) throw new Error("請先填入 Spotify Developer App Client ID");
  const { verifier, challenge } = await createPkceChallenge();
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64Url(stateBytes);
  sessionStorage.setItem(
    PKCE_KEY,
    JSON.stringify({ verifier, state, clientId: id }),
  );
  const params = new URLSearchParams({
    client_id: id,
    response_type: "code",
    redirect_uri: spotifyRedirectUri(),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES,
  });
  location.assign("https://accounts.spotify.com/authorize?" + params.toString());
}

export async function completeSpotifyCallback(
  search = location.search,
): Promise<SpotifySession | null> {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");
  if (!code && !error) return null;

  const cleanUrl = location.pathname + location.hash;
  history.replaceState(null, "", cleanUrl);

  if (error) throw new Error("Spotify 授權失敗：" + error);
  const rawPkce = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (!rawPkce) throw new Error("Spotify PKCE 驗證狀態遺失，請重新登入");
  const pkce = JSON.parse(rawPkce) as {
    verifier: string;
    state: string;
    clientId: string;
  };
  if (!state || state !== pkce.state) {
    throw new Error("Spotify 授權狀態驗證失敗（CSRF state mismatch）");
  }

  const body = new URLSearchParams({
    client_id: pkce.clientId,
    grant_type: "authorization_code",
    code: code!,
    redirect_uri: spotifyRedirectUri(),
    code_verifier: pkce.verifier,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error("無法交換 Spotify 授權憑證（HTTP " + res.status + "）");
  }
  const token = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const session: SpotifySession = {
    clientId: pkce.clientId,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in - 60) * 1000,
  };
  const me = await spotifyFetch<{
    id?: string;
    display_name?: string;
    product?: string;
  }>("https://api.spotify.com/v1/me", session);
  session.userId = me.id;
  session.displayName = me.display_name || me.id;
  session.product = me.product;
  saveSpotifySession(session);
  return session;
}

export async function ensureFreshSpotifyToken(
  session: SpotifySession,
): Promise<SpotifySession> {
  if (Date.now() < session.expiresAt) return session;
  if (!session.refreshToken) {
    logoutSpotify();
    throw new Error("Spotify 授權已過期，請重新登入");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    client_id: session.clientId,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    logoutSpotify();
    throw new Error("Spotify Token 更新失敗，請重新登入");
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  const next: SpotifySession = {
    ...session,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Math.max(60, data.expires_in - 60) * 1000,
  };
  saveSpotifySession(next);
  return next;
}

async function spotifyFetch<T>(
  url: string,
  session: SpotifySession,
  init?: RequestInit,
): Promise<T> {
  const active = await ensureFreshSpotifyToken(session);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: "Bearer " + active.accessToken,
    },
  });
  if (res.status === 401) {
    logoutSpotify();
    throw new Error("Spotify 授權無效，請重新登入");
  }
  if (!res.ok) throw new Error("Spotify API 回應 HTTP " + res.status);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

interface SpotifyApiTrack {
  id?: string | null;
  name?: string;
  duration_ms?: number;
  artists?: { name?: string }[];
  album?: {
    name?: string;
    release_date?: string;
    images?: { url: string }[];
  };
  external_urls?: { spotify?: string };
}

function toTrack(raw?: SpotifyApiTrack | null): Track | null {
  if (!raw?.id || !raw.name) return null;
  const yearMatch = raw.album?.release_date?.match(/^(\d{4})/);
  return {
    key: trackKey("spotify", raw.id),
    id: raw.id,
    source: "spotify",
    title: raw.name,
    artist: (raw.artists ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .join(", "),
    album: raw.album?.name ?? "",
    artwork: raw.album?.images?.[0]?.url,
    url:
      raw.external_urls?.spotify ??
      "https://open.spotify.com/track/" + encodeURIComponent(raw.id),
    duration: raw.duration_ms ? Math.round(raw.duration_ms / 1000) : undefined,
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    audioInfo: {
      codec: "Spotify Ogg/AAC",
      detail: "依 Spotify 帳號方案與官方 SDK 串流",
    },
  };
}

export async function syncSpotifyLibrary(session: SpotifySession): Promise<{
  tracks: Track[];
  playlists: Playlist[];
}> {
  const collected = new Map<string, Track>();
  const playlists: Playlist[] = [];

  // 1. Sync Liked Songs (up to 100 recent)
  try {
    const saved = await spotifyFetch<{
      items?: { track?: SpotifyApiTrack | null }[];
    }>("https://api.spotify.com/v1/me/tracks?limit=50", session);
    const likedKeys: string[] = [];
    for (const item of saved.items ?? []) {
      const t = toTrack(item.track);
      if (t) {
        collected.set(t.key, t);
        likedKeys.push(t.key);
      }
    }
    if (likedKeys.length) {
      playlists.push({
        id: "spotify:liked",
        name: "Spotify 已按讚歌曲",
        tracks: likedKeys,
      });
    }
  } catch {
    /* Liked songs scope optional */
  }

  // 2. Sync User Playlists (private + collaborative + public)
  const lists = await spotifyFetch<{
    items?: { id?: string; name?: string }[];
  }>("https://api.spotify.com/v1/me/playlists?limit=30", session);
  for (const pl of lists.items ?? []) {
    if (!pl.id || !pl.name) continue;
    const keys: string[] = [];
    try {
      const items = await spotifyFetch<{
        items?: { track?: SpotifyApiTrack | null }[];
      }>(
        `https://api.spotify.com/v1/playlists/${encodeURIComponent(pl.id)}/tracks?limit=100`,
        session,
      );
      for (const entry of items.items ?? []) {
        const t = toTrack(entry.track);
        if (t) {
          collected.set(t.key, t);
          keys.push(t.key);
        }
      }
    } catch {
      continue;
    }
    if (keys.length) {
      playlists.push({
        id: "spotify:" + pl.id,
        name: "Spotify · " + pl.name,
        tracks: keys,
      });
    }
  }

  return { tracks: [...collected.values()], playlists };
}

export async function controlSpotifyApi(
  session: SpotifySession,
  method: "PUT" | "POST",
  path: string,
  body?: unknown,
) {
  await spotifyFetch<void>("https://api.spotify.com/v1" + path, session, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}
