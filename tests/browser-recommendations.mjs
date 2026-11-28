import { chromium } from "playwright";
import assert from "node:assert/strict";
const base = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
const track = (id, i = 0) => ({
  provider: "youtube",
  videoId: id,
  title: `Catalogue ${id}`,
  artist: `Artist ${i}`,
  artists: [{ artistId: null, name: `Artist ${i}` }],
  duration: 12,
  thumbnail: "",
  type: "SONG",
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    class FakePlayer {
      constructor(el, options) {
        this.options = options;
        this.position = 0;
        this.started = Date.now();
        this.state = 2;
        window.__testPlayer = this;
        queueMicrotask(() => options.events.onReady({ target: this }));
      }
      loadVideoById(id) {
        this.id = id;
        this.position = 0;
        this.started = Date.now();
      }
      playVideo() {
        if (this.state !== 1) {
          this.started = Date.now();
          this.state = 1;
        }
        this.options.events.onStateChange({ data: 1, target: this });
      }
      pauseVideo() {
        this.position = this.getCurrentTime();
        this.state = 2;
        this.options.events.onStateChange({ data: 2, target: this });
      }
      getCurrentTime() {
        return (
          this.position +
          (this.state === 1 ? (Date.now() - this.started) / 1000 : 0)
        );
      }
      getDuration() {
        return 12;
      }
      getPlayerState() {
        return this.state;
      }
      seekTo(t) {
        this.position = t;
        this.started = Date.now();
      }
      setVolume() {}
      setPlaybackRate() {}
      unMute() {}
      mute() {}
      destroy() {}
    }
    window.YT = { Player: FakePlayer };
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let calls = 0;
  let releaseA, requestedA;
  const requestA = new Promise((resolve) => {
    requestedA = resolve;
  });
  const delayedA = new Promise((resolve) => {
    releaseA = resolve;
  });
  await page.route("**/fixture.supabase.co/**", (route) =>
    route.fulfill({ json: [] })
  );
  await page.route("**/api/music/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/up-next")) {
      calls++;
      const seed = url.searchParams.get("videoId");
      if (seed === "cold0") {
        requestedA();
        await delayedA;
      }
      const tracks = Array.from({ length: 30 }, (_, i) =>
        track(seed ? `${seed}-related${i}` : `cold${i}`, i)
      );
      return route.fulfill({
        json: {
          tracks,
          candidates: tracks.map((track, order) => ({
            track,
            source: seed ? "related" : "catalog",
            order,
          })),
        },
      });
    }
    return route.fulfill({
      json: {
        shelves: [],
        trendingTracks: [],
        quickPickCandidates: [],
        results: [],
        tracks: [],
        lines: [],
      },
    });
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const picks = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Jelajahi musik", exact: true }),
  });
  await picks
    .getByText("Catalogue cold0", { exact: true })
    .waitFor({ timeout: 15000 })
    .catch(async (e) => {
      console.log(
        "DEBUG",
        errors,
        calls,
        (await page.locator("body").innerText()).slice(-6000)
      );
      throw e;
    });
  assert.equal(
    await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    true
  );
  await picks.getByText("Catalogue cold0", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Open Now Playing for Catalogue cold0",
      exact: true,
    })
    .waitFor();
  await requestA;
  await picks.getByText("Catalogue cold1", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Open Now Playing for Catalogue cold1",
      exact: true,
    })
    .waitFor();
  releaseA();
  // Wait on real advancing playback (not a fake duration jump). A 12-second
  // fixture earns substantial/completion credit only after verified samples.
  await page
    .waitForFunction(
      () => {
        const s = JSON.parse(
          localStorage.getItem("easvarafy:taste:v1:guest") || "{}"
        );
        return s.events?.some(
          (e) => e.track.videoId === "cold1" && e.kind === "complete"
        );
      },
      null,
      { timeout: 25000 }
    )
    .catch(async (e) => {
      console.log(
        "PLAY DEBUG",
        errors,
        await page.evaluate(() => ({
          store: localStorage.getItem("easvarafy:taste:v1:guest"),
          p: window.__testPlayer && {
            id: window.__testPlayer.id,
            state: window.__testPlayer.state,
            time: window.__testPlayer.getCurrentTime(),
          },
        }))
      );
      throw e;
    });
  const signals = await page.evaluate(
    () => JSON.parse(localStorage.getItem("easvarafy:taste:v1:guest")).events
  );
  assert.ok(
    signals.some((e) => e.kind === "listen" && e.track.videoId === "cold1")
  );
  assert.ok(
    !signals.some(
      (e) =>
        ["listen", "complete"].includes(e.kind) && e.track.videoId === "cold0"
    )
  );
  await page
    .getByRole("heading", { name: "Pilihan untukmu", exact: true })
    .waitFor();
  assert.ok(calls < 12, "bounded provider work, not per second");
  // Feedback excludes a track immediately from the personalized shelf.
  const personalized = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Pilihan untukmu", exact: true }),
  });
  const action = personalized
    .getByRole("button", { name: /More actions for/ })
    .first();
  const label = await action.getAttribute("aria-label");
  await action.click();
  await personalized
    .getByRole("button", { name: "Tidak tertarik", exact: true })
    .click();
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("easvarafy:taste:v1:guest")).events.some(
      (e) => e.kind === "not_interested"
    )
  );
  await personalized
    .getByRole("button", { name: label, exact: true })
    .waitFor({ state: "hidden" });
  await page
    .getByRole("button", {
      name: "Open Now Playing for Catalogue cold1",
      exact: true,
    })
    .click();
  await page.getByRole("tab", { name: "Queue", exact: true }).click();
  await page
    .getByRole("button", { name: /Remove Catalogue cold1-related/ })
    .first()
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: /Remove Catalogue cold0-related/ })
      .count(),
    0,
    "late seed A radio never pollutes seed B queue"
  );
  await page
    .getByRole("button", { name: "Close Now Playing", exact: true })
    .click();
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: ".cache/recommendations-guest-390.png",
    fullPage: true,
  });
  await context.close();
  console.log(
    "PASS recommendation UI: cold guest catalogue, rapid seed switch/delayed response, verified actual playback + completion, guest learning, negative feedback, bounded requests, mobile layout, no runtime errors. Controlled provider/player fixtures, not live YouTube playback."
  );
} finally {
  await browser.close();
}
