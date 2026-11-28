import { chromium } from "playwright";
import assert from "node:assert/strict";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  ID = "44444444-4444-4444-8444-444444444444",
  CODE = "a".repeat(32);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const base = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
const errors = [];
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
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
        aud: "authenticated",
        role: "authenticated",
        exp,
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
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    let following = false,
      followWrites = 0,
      joinCalls = 0,
      saveCalls = 0;
    const track = (id, owner) => ({
      videoId: id,
      title: `Lagu ${id}`,
      artist: "Artis",
      artists: [],
      thumbnail: "",
      duration: 180,
      type: "SONG",
      addedByUserId: owner,
      tasteOwnerIds: [owner],
      source: "favorite",
    });
    const blend = {
      id: ID,
      creator_id: B,
      partner_id: A,
      invite_code: CODE,
      invite_expires_at: "2026-12-04T00:00:00Z",
      status: "active",
      match_percent: 50,
      shared_artists: ["Artis"],
      tracks: [track("satu", A), track("dua", B)],
      version: 2,
      last_refreshed_at: "2026-11-27T00:00:00Z",
      created_at: "2026-11-27T00:00:00Z",
      updated_at: "2026-11-27T00:00:00Z",
    };
    await page.route("**/fixture.supabase.co/**", async (route) => {
      const req = route.request(),
        url = req.url();
      if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
      if (url.includes("/profiles"))
        return route.fulfill({
          json: [
            {
              ...user,
              name: "A",
              is_banned: false,
              avatar_url: null,
              role: "user",
            },
          ],
        });
      if (url.includes("get_profile_page"))
        return route.fulfill({ json: { status: "private" } });
      if (url.includes("get_follow_counts"))
        return route.fulfill({
          json: {
            followers_count: following ? 1 : 0,
            following_count: 0,
            is_following: following,
          },
        });
      if (url.includes("get_follow_list"))
        return route.fulfill({
          json: [
            {
              id: A,
              name: "A",
              avatar_url: null,
              role: "user",
              is_private: false,
              is_following: false,
            },
          ],
        });
      if (url.includes("/user_follows")) {
        following = req.method() !== "DELETE";
        followWrites++;
        return route.fulfill({ status: 201, json: [] });
      }
      if (url.includes("/join_blend")) {
        joinCalls++;
        return route.fulfill({ json: ID });
      }
      if (url.includes("/get_blend_members"))
        return route.fulfill({
          json: [
            { id: A, name: "A", avatar_url: null },
            { id: B, name: "B", avatar_url: null },
          ],
        });
      if (url.includes("/get_blend_tastes"))
        return route.fulfill({
          json: { [A]: [track("satu", A)], [B]: [track("dua", B)] },
        });
      if (url.includes("/save_blend_mix")) {
        saveCalls++;
        return route.fulfill({ json: null });
      }
      if (url.includes("/blend_playlists"))
        return route.fulfill({ json: blend });
      if (
        url.includes("/get_notification_inbox") ||
        url.includes("/social_notifications") ||
        url.includes("/user_playlists") ||
        url.includes("/user_liked_tracks") ||
        url.includes("/get_monthly_top_listeners")
      )
        return route.fulfill({ json: [] });
      return route.fulfill({ json: {} });
    });
    await page.route("**/api/music/**", (route) =>
      route.fulfill({ json: { tracks: [], sections: [], results: [] } })
    );
    await page.goto(`${base}/profile/${B}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Follow", exact: true }).click();
    await page
      .getByRole("button", { name: "Following", exact: true })
      .waitFor();
    assert.equal(followWrites, 1);
    await page.getByRole("button", { name: "Following", exact: true }).click();
    await page
      .getByRole("button", { name: "Konfirmasi unfollow", exact: true })
      .waitFor();
    assert.equal(followWrites, 1, "first unfollow click only confirms");
    await page
      .getByRole("button", { name: "Konfirmasi unfollow", exact: true })
      .click();
    await page.getByRole("button", { name: "Follow", exact: true }).waitFor();
    assert.equal(followWrites, 2);
    await page
      .getByRole("button", { name: "0 Followers", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Followers", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Tutup daftar follow" }).click();
    assert.equal(
      await page.locator("button button").count(),
      0,
      "no nested interactive buttons"
    );
    await page.goto(`${base}/blend?code=${CODE}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Blend kamu × B" }).waitFor();
    assert.ok(joinCalls >= 1);
    assert.ok(await page.getByText("50%", { exact: true }).isVisible());
    await page
      .getByRole("button", { name: "Refresh Blend", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Refresh Blend", exact: true })
      .waitFor({ state: "visible" });
    await page.waitForFunction(
      () => !document.body.innerText.includes("Menyiapkan dan menyimpan Blend")
    );
    assert.equal(saveCalls, 1);
    assert.equal(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
      true,
      `no horizontal overflow ${width}`
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS social fixture: 320/390/1280, private-profile follow/unfollow confirm/list, automatic invite acceptance, detail, refresh persistence, no overflow/runtime errors"
  );
} finally {
  await browser.close();
}
