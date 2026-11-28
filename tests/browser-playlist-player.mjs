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
    let uploads = 0,
      rejectUpload = false;
    const imageBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=",
      "base64"
    );
    await page.route("**/fixture.supabase.co/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/storage/v1/object/")) {
        if (route.request().method() === "POST") {
          uploads++;
          if (rejectUpload)
            return route.fulfill({
              status: 400,
              json: {
                message: "Unggah fixture gagal",
                error: "Upload failed",
                statusCode: "400",
              },
            });
          return route.fulfill({ json: { Key: "playlist-covers/uploaded" } });
        }
        return route.fulfill({ contentType: "image/png", body: imageBytes });
      }
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
    // All playlist controls open modal popups, not panels below the toolbar.
    const popup = page.locator(".playlist-action-dialog");
    const closePopup = () =>
      popup
        .getByRole("button", { name: "Tutup pengaturan playlist", exact: true })
        .click();
    const openAction = async (name) => {
      await detail
        .getByRole("button", { name: "Opsi playlist", exact: true })
        .click();
      await popup.getByRole("button", { name, exact: true }).click();
    };
    for (const name of [
      "Tambahkan",
      "Edit",
      "Nama & detail",
      "Urutkan",
      "Cari",
      "Unduh playlist",
      "Bagikan daftar lagu",
      "Acak playlist",
    ]) {
      assert.equal(
        await detail.getByRole("button", { name, exact: true }).count(),
        0,
        `${name} only available inside three-dot popup`
      );
    }
    const assertPopup = async () => {
      await popup.waitFor();
      assert.equal(await popup.getAttribute("aria-modal"), "true");
      assert.equal(
        await popup.evaluate(
          (el) => el.parentElement.parentElement === document.body
        ),
        true,
        "popup escapes page stack"
      );
      assert.equal(
        await page.locator("body").evaluate((el) => el.style.overflow),
        "hidden"
      );
      assert.equal(
        await popup.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return (
            b.top >= 0 &&
            b.bottom <= innerHeight &&
            b.left >= 0 &&
            b.right <= innerWidth
          );
        }),
        true,
        "popup fits viewport"
      );
      assert.equal(
        await popup.evaluate((el) => {
          const b = el.getBoundingClientRect();
          return el.contains(
            document.elementFromPoint(b.x + b.width / 2, b.y + 20)
          );
        }),
        true,
        "popup is above the page"
      );
    };
    const more = detail.getByRole("button", {
      name: "More actions for Zebra",
      exact: true,
    });
    await more.scrollIntoViewIfNeeded();
    await detail.evaluate((el) => {
      el.style.transform = "translateZ(0)";
      el.style.isolation = "isolate";
      el.querySelector(".playlist-track-list").style.overflow = "hidden";
    });
    const listTop = await detail
      .getByTestId("user-playlist-tracks")
      .evaluate((el) => el.getBoundingClientRect().top);
    await more.click();
    const actions = page.getByRole("dialog", {
      name: "Actions for Zebra",
      exact: true,
    });
    await assertPopup();
    assert.equal(
      await detail
        .getByTestId("user-playlist-tracks")
        .evaluate((el) => el.getBoundingClientRect().top),
      listTop,
      "opening song options inserts no inline panel"
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await actions.evaluate((el) => el.contains(document.activeElement)),
      true,
      "popup traps focus"
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
        .querySelector(".playlist-action-dialog")
        ?.getBoundingClientRect();
      return b && b.bottom <= innerHeight;
    });
    await assertPopup();
    await page.screenshot({
      path: `.cache/playlist-song-popup-${width}-${theme}.png`,
    });
    await page
      .locator(".playlist-dialog-backdrop")
      .click({ position: { x: 2, y: 2 } });
    await actions.waitFor({ state: "hidden" });
    await page.setViewportSize({ width, height: 900 });
    await detail.evaluate((el) => {
      el.style.transform = "";
      el.style.isolation = "";
      el.querySelector(".playlist-track-list").style.overflow = "";
    });
    await detail
      .getByRole("button", { name: "Opsi playlist", exact: true })
      .click();
    await assertPopup();
    await page.screenshot({
      path: `.cache/playlist-options-popup-${width}-${theme}.png`,
    });
    await popup
      .getByRole("button", { name: "Tambahkan lagu", exact: true })
      .click();
    await popup
      .getByRole("heading", { name: "Tambahkan lagu", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden" });
    assert.equal(
      await detail
        .getByRole("button", { name: "Opsi playlist", exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
      "switching popup views retains original opener"
    );
    const ids = () =>
      detail
        .getByTestId("user-playlist-tracks")
        .locator(".playlist-track-row")
        .evaluateAll((rows) => rows.map((row) => row.dataset.trackId));
    assert.deepEqual(await ids(), ["playlist-b", "playlist-a", "playlist-c"]);
    await openAction("Urutkan lagu");
    await assertPopup();
    await popup.getByRole("button", { name: "Judul A–Z", exact: true }).click();
    assert.deepEqual(await ids(), ["playlist-a", "playlist-c", "playlist-b"]);
    assert.equal(saves, 0, "view sorting never writes to the server");
    await openAction("Urutkan lagu");
    await popup
      .getByRole("button", { name: "Urutan saya", exact: true })
      .click();
    await openAction("Cari di playlist");
    await popup
      .getByRole("textbox", { name: "Filter playlist tracks" })
      .fill("Alpha");
    await popup
      .getByRole("button", { name: "Tampilkan hasil", exact: true })
      .click();
    assert.deepEqual(await ids(), ["playlist-a", "playlist-c"]);
    await openAction("Cari di playlist");
    await popup
      .getByRole("button", { name: "Hapus pencarian", exact: true })
      .click();
    await closePopup();
    await detail
      .getByRole("button", { name: "Putar Alpha", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Open Now Playing for Alpha", exact: true })
      .waitFor();
    await openAction("Acak playlist");
    assert.equal(
      await popup
        .getByRole("button", { name: "Acak playlist", exact: true })
        .getAttribute("aria-pressed"),
      "true"
    );
    await closePopup();
    await openAction("Bagikan daftar lagu");
    assert.match(
      await page.evaluate(() => window.__shared.text),
      /1\. Zebra — Beta/
    );
    assert.equal(saves, 0, "sharing never changes privacy");
    await closePopup();
    await openAction("Edit nama & detail");
    await popup
      .getByRole("textbox", { name: "Nama playlist", exact: true })
      .fill("Playlist tersimpan");
    await popup
      .getByRole("button", { name: "Simpan detail", exact: true })
      .click();
    await popup.getByText("Menyimpan ke Supabase…", { exact: true }).waitFor();
    await detail
      .getByRole("heading", { name: "Playlist nyata uji", exact: true })
      .waitFor();
    await detail
      .getByRole("heading", { name: "Playlist tersimpan", exact: true })
      .waitFor();
    assert.equal(saves, 1);
    await popup
      .getByRole("button", { name: "Tutup pengaturan playlist", exact: true })
      .click();
    await openAction("Edit lagu & urutan");
    await popup
      .getByRole("button", { name: "Naikkan Alpha", exact: true })
      .click();
    await popup.getByText("Menyimpan ke Supabase…", { exact: true }).waitFor();
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
    await popup
      .getByRole("button", { name: "Remove Alpha from playlist", exact: true })
      .click();
    await popup
      .getByRole("alert")
      .filter({ hasText: "Konflik fixture" })
      .waitFor();
    assert.deepEqual(
      await ids(),
      ["playlist-a", "playlist-b", "playlist-c"],
      "failed removal keeps tracks"
    );
    rejectSave = false;
    await popup.getByRole("button", { name: "Selesai", exact: true }).click();
    await openAction("Tambahkan lagu");
    await popup
      .getByRole("button", {
        name: "Tambahkan Delta ke playlist ini",
        exact: true,
      })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".playlist-track-row").length === 4
    );
    await popup
      .getByRole("button", { name: "Tutup pengaturan playlist", exact: true })
      .click();
    await openAction("Unduh playlist");
    await popup
      .getByRole("button", { name: "Unduh 4 lagu", exact: true })
      .waitFor();
    await popup
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
    await openAction("Edit nama & detail");
    const input = popup.getByLabel("Unggah foto cover playlist", {
      exact: true,
    });
    await input.setInputFiles({
      name: "unsafe.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from("<svg/>"),
    });
    await popup.getByRole("alert").filter({ hasText: "JPG" }).waitFor();
    assert.equal(uploads, 0);
    await input.setInputFiles({
      name: "cover.png",
      mimeType: "image/png",
      buffer: imageBytes,
    });
    await popup
      .locator('img[alt="Preview cover playlist"][src^="blob:"]')
      .waitFor();
    const beforeCoverSaves = saves;
    const previousCover = playlist.cover_url;
    assert.equal(uploads, 0, "preview alone does not upload");
    if (width === 320) {
      rejectUpload = true;
      await popup
        .getByRole("button", { name: "Simpan detail", exact: true })
        .click();
      await popup
        .getByRole("alert")
        .filter({ hasText: "Unggah fixture gagal" })
        .waitFor();
      assert.equal(
        saves,
        beforeCoverSaves,
        "upload failure must not write playlist"
      );
      rejectUpload = false;
      rejectSave = true;
      await popup
        .getByRole("button", { name: "Simpan detail", exact: true })
        .click();
      await popup
        .getByRole("alert")
        .filter({ hasText: "Detail belum dikonfirmasi" })
        .waitFor();
      assert.equal(
        playlist.cover_url,
        previousCover,
        "RPC failure leaves persisted cover unchanged"
      );
      rejectSave = false;
    }
    const beforeFinalUpload = uploads;
    await popup
      .getByRole("button", { name: "Simpan detail", exact: true })
      .click();
    await popup
      .getByRole("button", { name: "Gunakan cover lagu pertama", exact: true })
      .waitFor();
    assert.match(
      playlist.cover_url,
      /^playlist-covers:11111111-1111-4111-8111-111111111111\/cover-.*\.webp$/
    );
    if (width === 320)
      assert.equal(
        uploads,
        beforeFinalUpload,
        "RPC retry reuses successful uploaded object"
      );
    await closePopup();
    await detail.locator('img[src^="blob:"]').first().waitFor();
    // Refetch the saved row, not just the editor's local preview.
    const persistedCover = playlist.cover_url;
    await page.reload({ waitUntil: "networkidle" });
    await nav.getByRole("button", { name: "Library", exact: true }).click();
    await page
      .locator("main")
      .getByText(playlist.name, { exact: true })
      .click();
    await detail.locator('img[src^="blob:"]').first().waitFor();
    assert.equal(playlist.cover_url, persistedCover);
    await page.screenshot({
      path: `.cache/playlist-upload-${width}-${theme}.png`,
    });
    if (width === 320) {
      const savedCalls = saves;
      await openAction("Edit nama & detail");
      await popup
        .getByRole("textbox", { name: "Nama playlist", exact: true })
        .fill("Tidak boleh tersimpan offline");
      await context.setOffline(true);
      await popup
        .getByRole("button", { name: "Simpan detail", exact: true })
        .click();
      await popup
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
      `PASS ${width}px ${theme}: modal playlist options/add/edit/sort/search + song popup, keyboard/resize, playlist layout/actions, confirmed persistence, failure recovery, cold player shell, immediate/toast island`
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
