import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const A = "11111111-1111-4111-8111-111111111111";
const base = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
await mkdir(".cache", { recursive: true });
try {
  for (const width of [320, 390, 1280]) {
    for (const reducedMotion of ["reduce", "no-preference"]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        reducedMotion,
        colorScheme: width === 390 ? "dark" : "light",
      });
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const user = {
        id: A,
        email: "fixture@example.invalid",
        role: "authenticated",
        aud: "authenticated",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-11-01T00:00:00Z",
      };
      const token = `${Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" })
      ).toString("base64url")}.${Buffer.from(
        JSON.stringify({
          sub: A,
          exp,
          aud: "authenticated",
          role: "authenticated",
        })
      ).toString("base64url")}.fixture`;
      await context.addInitScript(
        ({ token, user, exp }) =>
          localStorage.setItem(
            "sb-fixture-auth-token",
            JSON.stringify({
              access_token: token,
              refresh_token: "fixture-refresh",
              expires_at: exp,
              expires_in: 3600,
              token_type: "bearer",
              user,
            })
          ),
        { token, user, exp }
      );
      let release, releaseBlend, libraryRequested;
      const cloudRequested = new Promise((resolve) => {
        libraryRequested = resolve;
      });
      let gate = new Promise((resolve) => {
        release = resolve;
      });
      const blendGate = new Promise((resolve) => {
        releaseBlend = resolve;
      });
      const playlist = {
        id: "actual-playlist",
        user_id: A,
        name: "Playlist tersimpan",
        description: "",
        tracks: [],
        tags: [],
        is_public: false,
        version: 1,
        created_at: "2026-11-27T00:00:00Z",
        updated_at: "2026-11-27T00:00:00Z",
      };
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/fixture.supabase.co/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
        if (url.includes("/rest/v1/profiles"))
          return route.fulfill({
            json: [
              {
                ...user,
                name: "Listener",
                role: "user",
                is_banned: false,
                avatar_url: null,
              },
            ],
          });
        if (url.includes("/user_playlists")) {
          libraryRequested();
          await gate;
          return route.fulfill({ json: [playlist] });
        }
        if (url.includes("/user_liked_tracks")) {
          await gate;
          return route.fulfill({ json: [] });
        }
        if (url.includes("/blend_playlists")) {
          await blendGate;
          return route.fulfill({ json: [] });
        }
        if (
          url.includes("get_notification_inbox") ||
          url.includes("social_notifications") ||
          url.includes("get_monthly_top_listeners")
        )
          return route.fulfill({ json: [] });
        return route.fulfill({ json: {} });
      });
      await page.route("**/api/music/**", (route) =>
        route.fulfill({
          json: { shelves: [], sections: [], tracks: [], results: [] },
        })
      );
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await cloudRequested;
      await page
        .getByRole(width >= 1024 ? "complementary" : "navigation", {
          name: width >= 1024 ? "Primary navigation" : "Mobile navigation",
          exact: true,
        })
        .getByRole("button", { name: "Library", exact: true })
        .click();
      const skeleton = page.getByTestId("library-skeleton");
      await skeleton.waitFor();
      assert.equal(await skeleton.getAttribute("aria-busy"), "true");
      assert.equal(await skeleton.locator("button,input").count(), 0);
      assert.equal(
        await page.getByText("Belum ada playlist.", { exact: false }).count(),
        0,
        "no false empty state during loading"
      );
      const animation = await skeleton
        .locator(".skeleton-block")
        .first()
        .evaluate((el) => getComputedStyle(el, "::after").animationName);
      assert.equal(
        animation,
        reducedMotion === "reduce" ? "none" : "librarySkeletonShimmer"
      );
      assert.equal(
        await page
          .locator("body")
          .evaluate((el) => el.scrollWidth <= innerWidth),
        true,
        `no overflow ${width}`
      );
      await page.screenshot({
        path: `.cache/library-skeleton-${width}-${reducedMotion}.png`,
        fullPage: true,
      });
      await page.getByTestId("library-tab-liked").click();
      await skeleton.waitFor();
      assert.ok(
        (await skeleton.locator(".h-12.w-12").count()) > 0,
        "liked uses song rows"
      );
      await page.getByTestId("library-tab-playlists").click();
      release();
      await page
        .getByTestId("library-view")
        .getByText("Playlist tersimpan", { exact: true })
        .waitFor();
      await skeleton.waitFor({ state: "hidden" });
      gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByTestId("library-sync-indicator").waitFor();
      assert.ok(
        await page
          .getByTestId("library-view")
          .getByText("Playlist tersimpan", { exact: true })
          .isVisible(),
        "background refresh preserves content"
      );
      assert.equal(await skeleton.count(), 0);
      release();
      await page
        .getByTestId("library-sync-indicator")
        .waitFor({ state: "hidden" });
      await page.getByTestId("library-tab-blend").click();
      await page
        .getByRole("status", { name: "Memuat Blend", exact: true })
        .waitFor();
      releaseBlend();
      await page.getByText("Belum ada Blend.", { exact: false }).waitFor();
      assert.equal(await skeleton.count(), 0);
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS Library skeleton: delayed cloud/Blend requests, grid + track rows, loaded/background transition, accessible placeholders, light/dark, reduced motion, 320/390/1280, no overflow/runtime errors. Controlled fixtures, not production auth."
  );
} finally {
  await browser.close();
}
