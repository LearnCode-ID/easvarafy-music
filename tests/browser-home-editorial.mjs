import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
await mkdir(".cache", { recursive: true });
const errors = [];
function track(index) {
  return {
    provider: "youtube",
    videoId: `editorial-${index}`,
    title: `Fixture song ${index}`,
    artist: `Fixture artist ${index}`,
    artists: [{ artistId: null, name: `Fixture artist ${index}` }],
    duration: 180,
    thumbnail: `https://editorial-art.test/${index}.svg`,
    type: "SONG",
  };
}
try {
  for (const width of [320, 390, 1366])
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 860 },
        colorScheme: scheme,
        reducedMotion: width === 320 ? "reduce" : "no-preference",
      });
      await context.addInitScript(
        (theme) =>
          localStorage.setItem("sonora_settings_v1", JSON.stringify({ theme })),
        scheme
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.route("**/fixture.supabase.co/**", (route) =>
        route.fulfill({ json: [] })
      );
      await page.route("**/editorial-art.test/**", (route) => {
        const index = Number(
          new URL(route.request().url()).pathname.replace(/\D/g, "")
        );
        // Test-owned artwork, never added to the production catalogue.
        return route.fulfill({
          contentType: "image/svg+xml",
          body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="hsl(${
            (index * 37) % 360
          },55%,42%)"/><stop offset="1" stop-color="#131a2b"/></linearGradient></defs><path fill="url(#a)" d="M0 0h400v400H0z"/><circle fill="#fff" opacity=".18" cx="200" cy="190" r="110"/><circle fill="#10121c" opacity=".6" cx="200" cy="170" r="52"/><path fill="#10121c" opacity=".6" d="M90 340q0-125 110-125t110 125z"/><text fill="white" font-family="sans-serif" font-size="20" x="24" y="375">Test-owned artwork ${index}</text></svg>`,
        });
      });
      await page.route("**/api/music/**", async (route) => {
        if (new URL(route.request().url()).pathname.endsWith("/up-next")) {
          await gate;
          return route.fulfill({
            json: {
              candidates: Array.from({ length: 30 }, (_, i) => ({
                track: track(i),
                source: "catalog",
                order: i,
              })),
            },
          });
        }
        return route.fulfill({
          json: {
            shelves: [],
            quickPickCandidates: [],
            trendingTracks: [],
            tracks: [],
            results: [],
            lines: [],
          },
        });
      });
      await page.goto(base, { waitUntil: "domcontentloaded" });
      const loading = page.getByTestId("home-editorial-loading");
      await loading.waitFor();
      assert.equal(await loading.locator("button").count(), 0);
      release();
      const shelf = page.getByTestId("home-top-picks-collage");
      await shelf.waitFor();
      const cards = shelf.getByTestId("home-editorial-card");
      await cards.nth(3).waitFor();
      assert.equal(await cards.count(), 4);
      const box = await cards.first().boundingBox();
      assert.ok(box.height >= (width >= 640 ? 318 : 300));
      assert.ok(box.width >= (width >= 640 ? 248 : 228));
      const thumbs = cards.first().locator("img");
      assert.equal(await thumbs.count(), 3);
      await page.waitForFunction(() =>
        [
          ...document.querySelectorAll(
            '[data-testid="home-editorial-card"] img'
          ),
        ].every((img) => img.complete && img.naturalWidth > 0)
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.scrollWidth <= innerWidth),
        true,
        `no page overflow ${width} ${scheme}`
      );
      const compact = page.getByRole("heading", {
        name: "Jelajahi musik",
        exact: true,
      });
      await compact.waitFor();
      assert.ok(
        (await shelf.boundingBox()).y < (await compact.boundingBox()).y,
        "editorial covers lead the feed"
      );
      const text = await page.locator("main").innerText();
      assert.doesNotMatch(text, /YouTube Music|Artis Serupa|Top 100/);
      const covered = new Set(
        await cards
          .locator("img")
          .evaluateAll((images) => images.map((img) => img.alt))
      );
      const compactSection = page.locator("section").filter({ has: compact });
      for (const title of covered)
        assert.equal(
          await compactSection.getByText(title, { exact: true }).count(),
          0,
          "compact discoveries do not duplicate cover songs"
        );
      await page.screenshot({
        path: `.cache/home-editorial-${width}-${scheme}.png`,
        fullPage: true,
      });
      await cards.first().click();
      await page
        .getByRole("button", {
          name: "Open Now Playing for Fixture song 0",
          exact: true,
        })
        .waitFor();
      await context.close();
    }
  assert.deepEqual(errors, []);
  console.log(
    "PASS restored Home editorial: large Easvarafy collage covers, real ranked partition/no duplicates, genuine artwork URLs, loading geometry, play action, quiet provider copy, 320/390/1366 light+dark, reduced motion, no overflow/runtime errors. Test-owned provider/artwork fixtures, not production data."
  );
} finally {
  await browser.close();
}
