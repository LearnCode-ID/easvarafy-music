import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

// Controlled auth/media fixtures only. No live Supabase writes or real audio.
const base = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const owner = "11111111-1111-4111-8111-111111111111";
const track = (id, title, artist, duration) => ({
  videoId: id,
  title,
  artist,
  duration,
  artists: [],
  provider: "youtube",
  type: "SONG",
  thumbnail: `https://playlist-art.test/${id}.svg`,
});
const songs = [
  track("playlist-b", "Zebra", "Beta", 180),
  track("playlist-a", "Alpha", "Zeta", 120),
  track("playlist-c", "Cloud", "Alpha", 240),
];
const errors = [];
await mkdir(".cache", { recursive: true });
try {
  for (const [width, theme] of [
    [320, "light"],
    [390, "dark"],
    [1280, "light"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: theme,
      reducedMotion: width === 320 ? "reduce" : "no-preference",
    });
    const user = {
      id: owner,
      email: "fixture@example.invalid",
      role: "authenticated",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-11-01T00:00:00Z",
    };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url")}.${Buffer.from(
      JSON.stringify({
        sub: owner,
        aud: "authenticated",
        role: "authenticated",
        exp,
      })
    ).toString("base64url")}.fixture`;
    await context.addInitScript(
      ({ user, token, exp, theme }) => {
        localStorage.setItem(
          "sb-fixture-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "fixture",
            expires_at: exp,
            expires_in: 3600,
            token_type: "bearer",
            user,
          })
        );
        localStorage.setItem(
          "sonora_settings_v1",
          JSON.stringify({ theme, pureBlack: false, dynamicColor: true })
        );
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async (data) => {
            window.__shared = data;
          },
        });
        class Player {
          constructor(el, options) {
            this.options = options;
            this.state = 2;
            this.position = 0;
            window.__fixturePlayer = this;
            queueMicrotask(() => options.events.onReady({ target: this }));
          }
          loadVideoById(id) {
            this.id = id;
            this.position = 0;
          }
          playVideo() {
            this.state = 1;
            this.options.events.onStateChange({ data: 1, target: this });
          }
          pauseVideo() {
            this.state = 2;
            this.options.events.onStateChange({ data: 2, target: this });
          }
          getCurrentTime() {
            return this.position;
          }
          getDuration() {
            return 180;
          }
          getPlayerState() {
            return this.state;
          }
          seekTo(t) {
            this.position = t;
          }
          setVolume() {}
          setPlaybackRate() {}
          unMute() {}
          mute() {}
          destroy() {}
        }
        Object.defineProperty(navigator, "hardwareConcurrency", {
          configurable: true,
          value: 8,
        });
        Object.defineProperty(navigator, "deviceMemory", {
          configurable: true,
          value: 8,
        });
        window.YT = { Player };
      },
      { user, token, exp, theme }
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("BROWSER", error.message);
    });
    let playlist = {
      id: "owned-list",
      user_id: owner,
      name: "Playlist nyata uji",
      description: "Lagu pilihan untuk perjalanan.",
      tags: ["santai"],
      is_public: false,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tracks: songs,
    };
    let saves = 0,
      rejectSave = false;
    await page.route("**/fixture.supabase.co/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
      if (url.includes("/rest/v1/profiles"))
        return route.fulfill({
          json: [
            {
              ...user,
              name: "Pendengar Uji",
              role: "user",
              avatar_url: null,
              is_public: true,
              is_banned: false,
            },
          ],
        });
      if (url.includes("save_user_playlist")) {
        saves++;
        const { p_playlist: data } = route.request().postDataJSON();
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (rejectSave)
          return route.fulfill({
            status: 409,
            json: { message: "Konflik fixture: perubahan belum disimpan." },
          });
        playlist = {
          ...playlist,
          name: data.name,
          description: data.description,
          tags: data.tags,
          cover_url: data.coverUrl,
          is_public: data.isPublic,
          tracks: data.tracks,
          version: playlist.version + 1,
        };
        return route.fulfill({ json: playlist });
      }
      if (url.includes("/user_playlists"))
        return route.fulfill({ json: [playlist] });
      if (url.includes("/user_liked_tracks"))
        return route.fulfill({
          json: [{ track: track("playlist-d", "Delta", "Artis baru", 90) }],
        });
      return route.fulfill({ json: [] });
    });
    await page.route("https://playlist-art.test/**", (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        headers: { "access-control-allow-origin": "*" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><path fill="#896264" d="M0 0h300v300H0z"/><circle cx="150" cy="150" r="75" fill="#d7af7e"/></svg>',
      })
    );
    await page.route("**/api/music/**", (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/up-next")
          ? {
              candidates: Array.from({ length: 25 }, (_, i) => ({
                track: track(
                  `rec-${i}`,
                  `Rekomendasi ${i}`,
                  "Artis rekomendasi",
                  180
                ),
                source: "catalog",
                order: i,
              })),
            }
          : {
              shelves: [],
              tracks: [],
              results: [],
              lines: [],
              quickPickCandidates: [],
              trendingTracks: [],
            },
      })
    );

    // Cold lazy player chunk must not blank the already-visible Home shell.
    let chunkRequested = false,
      releaseChunk;
    let markChunkRequested;
    const requestedChunk = new Promise((resolve) => {
      markChunkRequested = resolve;
    });
    const chunkGate = new Promise((resolve) => {
      releaseChunk = resolve;
    });
    await page.route("**/_next/static/chunks/**", async (route) => {
      const response = await route.fetch();
      if (
        route.request().url().endsWith(".js") &&
        (await response.text()).includes("function NowPlayingSheet(")
      ) {
        chunkRequested = true;
        markChunkRequested();
        await chunkGate;
      }
      return route.fulfill({ response });
    });
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.getByTestId("home-editorial-card").first().waitFor();
    await page
      .getByTestId("youtube-stage")
      .evaluate((el) => (el.dataset.persistent = "yes"));
    await page.getByTestId("home-editorial-card").first().click();
    await page
      .getByRole("button", {
        name: "Open Now Playing for Rekomendasi 0",
        exact: true,
      })
      .waitFor();
    let requestTimeout;
    try {
      await Promise.race([
        requestedChunk,
        new Promise((_, reject) => {
          requestTimeout = setTimeout(
            () => reject(new Error("No cold player chunk requested")),
            15000
          );
        }),
      ]);
    } finally {
      clearTimeout(requestTimeout);
    }
    assert.equal(chunkRequested, true);
    for (let frame = 0; frame < 15; frame++) {
      assert.equal(
        await page.locator(".glass-app").evaluate(async (el) => {
          await new Promise(requestAnimationFrame);
          return (
            getComputedStyle(el).display !== "none" &&
            el.getBoundingClientRect().height > 0
          );
        }),
        true,
        "shell remains painted during cold player import"
      );
    }
    releaseChunk();
    assert.equal(
      await page.getByTestId("youtube-stage").getAttribute("data-persistent"),
      "yes"
    );
    const expandedImmediately = await page.evaluate(async () => {
      document
        .querySelector(
          'button[aria-label="Expand Dynamic Island for Rekomendasi 0"]'
        )
        .click();
      await new Promise(requestAnimationFrame);
      return !!document.querySelector(
        '[aria-label="Dynamic Island expanded player"]'
      );
    });
    assert.equal(
      expandedImmediately,
      true,
      "island expanded state mounts by next animation frame, no exit wait"
    );
    await page
      .getByRole("button", { name: "Collapse Dynamic Island", exact: true })
      .click();
    const nav =
      width < 1024
        ? page.getByRole("navigation", { name: "Mobile navigation" })
        : page.locator(".glass-sidebar");
    await nav.getByRole("button", { name: "Library", exact: true }).click();
    await page.getByRole("heading", { name: "Library", exact: true }).waitFor();
    await page
      .locator("main")
      .getByText("Playlist nyata uji", { exact: true })
      .click();
    const detail = page.getByTestId("detail-view");
    await detail
      .getByRole("heading", { name: "Playlist nyata uji", exact: true })
      .waitFor();
    // Regression: overflow + transformed/isolated cards used to bury the menu.
    const more = detail.getByRole("button", {
      name: "More actions for Zebra",
      exact: true,
    });
    await more.scrollIntoViewIfNeeded();
    await detail.evaluate((el) => {
      el.style.transform = "translateZ(0)";
      el.style.isolation = "isolate";
      el.querySelector(".playlist-track-list").style.overflow = "hidden";
      const row = el.querySelector(".playlist-track-row");
      row.style.height = "72px";
      row.style.overflow = "hidden";
      const next = row.nextElementSibling;
      next.style.position = "relative";
      next.style.zIndex = "80";
    });
    await more.click();
    const actions = page.getByRole("dialog", {
      name: "Actions for Zebra",
      exact: true,
    });
    await actions.waitFor();
    assert.equal(
      await actions.evaluate((el) => el.parentElement === document.body),
      true,
      "menu escapes clipping ancestors"
    );
    const assertMenuOnTop = async () => {
      const result = await actions.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const buttons = [...el.querySelectorAll("button")];
        const reachable = buttons.filter((button) => {
          const b = button.getBoundingClientRect();
          return b.top >= box.top && b.bottom <= box.bottom;
        });
        return {
          inside:
            box.left >= 0 &&
            box.right <= innerWidth &&
            box.top >= 0 &&
            box.bottom <= innerHeight,
          onTop: reachable.every((button) => {
            const b = button.getBoundingClientRect();
            return button.contains(
              document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
            );
          }),
          background: getComputedStyle(el).backgroundColor,
        };
      });
      assert.equal(result.inside, true, "menu fits viewport");
      assert.equal(
        result.onTop,
        true,
        "following cards and fixed chrome cannot cover menu actions"
      );
      assert.ok(
        !result.background.startsWith("rgba") ||
          result.background.endsWith(", 1)"),
        "menu is opaque"
      );
    };
    await assertMenuOnTop();
    await page.waitForFunction(() =>
      document
        .querySelector(".track-context-menu")
        ?.contains(document.activeElement)
    );
    await page.keyboard.press("End");

    await page.keyboard.press("ArrowUp");
    assert.equal(
      await actions.evaluate((el) => el.contains(document.activeElement)),
      true
    );
    await page.keyboard.press("Escape");
    await actions.waitFor({ state: "hidden" });
    assert.equal(
      await more.evaluate((el) => document.activeElement === el),
      true,
      "Escape restores trigger focus"
    );
    await more.click();
    await actions
      .getByRole("button", { name: "Play Next", exact: true })
      .click();
    await actions.waitFor({ state: "hidden" });
    await more.click();
    await page.setViewportSize({ width, height: 460 });
    await page.waitForFunction(() => {
      const b = document
        .querySelector(".track-context-menu")
        ?.getBoundingClientRect();
      return b && b.top >= 0 && b.bottom <= innerHeight;
    });
    await assertMenuOnTop();
    await page.screenshot({ path: `.cache/track-menu-${width}-${theme}.png` });
    await page.locator("body").dispatchEvent("pointerdown");
    await actions.waitFor({ state: "hidden" });
    await page.setViewportSize({ width, height: 900 });
    await detail.evaluate((el) => {
      el.style.transform = "";
      el.style.isolation = "";
      el.querySelector(".playlist-track-list").style.overflow = "";
      const row = el.querySelector(".playlist-track-row");
      row.style.height = "";
      row.style.overflow = "";
      row.nextElementSibling.style.position = "";
      row.nextElementSibling.style.zIndex = "";
    });
    const ids = () =>
      page
        .locator(".playlist-track-row")
        .evaluateAll((rows) => rows.map((row) => row.dataset.trackId));
    assert.deepEqual(await ids(), ["playlist-b", "playlist-a", "playlist-c"]);
    await detail
      .getByRole("combobox", { name: "Urutkan lagu playlist" })
      .selectOption("title");
    assert.deepEqual(await ids(), ["playlist-a", "playlist-c", "playlist-b"]);
    assert.equal(saves, 0, "view sorting never writes to the server");
    await detail
      .getByRole("combobox", { name: "Urutkan lagu playlist" })
      .selectOption("custom");
    await detail
      .getByRole("button", { name: "Putar Alpha", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Now Playing for Alpha", exact: true })
      .waitFor();
    await detail
      .getByRole("button", { name: "Acak playlist", exact: true })
      .click();
    assert.equal(
      await detail
        .getByRole("button", { name: "Acak playlist", exact: true })
        .getAttribute("aria-pressed"),
      "true"
    );
    await detail
      .getByRole("button", { name: "Bagikan daftar lagu", exact: true })
      .click();
    assert.match(
      await page.evaluate(() => window.__shared.text),
      /1\. Zebra — Beta/
    );
    assert.equal(saves, 0, "sharing never changes privacy");
    await detail
      .getByRole("button", { name: "Nama & detail", exact: true })
      .click();
    await detail
      .getByRole("textbox", { name: "Nama playlist", exact: true })
      .fill("Playlist tersimpan");
    await detail
      .getByRole("button", { name: "Simpan detail", exact: true })
      .click();
    await page.getByText("Menyimpan ke Supabase…", { exact: true }).waitFor();
    await detail
      .getByRole("heading", { name: "Playlist nyata uji", exact: true })
      .waitFor();
    await detail
      .getByRole("heading", { name: "Playlist tersimpan", exact: true })
      .waitFor();
    assert.equal(saves, 1);
    await detail
      .getByRole("button", { name: "Tutup pengaturan playlist", exact: true })
      .click();
    await detail.getByRole("button", { name: "Edit", exact: true }).click();
    await detail
      .getByRole("button", { name: "Naikkan Alpha", exact: true })
      .click();
    await page.getByText("Menyimpan ke Supabase…", { exact: true }).waitFor();
    assert.deepEqual(
      await ids(),
      ["playlist-b", "playlist-a", "playlist-c"],
      "reorder waits for confirmed save"
    );
    await page.waitForFunction(
      () =>
        document.querySelector(".playlist-track-row")?.dataset.trackId ===
        "playlist-a"
    );
    rejectSave = true;
    await detail
      .getByRole("button", { name: "Remove Alpha from playlist", exact: true })
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Konflik fixture" })
      .waitFor();
    assert.deepEqual(
      await ids(),
      ["playlist-a", "playlist-b", "playlist-c"],
      "failed removal keeps tracks"
    );
    rejectSave = false;
    await detail.getByRole("button", { name: "Selesai", exact: true }).click();
    await detail
      .getByRole("button", { name: "Tambahkan", exact: true })
      .click();
    await detail
      .getByRole("button", {
        name: "Tambahkan Delta ke playlist ini",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".playlist-track-row").length === 4
    );
    await detail
      .getByRole("button", { name: "Tutup pengaturan playlist", exact: true })
      .click();
    await detail
      .getByRole("button", { name: "Unduh playlist", exact: true })
      .click();
    await detail
      .getByRole("button", { name: "Unduh 4 lagu", exact: true })
      .waitFor();
    await detail
      .getByRole("button", { name: "Tutup pengaturan playlist", exact: true })
      .click();
    const expandToast = page.getByRole("button", {
      name: "Expand Dynamic Island for Alpha",
      exact: true,
    });
    assert.equal(
      await expandToast.locator('[role="status"]').count(),
      1,
      "save toast still exposes an interactive player"
    );
    await expandToast.click();
    await page
      .getByRole("region", { name: "Dynamic Island expanded player" })
      .waitFor();
    await page
      .getByRole("button", { name: "Collapse Dynamic Island", exact: true })
      .click();
    assert.equal(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
      true,
      `no horizontal overflow at ${width}`
    );
    await page
      .getByRole("region", { name: "Dynamic Island expanded player" })
      .waitFor({ state: "hidden" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `.cache/user-playlist-${width}-${theme}.png`,
      fullPage: true,
    });
    if (width === 320) {
      const savedCalls = saves;
      await detail
        .getByRole("button", { name: "Nama & detail", exact: true })
        .click();
      await detail
        .getByRole("textbox", { name: "Nama playlist", exact: true })
        .fill("Tidak boleh tersimpan offline");
      await context.setOffline(true);
      await detail
        .getByRole("button", { name: "Simpan detail", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Offline. Perubahan belum disimpan." })
        .waitFor();
      assert.equal(saves, savedCalls, "offline playlist save makes no request");
      await detail
        .getByRole("heading", { name: "Playlist tersimpan", exact: true })
        .waitFor();
      await context.setOffline(false);
      playlist = {
        ...playlist,
        tracks: [],
        name: "Playlist kosong dengan judul yang sangat panjang untuk menguji pembungkusan teks di layar ponsel kecil",
      };
      await page.reload({ waitUntil: "networkidle" });
      await nav.getByRole("button", { name: "Library", exact: true }).click();
      await page
        .getByRole("heading", { name: "Library", exact: true })
        .waitFor();
      await page
        .locator("main")
        .getByText(playlist.name, { exact: true })
        .click();
      await page
        .getByText(
          "Playlist ini masih kosong. Tambahkan lagu untuk mulai mendengarkan.",
          { exact: true }
        )
        .waitFor();
      assert.equal(
        await detail
          .getByRole("button", { name: "Putar playlist", exact: true })
          .isDisabled(),
        true
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.scrollWidth <= innerWidth),
        true,
        "long empty playlist does not overflow"
      );
    }
    await context.close();
    console.log(
      `PASS ${width}px ${theme}: portaled unclipped menu + keyboard/resize, playlist layout/actions, confirmed persistence, failure recovery, cold player shell, immediate/toast island`
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
