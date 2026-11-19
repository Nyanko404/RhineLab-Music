import type { Track } from "./types";

export type HomeScope = "favorites" | "all";

export function effectiveHomeScope(
  scope: HomeScope,
  favoritesCount: number,
): HomeScope {
  return scope === "favorites" && favoritesCount > 0 ? "favorites" : "all";
}

export function resolveSceneTracks(
  scope: HomeScope,
  favorites: Track[],
  allTracks: Track[],
  fallback: Track,
  playing?: Track,
): Track[] {
  const activeScope = effectiveHomeScope(scope, favorites.length);
  const base =
    activeScope === "favorites"
      ? favorites
      : allTracks.length
        ? allTracks
        : [fallback];
  return playing && !base.some((track) => track.key === playing.key)
    ? [playing, ...base]
    : base;
}
