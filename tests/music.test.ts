import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrackLink, youtubePlaylistId } from "../src/music/links.ts";
import { parseLyrics, lyricAt } from "../src/music/lyrics.ts";
import { PlayerController } from "../src/music/player.ts";
import { parseYouTubePlaylistHtml } from "../src/music/providers.ts";
import type { Adapter, Playback, Track } from "../src/music/types.ts";

test("imports supported YouTube links and rejects lookalike hosts", () => {
  assert.equal(
    parseTrackLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ")?.id,
    "dQw4w9WgXcQ",
  );
  assert.equal(
    youtubePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL01234567890"),
    "PL01234567890",
  );
  assert.equal(
    youtubePlaylistId("https://youtu.be/dQw4w9WgXcQ?list=RDdQw4w9WgXcQ"),
    "RDdQw4w9WgXcQ",
  );
  assert.equal(
    youtubePlaylistId("www.youtube.com/playlist?list=PL01234567890"),
    "PL01234567890",
  );
  assert.equal(
    parseTrackLink("https://youtube.com.bad.example/watch?v=dQw4w9WgXcQ"),
    null,
  );
  assert.equal(
    parseTrackLink("spotify:track:4uLU6hMCjMI75M1A2tKUQC"),
    null,
  );
  assert.equal(
    parseTrackLink("https://www.youtube.com/shorts/dQw4w9WgXcQ")?.id,
    "dQw4w9WgXcQ",
  );
});

test("synchronizes LRC line and word timestamps with offset", () => {
  const lyrics = parseLyrics(
    "[offset:100]\n[00:02.00]<00:02.00>Hello <00:02.50>world\n[00:04.00]Next",
  );
  assert.equal(lyricAt(lyrics, 2.05), -1);
  assert.equal(lyricAt(lyrics, 2.11), 0);
  assert.deepEqual(
    lyrics[0].words?.map((word) => word.text),
    ["Hello ", "world"],
  );
  assert.equal(lyrics[0].words?.[1].time, 2.6);
});

const track = (id: string, source: Track["source"] = "local"): Track => ({
  key: source + ":" + id,
  id,
  source,
  title: id,
  artist: "",
  album: "",
});
test("disposes outgoing adapter and ignores its late playback events", async () => {
  const events = new Map<string, (update: Partial<Playback>) => void>();
  const stopped: string[] = [];
  const controller = new PlayerController((item) => {
    const adapter: Adapter = {
      async load(_, publish) {
        events.set(item.id, publish);
        publish({ status: "ready" });
      },
      play() {
        events.get(item.id)?.({ status: "playing" });
      },
      destroy() {
        stopped.push(item.id);
      },
    };
    return adapter;
  });
  const first = track("one"),
    second = track("two", "youtube");
  await controller.select(first, [first, second]);
  await controller.next();
  events.get("one")?.({ status: "error", message: "stale" });
  assert.deepEqual(stopped, ["one"]);
  assert.equal(controller.state.track, second);
  assert.equal(controller.state.status, "playing");
});
test("repeat-all wraps and a paused restoration retains position", async () => {
  const played: string[] = [];
  let position = 0;
  const controller = new PlayerController((item) => ({
    async load(_, publish) {
      publish({ status: "ready", duration: 90 });
    },
    play() {
      played.push(item.id);
    },
    seek(value) {
      position = value;
    },
    destroy() {},
  }));
  const first = track("one"),
    second = track("two");
  await controller.select(second, [first, second], {
    autoplay: false,
    position: 23,
  });
  assert.equal(position, 23);
  assert.deepEqual(played, []);
  controller.repeat = "all";
  await controller.next();
  assert.deepEqual(played, ["one"]);
});

test("expires cached YouTube metadata while keeping the user's title and reference", async () => {
  const { expireMetadata } = await import("../src/music/types.ts");
  const original = {
    ...track("clip", "youtube"),
    title: "User title",
    customTitle: true,
    artist: "Cached artist",
    artwork: "https://example.org/poster.jpg",
    metadataExpiresAt: 620,
  };
  assert.equal(expireMetadata(original, 619), original);
  assert.deepEqual(expireMetadata(original, 620), {
    ...track("clip", "youtube"),
    title: "User title",
    customTitle: true,
    artwork: undefined,
    duration: undefined,
    metadataExpiresAt: undefined,
  });
});

test("normalizes custom render quality presets and depthOfField", async () => {
  const { normalizeQuality, qualityPresets } = await import(
    "../src/render-quality.ts"
  );
  assert.equal(qualityPresets.high.scale, 125);
  assert.equal(qualityPresets.ultra.scale, 150);
  const sharp = normalizeQuality({
    scale: 142,
    pixelRatio: 2,
    antialias: "smaa",
    depthOfField: 0,
  });
  assert.equal(sharp.scale, 140);
  assert.equal(sharp.pixelRatio, 2);
  assert.equal(sharp.antialias, "smaa");
  assert.equal(sharp.depthOfField, 0);
});

test("parses YouTube playlist ytInitialData with lockupViewModel and playlistVideoRenderer", () => {
  const ytInitialData = {
    metadata: { playlistMetadataRenderer: { title: "Rhine Lab Mix" } },
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      itemSectionRenderer: {
                        contents: [
                          {
                            lockupViewModel: {
                              contentId: "kPa7bsKwL-c",
                              metadata: {
                                lockupMetadataViewModel: {
                                  title: { content: "First Song" },
                                  metadata: {
                                    contentMetadataViewModel: {
                                      metadataRows: [
                                        {
                                          metadataParts: [
                                            { text: { content: "Artist A" } },
                                          ],
                                        },
                                      ],
                                    },
                                  },
                                },
                              },
                              contentImage: {
                                thumbnailViewModel: {
                                  image: {
                                    sources: [
                                      { url: "https://i.ytimg.com/vi/kPa7bsKwL-c/hqdefault.jpg" },
                                    ],
                                  },
                                },
                              },
                            },
                          },
                          {
                            playlistVideoRenderer: {
                              videoId: "dQw4w9WgXcQ",
                              title: { runs: [{ text: "Second Song" }] },
                              shortBylineText: { runs: [{ text: "Artist B" }] },
                              lengthSeconds: "213",
                            },
                          },
                          {
                            playlistVideoRenderer: {
                              videoId: "xxxxxxxxxxx",
                              title: { runs: [{ text: "Private video" }] },
                            },
                          },
                          {
                            lockupViewModel: {
                              contentId: "kPa7bsKwL-c",
                              metadata: {
                                lockupMetadataViewModel: {
                                  title: { content: "Duplicate Song" },
                                },
                              },
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script></html>`;
  const parsed = parseYouTubePlaylistHtml(html, "Fallback");
  assert.equal(parsed.name, "Rhine Lab Mix");
  assert.equal(parsed.tracks.length, 2);
  assert.equal(parsed.tracks[0].title, "First Song");
  assert.equal(parsed.tracks[0].artist, "Artist A");
  assert.equal(
    parsed.tracks[0].artwork,
    "https://i.ytimg.com/vi/kPa7bsKwL-c/hqdefault.jpg",
  );
  assert.equal(parsed.tracks[1].title, "Second Song");
  assert.equal(parsed.tracks[1].duration, 213);
  assert.equal(
    parsed.tracks[1].artwork,
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
});

test("parses playlistPanelVideoRenderer for watch+list mixes without mixing sidebar lockupViewModel", () => {
  const ytInitialData = {
    contents: {
      twoColumnWatchNextResults: {
        playlist: {
          playlist: {
            title: "Mix - Test Song",
            contents: [
              {
                playlistPanelVideoRenderer: {
                  videoId: "kPa7bsKwL-c",
                  title: { simpleText: "Mix Track 1" },
                  shortBylineText: { runs: [{ text: "Artist 1" }] },
                  lengthText: { simpleText: "4:12" },
                },
              },
              {
                playlistPanelVideoRenderer: {
                  videoId: "dQw4w9WgXcQ",
                  title: { simpleText: "Mix Track 2" },
                  longBylineText: { runs: [{ text: "Artist 2" }] },
                  lengthText: { simpleText: "3:33" },
                },
              },
            ],
          },
        },
        secondaryResults: {
          secondaryResults: {
            results: [
              {
                lockupViewModel: {
                  contentId: "sidebar1234",
                  metadata: {
                    lockupMetadataViewModel: {
                      title: { content: "Unrelated Sidebar Video" },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
  const html = `<html><script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script></html>`;
  const parsed = parseYouTubePlaylistHtml(html, "Fallback");
  assert.equal(parsed.name, "Mix - Test Song");
  assert.equal(parsed.tracks.length, 2);
  assert.equal(parsed.tracks[0].duration, 252);
  assert.equal(
    parsed.tracks[0].artwork,
    "https://i.ytimg.com/vi/kPa7bsKwL-c/hqdefault.jpg",
  );
  assert.equal(parsed.tracks[1].duration, 213);
  assert.equal(
    parsed.tracks[1].artwork,
    "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  );
});

test("parses music.youtube.com playlists and watch+list links", () => {
  assert.equal(
    youtubePlaylistId("https://music.youtube.com/playlist?list=OLAK5uy_k1234567890"),
    "OLAK5uy_k1234567890",
  );
  assert.equal(
    youtubePlaylistId("https://music.youtube.com/watch?v=K4DyBUG242c&list=RDCLAK5uy_abc123"),
    "RDCLAK5uy_abc123",
  );
  const parsed = parseTrackLink("https://music.youtube.com/watch?v=K4DyBUG242c&list=RDCLAK5uy_abc123");
  assert.equal(parsed?.id, "K4DyBUG242c");
  assert.equal(parsed?.url, "https://music.youtube.com/watch?v=K4DyBUG242c");
});


test("parses major streaming site links and direct audio URLs while rejecting DRM platforms", async () => {
  const { isDrmPlatformUrl, isSupportedStreamPlaylist } = await import(
    "../src/music/links.ts"
  );
  assert.equal(
    parseTrackLink("https://soundcloud.com/lofi/study-beats")?.source,
    "stream",
  );
  assert.equal(
    parseTrackLink("https://artist.bandcamp.com/track/night-drive")?.source,
    "stream",
  );
  assert.equal(
    parseTrackLink("https://www.bilibili.com/video/BV1xx411c7mD")?.source,
    "stream",
  );
  assert.equal(
    parseTrackLink("https://cdn.example.com/audio/lofi-mix.mp3")?.source,
    "stream",
  );
  assert.equal(
    parseTrackLink("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC"),
    null,
  );
  assert.equal(isDrmPlatformUrl("https://open.spotify.com/track/123"), true);
  assert.equal(isDrmPlatformUrl("https://music.apple.com/us/album/123"), true);
  assert.equal(
    isSupportedStreamPlaylist("https://soundcloud.com/artist/sets/lofi"),
    true,
  );
  assert.equal(
    isSupportedStreamPlaylist("https://artist.bandcamp.com/album/night"),
    true,
  );
});

test("manual next/previous wraps when repeat is off while automatic next stops at queue end", async () => {
  const played: string[] = [];
  const controller = new PlayerController((item) => ({
    async load(_, publish) {
      publish({ status: "ready", duration: 60 });
    },
    play() {
      played.push(item.id);
    },
    destroy() {},
  }));
  const first = track("one"),
    second = track("two", "youtube"),
    third = track("three", "stream");
  await controller.select(third, [first, second, third]);
  assert.equal(controller.repeat, "off");
  await controller.next(true);
  assert.equal(controller.state.track, third);
  await controller.next(false);
  assert.equal(controller.state.track, first);
  await controller.previous();
  assert.equal(controller.state.track, third);
  assert.deepEqual(played, ["three", "one", "three"]);
});

test("switching tracks mid-load aborts pending adapter and activates new track", async () => {
  const aborted: string[] = [];
  const destroyed: string[] = [];
  const played: string[] = [];
  let releaseFirst!: () => void;
  const controller = new PlayerController((item) => ({
    async load(_, publish, signal) {
      signal.addEventListener("abort", () => aborted.push(item.id), {
        once: true,
      });
      if (item.id === "slow-stream") {
        await new Promise<void>((resolve, reject) => {
          releaseFirst = resolve;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }
      publish({ status: "ready", duration: 120 });
    },
    play() {
      played.push(item.id);
    },
    destroy() {
      destroyed.push(item.id);
    },
  }));
  const slow = track("slow-stream", "stream");
  const next = track("fast-yt", "youtube");
  const pending = controller.select(slow, [slow, next]);
  await controller.next();
  releaseFirst?.();
  await pending;
  assert.deepEqual(aborted, ["slow-stream"]);
  assert.deepEqual(destroyed, ["slow-stream"]);
  assert.equal(controller.state.track, next);
  assert.deepEqual(played, ["fast-yt"]);
});

test("previous switches track instead of seeking when current track is in error state", async () => {
  const seeked: string[] = [];
  const played: string[] = [];
  const events = new Map<string, (update: Partial<Playback>) => void>();
  const controller = new PlayerController((item) => ({
    async load(_, publish) {
      events.set(item.id, publish);
      publish({ status: "ready", duration: 120 });
    },
    play() {
      played.push(item.id);
      events.get(item.id)?.({ status: "playing" });
    },
    seek() {
      seeked.push(item.id);
    },
    destroy() {},
  }));
  const first = track("one"),
    second = track("two", "youtube");
  await controller.select(second, [first, second]);
  events.get("two")?.({ status: "error", time: 45, message: "boom" });
  await controller.previous();
  assert.deepEqual(seeked, []);
  assert.equal(controller.state.track, first);
  assert.deepEqual(played, ["two", "one"]);
});

test("switches home 3D wall scope between favorites and all tracks with empty fallback", async () => {
  const { effectiveHomeScope, resolveSceneTracks } = await import(
    "../src/music/scope.ts"
  );
  const fallback = track("observatory");
  const a = track("a"),
    b = track("b"),
    c = track("c");
  const all = [a, b, c];
  const favs = [b];

  assert.equal(effectiveHomeScope("favorites", favs.length), "favorites");
  assert.equal(effectiveHomeScope("favorites", 0), "all");
  assert.equal(effectiveHomeScope("all", favs.length), "all");

  assert.deepEqual(resolveSceneTracks("favorites", favs, all, fallback), [b]);
  assert.deepEqual(resolveSceneTracks("all", favs, all, fallback), [a, b, c]);
  assert.deepEqual(resolveSceneTracks("favorites", [], all, fallback), [
    a,
    b,
    c,
  ]);
  assert.deepEqual(resolveSceneTracks("all", [], [], fallback), [fallback]);
  assert.deepEqual(resolveSceneTracks("favorites", favs, all, fallback, a), [
    a,
    b,
  ]);
});

test("supports balanced quality preset, spotify source, and PKCE challenge generation", async () => {
  const { matchingPreset, qualityPresets } = await import(
    "../src/render-quality.ts"
  );
  const { sourceNames } = await import("../src/music/types.ts");
  const { createPkceChallenge } = await import("../src/music/spotify.ts");
  assert.equal(matchingPreset(qualityPresets.balanced), "balanced");
  assert.equal(sourceNames.spotify, "Spotify");
  const pkce = await createPkceChallenge();
  assert.ok(pkce.verifier.length >= 43);
  assert.ok(pkce.challenge.length >= 43);
  assert.notEqual(pkce.verifier, pkce.challenge);
});
