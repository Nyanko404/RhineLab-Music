import { expect, test, type Page } from "@playwright/test";

function tone(name: string, seconds = 8) {
  const rate = 8000;
  const buffer = Buffer.alloc(44 + rate * seconds * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  for (let i = 0; i < rate * seconds; i++)
    buffer.writeInt16LE(
      Math.round(8000 * Math.sin((i * Math.PI * 2 * 440) / rate)),
      44 + i * 2,
    );
  return { name: name + ".wav", mimeType: "audio/wav", buffer };
}
async function open(page: Page) {
  // Disable GPU work for transport tests. The 3D entry is verified separately.
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: unknown[]
    ) {
      return kind.startsWith("webgl")
        ? null
        : Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });
  await page.goto("/?noboot=1");
  await expect(
    page.getByRole("heading", { name: "LOCAL FILE", exact: true }),
  ).toBeVisible();
}
async function openView(page: Page, name: string) {
  if (name === "設定") {
    await page.locator("#terminal-nav [data-view=settings]").click();
    return;
  }
  if (name === "首頁") {
    await page.getByRole("link", { name: "RhineLab Music 首頁" }).click();
    return;
  }
  if (name === "音樂資料庫") {
    if ((await page.locator("#stage").getAttribute("data-view")) === "library")
      return;
    await page.getByRole("button", { name: /LIBRARY OVERVIEW/ }).click();
    return;
  }
  if (!(await page.locator("#music-nav").isVisible())) {
    await page.getByRole("button", { name: "開啟導覽" }).click();
  }
  await page
    .getByRole("navigation", { name: "音樂導覽" })
    .getByRole("button", { name, exact: true })
    .click();
}
const overlay = (page: Page) => page.locator("#music-dialog");

test("imports audio, plays, pauses, seeks, changes tracks, favorites and restores the session", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await open(page);
  await page
    .locator("#music-files")
    .setInputFiles([tone("Alpha"), tone("Beta")]);
  await expect(
    page.locator("#music-page").getByRole("button", { name: "播放 Alpha" }),
  ).toBeVisible();
  await expect(
    page.locator("#music-page").getByRole("button", { name: "播放 Beta" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "播放 Alpha" }).first().click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "paused",
  );
  await page.locator("#seek").fill("3");
  await expect(page.locator("#seek")).toHaveValue("3");
  await page.getByRole("button", { name: "收藏目前歌曲" }).click();
  await openView(page, "收藏");
  await expect(
    page.locator("#music-page").getByRole("button", { name: "播放 Alpha" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一首", exact: true }).click();
  await expect(page.locator("#mini-title")).toHaveText("Beta");
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.locator("#seek").fill("2");
  await page.waitForFunction(async () => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("rhine-music");
      request.onsuccess = () => resolve(request.result);
    });
    const value = await new Promise<number | undefined>((resolve) => {
      const request = database
        .transaction("settings")
        .objectStore("settings")
        .get("library");
      request.onsuccess = () => resolve(request.result?.session?.position);
    });
    database.close();
    return value === 2;
  });
  await page.reload();
  await expect(page.locator("#mini-title")).toHaveText("Beta");
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "ready",
  );
  await expect(page.locator("#seek")).toHaveValue("2");
  expect(errors).toEqual([]);
});

test("creates, updates, and plays a mixed playlist then switches away from the embed", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixture = {
      Player: class {
        frame: HTMLIFrameElement;
        events: {
          onReady(): void;
          onStateChange(event: { data: number }): void;
        };
        constructor(frame: HTMLIFrameElement, config: typeof this) {
          this.frame = frame;
          this.events = config.events;
          queueMicrotask(() => this.events.onReady());
        }
        playVideo() {
          this.events.onStateChange({ data: 1 });
        }
        pauseVideo() {
          this.events.onStateChange({ data: 2 });
        }
        getDuration() {
          return 120;
        }
        getCurrentTime() {
          return 0;
        }
        seekTo() {}
        mute() {}
        unMute() {}
        setVolume() {}
        destroy() {
          this.frame.remove();
        }
      },
    };
    Object.assign(window, { YT: fixture });
  });
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "YouTube iframe fixture",
    }),
  );
  await page.route("https://www.googleapis.com/youtube/v3/videos?*", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await open(page);
  await page.locator("#music-files").setInputFiles(tone("Local track"));
  await expect(
    page.getByRole("button", { name: "播放 Local track" }).first(),
  ).toBeVisible();
  await page
    .locator(".session-footer")
    .getByRole("button", { name: /匯入平台連結/ })
    .click();
  await page
    .getByLabel("YouTube 連結（影片或公開播放清單）")
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("顯示名稱").fill("Video track");
  await overlay(page)
    .getByRole("button", { name: "匯入連結", exact: true })
    .click();
  await openView(page, "播放清單");
  await page.getByRole("button", { name: "建立清單" }).first().click();
  await page.getByLabel("清單名稱").fill("My mix");
  await page.getByRole("button", { name: "儲存清單" }).click();
  await openView(page, "音樂資料庫");
  for (const name of ["Local track", "Video track"]) {
    await page
      .getByRole("button", { name: name + " 的選項" })
      .first()
      .click();
    await page.getByRole("button", { name: "加入清單" }).click();
    await expect(overlay(page)).toBeHidden();
  }
  await openView(page, "播放清單");
  await page.getByRole("button", { name: /My mix/ }).click();
  await page.getByRole("button", { name: "編輯清單" }).click();
  await page.getByRole("button", { name: "上移 Video track" }).click();
  await page.getByRole("button", { name: "儲存清單" }).click();
  await page.getByRole("button", { name: "開始播放" }).click();
  await expect(page.locator("#video-mount iframe")).toHaveAttribute(
    "src",
    /www\.youtube\.com\/embed\/dQw4w9WgXcQ/,
  );
  await page.getByRole("button", { name: "下一首", exact: true }).click();
  await expect(page.locator("#video-mount iframe")).toHaveCount(0);
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );
  await openView(page, "播放清單");
  await page.getByRole("button", { name: /My mix/ }).click();
  await page.getByRole("button", { name: "編輯清單" }).click();
  await page.getByRole("button", { name: "刪除清單", exact: true }).click();
  await page.getByRole("button", { name: "確認刪除" }).click();
  await expect(page.getByText("還沒有播放清單")).toBeVisible();
});

test("searches local and official API fixtures with source filters and imports a YouTube playlist", async ({
  page,
}) => {
  const id = "dQw4w9WgXcQ";
  await page.route(
    "https://www.googleapis.com/youtube/v3/**",
    async (route) => {
      const url = new URL(route.request().url());
      const items = url.pathname.endsWith("playlistItems")
        ? [
            {
              id: "playlist-item",
              snippet: {
                title: "Public playlist track",
                resourceId: { videoId: id },
              },
            },
          ]
        : [
            {
              id: { videoId: id },
              snippet: {
                title: "Alpha &amp; official",
                channelTitle: "Artist",
              },
            },
          ];
      await route.fulfill({ json: { items } });
    },
  );
  await open(page);
  await page.locator("#music-files").setInputFiles(tone("Alpha local"));
  await expect(
    page.getByRole("button", { name: "播放 Alpha local" }),
  ).toBeVisible();
  await page.locator("#terminal-nav [data-view=search]").click();
  await page
    .getByRole("searchbox", { name: "搜尋歌曲、專輯或藝人" })
    .fill("Alpha");
  await page
    .getByRole("searchbox", { name: "搜尋歌曲、專輯或藝人" })
    .press("Enter");
  const results = page.locator("#search-results");
  await expect(results.getByText("Alpha & official")).toBeVisible();
  await expect(results.getByText("Alpha local")).toBeVisible();
  await page
    .getByRole("combobox", { name: "來源", exact: true })
    .selectOption("local");
  await page
    .locator("#full-search")
    .getByRole("button", { name: "搜尋" })
    .click();
  await expect(results.getByText("Alpha & official")).toHaveCount(0);
  await expect(results.getByText("Alpha local")).toBeVisible();
  await openView(page, "首頁");
  await page
    .locator(".session-footer")
    .getByRole("button", { name: /匯入平台連結/ })
    .click();
  await page
    .getByLabel("YouTube 連結（影片或公開播放清單）")
    .fill("https://www.youtube.com/playlist?list=PL01234567890");
  await overlay(page)
    .getByRole("button", { name: "匯入連結", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "YouTube PL01234567890" }),
  ).toBeVisible();
  await expect(page.getByText("Public playlist track")).toBeVisible();
});

test("mobile navigation, settings, track controls and lyrics are usable at 390 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await openView(page, "設定");
  await page.getByRole("button", { name: "亮色", exact: true }).click();
  await page.getByLabel("三維畫質").selectOption("off");
  await page.getByLabel("字體大小").selectOption("125");
  await expect(page.locator("#stage")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.keyboard.press("Escape");
  await page.locator("#music-files").setInputFiles(tone("Mobile audio"));
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");
  await openView(page, "音樂資料庫");
  await page.getByRole("button", { name: "播放 Mobile audio" }).first().click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await page.getByRole("button", { name: "歌詞", exact: true }).click();
  await page.getByRole("button", { name: "匯入 LRC 歌詞" }).click();
  await page.locator("#music-lyrics").setInputFiles({
    name: "test.lrc",
    mimeType: "text/plain",
    buffer: Buffer.from("[00:00.00]First line\n[00:02.00]Second line"),
  });
  await page.locator("#seek").fill("3");
  await expect(page.locator('.lyrics [aria-current="true"]')).toHaveText(
    "Second line",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("controls the YouTube iframe adapter and enriches single YouTube links", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixture = {
      Player: class {
        frame: HTMLIFrameElement;
        events: {
          onReady(): void;
          onStateChange(event: { data: number }): void;
        };
        position = 0;
        constructor(frame: HTMLIFrameElement, config: typeof this) {
          this.frame = frame;
          this.events = config.events;
          queueMicrotask(() => this.events.onReady());
        }
        playVideo() {
          this.events.onStateChange({ data: 1 });
        }
        pauseVideo() {
          this.events.onStateChange({ data: 2 });
        }
        getDuration() {
          return 120;
        }
        getCurrentTime() {
          return this.position;
        }
        seekTo(next: number) {
          this.position = next;
        }
        mute() {}
        unMute() {}
        setVolume() {}
        destroy() {
          this.frame.remove();
        }
      },
    };
    Object.assign(window, { YT: fixture });
  });
  await page.route("https://www.youtube.com/embed/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "YouTube iframe fixture" }),
  );
  await page.route("https://www.youtube.com/oembed?*", (route) =>
    route.fulfill({
      json: {
        title: "YT track",
        author_name: "Test Channel",
        thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      },
    }),
  );
  await open(page);
  await page
    .locator(".session-footer")
    .getByRole("button", { name: /匯入平台連結/ })
    .click();
  await page
    .getByLabel("YouTube 連結（影片或公開播放清單）")
    .fill("https://music.youtube.com/watch?v=dQw4w9WgXcQ");
  await page.getByLabel("顯示名稱").fill("YT track");
  await overlay(page)
    .getByRole("button", { name: "匯入連結", exact: true })
    .click();
  await openView(page, "音樂資料庫");
  await expect(
    page.getByRole("button", { name: "播放 YT track" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "播放 YT track" }).first().click();
  await expect(page.locator("#video-mount iframe")).toHaveAttribute(
    "src",
    /www\.youtube\.com\/embed\/dQw4w9WgXcQ/,
  );
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );
  await page.getByRole("button", { name: "暫停", exact: true }).click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "paused",
  );
  await page.locator("#seek").fill("25");
  await expect(page.locator("#seek")).toHaveValue("25");
});

test("renders the original cassette geometry in WebGL and releases it in 2D mode", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1000, height: 700 });
  const shaderErrors: string[] = [];
  page.on("pageerror", (error) => shaderErrors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /three|shader|webgl/i.test(message.text())
    )
      shaderErrors.push(message.text());
  });
  await page.addInitScript(() => {
    // SwiftShader is software-only in CI. Allow the first real scene draw.
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      request((time) => {
        if (
          String(callback).includes("scene.update") &&
          document.querySelector("#wall[data-drawn=true]")
        )
          return;
        callback(time);
      });
  });
  await page.goto("/?noboot=1");
  await expect(page.locator("#wall")).toHaveAttribute("data-drawn", "true", {
    timeout: 42_000,
  });
  await expect(page.locator("#wall canvas")).toBeVisible();
  await expect(page.locator("#wall-status")).toHaveText("觀測室 · Observatory");
  await openView(page, "設定");
  await page.getByLabel("三維畫質").selectOption("off");
  await expect(page.locator("#wall canvas")).toHaveCount(0);
  await expect(page.locator("#wall")).toHaveAttribute("data-state", "off");
  expect(shaderErrors).toEqual([]);
});

test("opens centered settings, returns to the detail, and persists a track note", async ({
  page,
}) => {
  await open(page);
  await expect(
    page.getByRole("heading", { name: "觀測室 · Observatory" }),
  ).toBeVisible();
  await openView(page, "設定");
  await expect(page.locator("#music-workspace:modal")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /SYSTEM SETTINGS/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暗色", exact: true }).click();
  await expect(page.locator("#stage")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await expect(page.locator("#music-workspace")).toBeHidden();
  await page.getByRole("button", { name: "編輯筆記" }).click();
  await overlay(page).getByLabel("曲目筆記").fill("夜間收聽");
  await page.getByRole("button", { name: "儲存筆記" }).click();
  await page.getByRole("button", { name: /曲目筆記/ }).click();
  await expect(page.getByText("夜間收聽", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /曲目筆記/ }).click();
  await expect(page.getByText("夜間收聽", { exact: true })).toBeVisible();
  await expect(page.locator("#stage")).toHaveAttribute("data-theme", "dark");
});

test("provides cancel feedback, distinguishes viewing vs playing, preserves view/focus on close, and opens archive in a new tab", async ({
  page,
}) => {
  await open(page);
  await page.locator("#music-files").dispatchEvent("cancel");
  await expect(page.locator("#music-notice")).toHaveText("已取消選擇本機音樂");

  await page
    .locator("#music-files")
    .setInputFiles([tone("Alpha"), tone("Beta")]);
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");
  await page.getByRole("button", { name: "播放 Alpha" }).first().click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );

  // Import another song while Alpha is playing: playback continues, right panel shows Gamma + jump back.
  await page.locator("#music-files").setInputFiles([tone("Gamma")]);
  await expect(page.locator("#mini-title")).toHaveText("Alpha");
  await expect(page.locator("#now-title")).toHaveText("Gamma");
  await expect(page.locator("#record-status")).toContainText("正在查看 · 背景播放中：Alpha");
  await page.getByRole("button", { name: /回到播放中/ }).click();
  await expect(page.locator("#now-title")).toHaveText("Alpha");
  await expect(page.locator("#record-status")).toHaveText("正在播放此曲目");

  // Close workspace back to home; inspect/reset remain while prev/next deck buttons are removed.
  await page.getByRole("button", { name: "關閉" }).or(page.getByRole("button", { name: "CLOSE" })).click();
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "home");
  await expect(page.locator(".object-nav button")).toHaveCount(2);
  await expect(
    page.locator('[data-action="wall-prev"], [data-action="wall-next"]'),
  ).toHaveCount(0);
  await expect(page.locator("#now-title")).toHaveText("Alpha");

  // Nested Home -> Library -> Settings -> Back restores focus; menu Esc closes menu before workspace.
  const indexBtn = page.locator("#terminal-nav [data-view=search]");
  await indexBtn.focus();
  await indexBtn.click();
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "search");
  const settingsBtn = page.locator("#terminal-nav [data-view=settings]");
  await settingsBtn.focus();
  await settingsBtn.click();
  await expect(page.locator("#music-workspace:modal")).toBeVisible();
  await page.goBack();
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "search");
  await expect(settingsBtn).toBeFocused();

  await page.getByRole("button", { name: "開啟導覽" }).click();
  await expect(page.locator("#music-nav")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#music-nav")).toBeHidden();
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "search");
  await page.keyboard.press("Escape");
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "home");
  await expect(indexBtn).toBeFocused();

  // Archive terminal link opens in a new tab so playback is not interrupted.
  await page.getByRole("button", { name: "開啟導覽" }).click();
  await expect(page.locator("a.archive-link")).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page.locator("a.archive-link")).toHaveAttribute(
    "href",
    "?archive=1",
  );
});

test("mobile end-to-end flow: import, play, next track, settings, and touch target sizes at 390 px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await page
    .locator("#music-files")
    .setInputFiles([tone("Mobile One"), tone("Mobile Two")]);
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");
  await page.getByRole("button", { name: "播放 Mobile One" }).first().click();
  await expect(page.locator("#stage")).toHaveAttribute(
    "data-playback",
    "playing",
  );
  await page.getByRole("button", { name: "下一首", exact: true }).click();
  await expect(page.locator("#mini-title")).toHaveText("Mobile Two");

  await openView(page, "設定");
  await expect(page.locator("#music-workspace:modal")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");

  const playBox = await page.locator(".play-main").boundingBox();
  expect(playBox?.width).toBeGreaterThanOrEqual(36);
  expect(playBox?.height).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});

test("quality presets, custom quality, GPU info, and platform accounts UI", async ({
  page,
}) => {
  await open(page);
  await openView(page, "設定");
  await expect(page.locator("#music-workspace:modal")).toBeVisible();

  // Quality options include high, ultra, custom
  const qualitySelect = page.locator('[data-pref="quality"]');
  await qualitySelect.selectOption("high");
  await expect(qualitySelect).toHaveValue("high");
  await qualitySelect.selectOption("ultra");
  await expect(qualitySelect).toHaveValue("ultra");
  await qualitySelect.selectOption("custom");
  await expect(page.locator("#custom-quality-panel")).toBeVisible();

  // Toggle depthOfField off for sharp rendering
  const dofToggle = page.locator('[data-custom-quality="dofEnabled"]');
  await dofToggle.uncheck();
  await expect(page.locator("#custom-dof-value")).toHaveText("0%");

  // Detected GPU name and GPU mode selector
  await expect(page.locator("#gpu-renderer-name")).not.toBeEmpty();
  await expect(page.locator('[data-pref="gpuMode"]')).toHaveValue("auto");

  // Playlist import section in Settings (YouTube only, no OAuth/Spotify/Bilibili)
  await expect(page.locator("#youtube-playlist-form")).toBeVisible();
  await expect(page.locator("#spotify-playlist-form")).toHaveCount(0);
  await expect(page.getByText("Bilibili")).toHaveCount(0);
});

test("imports public YouTube playlists via desktop backend proxy with distinct per-track thumbnails", async ({
  page,
}) => {
  await page.route("**/__rhine/desktop", (route) =>
    route.fulfill({ json: { desktop: true, gpuMode: "auto" } }),
  );
  await page.route("**/__rhine/heartbeat", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.route("**/__rhine/fetch-public?*", async (route) => {
    const reqUrl = new URL(route.request().url());
    const target = reqUrl.searchParams.get("url") ?? "";
    if (target.includes("youtube.com/playlist")) {
      const ytInitialData = {
        metadata: { playlistMetadataRenderer: { title: "Desktop YT Mix" } },
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
                                      title: { content: "YT Imported Track" },
                                      metadata: {
                                        contentMetadataViewModel: {
                                          metadataRows: [
                                            {
                                              metadataParts: [
                                                { text: { content: "YT Artist" } },
                                              ],
                                            },
                                          ],
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                              {
                                lockupViewModel: {
                                  contentId: "dQw4w9WgXcQ",
                                  metadata: {
                                    lockupMetadataViewModel: {
                                      title: { content: "YT Second Track" },
                                      metadata: {
                                        contentMetadataViewModel: {
                                          metadataRows: [
                                            {
                                              metadataParts: [
                                                { text: { content: "YT Artist 2" } },
                                              ],
                                            },
                                          ],
                                        },
                                      },
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
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<html><script>var ytInitialData = ${JSON.stringify(ytInitialData)};</script></html>`,
      });
      return;
    }
    await route.fulfill({ status: 404, body: "Not found" });
  });

  await open(page);
  await openView(page, "平台管理");
  await expect(page.getByText("Bilibili")).toHaveCount(0);
  await expect(page.getByText("Spotify 官方帳號 (OAuth 2.0 PKCE)")).toBeVisible();

  await page
    .locator('#youtube-playlist-form input[name="ytPlaylistInput"]')
    .fill("https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj");
  await page.locator('#youtube-playlist-form button[type="submit"], #youtube-playlist-form button').click();
  await expect(page.locator("#music-notice")).toContainText("Desktop YT Mix");

  await openView(page, "播放清單");
  await expect(page.getByRole("button", { name: /Desktop YT Mix/ })).toBeVisible();
  await page.getByRole("button", { name: /Desktop YT Mix/ }).click();
  await expect(
    page.getByRole("button", { name: "播放 YT Imported Track" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "播放 YT Second Track" }),
  ).toBeVisible();
  await expect(
    page.locator('img[src="https://i.ytimg.com/vi/kPa7bsKwL-c/hqdefault.jpg"]'),
  ).toBeVisible();
  await expect(
    page.locator('img[src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]'),
  ).toBeVisible();
});

test("home prioritizes favorites and supports custom cover artwork upload and removal", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("#music-files")
    .setInputFiles([tone("Track Alpha"), tone("Track Beta")]);
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");

  // Favorite Track Beta and return to home
  await page.getByRole("button", { name: "收藏 Track Beta" }).click();
  await page.locator('[data-action="workspace-close"]').click();
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "home");
  // Switch home shelf to favorites so Track Beta is displayed
  await page.locator('[data-action="home-scope-favorites"]').click();
  await expect(page.locator("#now-title")).toHaveText("Track Beta");

  // Upload a 1x1 PNG as custom cover artwork
  const png1x1 = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW0cAAAAASUVORK5CYII=",
    "base64",
  );
  await page.getByRole("button", { name: "上傳自訂封面" }).click();
  await page.locator("#music-artwork").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: png1x1,
  });
  await expect(page.locator("#now-art img")).toBeVisible();

  // Reload and confirm custom artwork persists in IndexedDB
  await page.reload();
  await expect(page.locator("#now-art img")).toBeVisible();

  // Remove custom artwork and confirm restoration
  await page.getByRole("button", { name: "恢復預設封面" }).click();
  await expect(page.locator("#now-art img")).toHaveCount(0);
  await expect(page.locator("#now-art .disc-cover")).toBeVisible();
});

test("supports batch delete in library and deleting a playlist", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("#music-files")
    .setInputFiles([tone("Batch One"), tone("Batch Two"), tone("Batch Three")]);
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");

  // Create a playlist and delete it directly from the playlist page
  await openView(page, "播放清單");
  await page.getByRole("button", { name: "建立清單" }).first().click();
  await page.locator('#playlist-form input[name="name"]').fill("Temp Playlist");
  await page.getByRole("button", { name: "儲存清單" }).click();
  await expect(page.getByRole("heading", { name: "Temp Playlist" })).toBeVisible();
  await page.getByRole("button", { name: "刪除此播放清單" }).click();
  await page.getByRole("button", { name: "確認刪除" }).click();
  await expect(page.getByRole("button", { name: /Temp Playlist/ })).toHaveCount(0);

  // Batch select and delete two tracks from library
  await openView(page, "音樂資料庫");
  await page.getByRole("button", { name: "批量選擇" }).click();
  await page.getByRole("checkbox", { name: "選取 Batch One" }).check();
  await page.getByRole("checkbox", { name: "選取 Batch Two" }).check();
  await page.getByRole("button", { name: "刪除已選 (2)" }).click();
  await expect(page.getByRole("button", { name: "播放 Batch One" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "播放 Batch Two" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "播放 Batch Three" })).toBeVisible();
});

test("persists audio quality, balanced render preset, LED lighting mode, and Spotify PKCE UI", async ({
  page,
}) => {
  await open(page);
  await openView(page, "設定");
  await expect(page.locator("#music-workspace:modal")).toBeVisible();
  await page.getByLabel("音質選項").selectOption("lossless");
  await page.getByLabel("唱片燈光模式").selectOption("rgb");
  await page.getByLabel("三維畫質").selectOption("balanced");
  await page.getByLabel("目標解析度").selectOption("4k");
  await page.getByLabel("抗鋸齒模式").selectOption("taa");
  await expect(page.locator('[data-pref="reflectionLevel"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Spotify 登入" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#music-workspace")).not.toHaveAttribute("open", "");
  await page.reload();
  await openView(page, "設定");
  await expect(page.getByLabel("音質選項")).toHaveValue("lossless");
  await expect(page.getByLabel("唱片燈光模式")).toHaveValue("rgb");
  await expect(page.getByLabel("三維畫質")).toHaveValue("balanced");
  await expect(page.getByLabel("目標解析度")).toHaveValue("4k");
  await expect(page.getByLabel("抗鋸齒模式")).toHaveValue("taa");
  await page.getByLabel("抗鋸齒模式").selectOption("fxaa");
  await expect(page.getByLabel("抗鋸齒模式")).toHaveValue("fxaa");
  await page.getByLabel("抗鋸齒模式").selectOption("smaa");
  await expect(page.getByLabel("抗鋸齒模式")).toHaveValue("smaa");
  await page.keyboard.press("Escape");
  await expect(page.locator("#track-audio-info")).toContainText("無損 FLAC/ALAC");
  await expect(page.locator(".object-nav button")).toHaveCount(2);
  await expect(page.locator('[data-action="wall-inspect"]')).toBeVisible();
  await expect(page.locator('[data-action="wall-reset"]')).toBeVisible();
  await expect(
    page.locator(
      '[data-action="wall-prev"], [data-action="wall-next"], [data-action="viewer"]',
    ),
  ).toHaveCount(0);
});

test("displays boot intro animation, fixes rolling digit box-sizing, and stacks hero/now title", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      kind: string,
      ...args: unknown[]
    ) {
      return kind.startsWith("webgl")
        ? null
        : Reflect.apply(getContext, this, [kind, ...args]);
    } as typeof getContext;
  });
  await page.goto("/");
  await expect(page.locator("#music-boot")).toBeVisible();
  await expect(page.locator("#music-boot")).toHaveCount(0, { timeout: 5000 });

  await expect(page.locator(".object-nav button")).toHaveCount(2);
  await expect(
    page.locator('[data-action="wall-prev"], [data-action="wall-next"]'),
  ).toHaveCount(0);
  await expect(page.locator("#object-number")).toContainText(/NO\.\s*\d{3}/);
  await expect(page.locator("#right-content #spectrum")).toBeVisible();

  await page.locator("#music-files").setInputFiles([
    tone("Stack Check A"),
    tone("Stack Check B"),
  ]);
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "library");
  await page.locator('[data-action="workspace-close"]').click();
  await expect(page.locator("#stage")).toHaveAttribute("data-view", "home");
  await page.getByRole("button", { name: "下一首" }).click();
  await expect(page.locator("#now-title")).toHaveText("Stack Check B");
  await expect(page.locator("#object-number")).toContainText(/NO\.\s*002/);
  await expect(page.locator("#object-code .rn-slot").first()).toBeVisible();
  await expect(page.locator("#elapsed")).not.toHaveText("0:00", { timeout: 5000 });
  await page.locator('[data-action="wall-reset"]').click();
  await expect(page.locator("#elapsed")).toHaveText("0:00");
  await expect(page.locator("#stage")).toHaveAttribute("data-playback", "playing");

  const slotBoxSizing = await page.evaluate(() => {
    const slot = document.querySelector("#object-code .rn-slot");
    return slot ? getComputedStyle(slot).boxSizing : null;
  });
  expect(slotBoxSizing).toBe("content-box");

  const stackedLayout = await page.evaluate(() => {
    const hero = document.querySelector("#hero-title")?.getBoundingClientRect();
    const now = document.querySelector("#now-title")?.getBoundingClientRect();
    if (!hero || !now) return null;
    return { heroBottom: hero.bottom, nowTop: now.top };
  });
  expect(stackedLayout).not.toBeNull();
  expect(stackedLayout!.nowTop).toBeGreaterThanOrEqual(
    stackedLayout!.heroBottom - 2,
  );

  const nonOverlap = await page.evaluate(() => {
    const actions = document
      .querySelector(".record-actions")
      ?.getBoundingClientRect();
    const objNav = document.querySelector(".object-nav")?.getBoundingClientRect();
    const transport = document
      .querySelector(".transport")
      ?.getBoundingClientRect();
    if (!actions || !objNav || !transport) return null;
    return {
      actionsBottom: actions.bottom,
      objNavBottom: objNav.bottom,
      transportTop: transport.top,
    };
  });
  expect(nonOverlap).not.toBeNull();
  expect(nonOverlap!.actionsBottom).toBeLessThanOrEqual(
    nonOverlap!.transportTop - 12,
  );
  expect(nonOverlap!.objNavBottom).toBeLessThanOrEqual(
    nonOverlap!.transportTop - 12,
  );

  await openView(page, "設定");
  await page.locator('[data-action="replay-boot"]').click();
  await expect(page.locator("#music-workspace")).not.toHaveAttribute("open", "");
  await expect(page.locator("#music-boot")).toBeVisible();
  await page.locator('#music-boot [data-action="boot-skip"]').click();
  await expect(page.locator("#music-boot")).toHaveCount(0);
});
