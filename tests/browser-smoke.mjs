import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
await mkdir(".cache", { recursive: true });
const A = "11111111-1111-4111-8111-111111111111";
const profile = {
  status: "ok",
  id: A,
  name: "Pendengar Uji",
  bio: "Musik menemani perjalanan.",
  role: "developer",
  avatar_url: null,
  banner_path: null,
  created_at: "2026-11-01T00:00:00Z",
  is_public: true,
  show_badges: true,
  show_stats: true,
  show_streak: true,
  stats: { plays: 159, seconds: 59520 },
  streak: {
    current: 12,
    longest: 16,
    active_today: true,
    timezone: "Asia/Jakarta",
    days: Array.from({ length: 14 }, (_, i) => ({
      date: `2026-11-${14 + i}`,
      active: i > 1,
    })),
  },
};
const base = process.env.UI_TEST_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const errors = [];
try {
  for (const width of [320, 390, 1280]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 },
      reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/fixture.supabase.co/**", (route) => {
      const url = route.request().url();
      if (url.includes("get_profile_page"))
        return route.fulfill({ json: profile });
      if (
        url.includes("user_playlists") ||
        url.includes("get_monthly_top_listeners")
      )
        return route.fulfill({ json: [] });
      return route.fulfill({ json: {} });
    });
    await page.route("**/api/music/**", (route) =>
      route.fulfill({ json: { sections: [], tracks: [], results: [] } })
    );
    await page.goto(`${base}/profile/${A}`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Pendengar Uji" }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Edit Profil", exact: true })
        .count(),
      0,
      "anonymous cannot edit"
    );
    assert.equal(
      await page
        .locator("body")
        .evaluate((el) => el.scrollWidth <= window.innerWidth),
      true,
      `no horizontal overflow at ${width}`
    );
    assert.equal(
      await page
        .locator(".profile-flame")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
      "reduced motion"
    );
    await page.screenshot({
      path: `.cache/profile-public-${width}.png`,
      fullPage: true,
    });
    if (width < 1000) {
      const nav = page.getByRole("navigation", { name: "Mobile navigation" });
      const tabs = await nav.getByRole("button").allTextContents();
      assert.deepEqual(
        tabs.map((t) => t.trim()),
        ["Home", "Search", "Explore", "Library", "Profil"]
      );
      await nav.getByRole("button", { name: "Profil", exact: true }).click();
      await page.getByRole("dialog").waitFor();
    }
    await page.screenshot({
      path: `.cache/profile-${width}.png`,
      fullPage: true,
    });
    await ctx.close();
  }
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: A,
    email: "owner@example.invalid",
    role: "authenticated",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-11-01T00:00:00Z",
  };
  const token = `${Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" })
  ).toString("base64url")}.${Buffer.from(
    JSON.stringify({ sub: A, aud: "authenticated", role: "authenticated", exp })
  ).toString("base64url")}.fixture`;
  await ctx.addInitScript(
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
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let patchCalls = 0;
  let uploadCalls = 0;
  const picture = await readFile(".cache/profile-public-390.png");
  await page.route("**/fixture.supabase.co/**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("/storage/v1/object/")) {
      if (req.method() === "POST") {
        uploadCalls++;
        return route.fulfill({
          json: { Key: "profile-media/upload", Id: "test-object" },
        });
      }
      return route.fulfill({ body: picture, contentType: "image/png" });
    }
    if (url.includes("/auth/v1/user")) return route.fulfill({ json: user });
    if (url.includes("get_profile_page"))
      return route.fulfill({ json: profile });
    if (url.includes("/rest/v1/profiles")) {
      if (req.method() === "PATCH") {
        patchCalls++;
        Object.assign(profile, req.postDataJSON());
        await new Promise((r) => setTimeout(r, 400));
        return route.fulfill({ json: { id: A } });
      }
      return route.fulfill({
        json: [
          {
            ...user,
            name: "Pendengar Uji",
            avatar_url: null,
            role: "developer",
            is_banned: false,
          },
        ],
      });
    }
    if (url.includes("/user_playlists"))
      return route.fulfill({
        json: [
          {
            id: "owned-list",
            user_id: A,
            name: "Playlist nyata uji",
            description: "",
            tags: [],
            is_public: false,
            version: 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            tracks: [
              {
                videoId: "fixture-song",
                title: "Lagu Uji",
                artist: "Artis Uji",
                duration: 180,
                thumbnail: "",
                type: "SONG",
              },
            ],
          },
        ],
      });
    if (
      url.includes("/user_liked_tracks") ||
      url.includes("get_monthly_top_listeners")
    )
      return route.fulfill({ json: [] });
    if (url.includes("record_daily_activity"))
      return route.fulfill({ json: profile.streak });
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/music/**", (route) =>
    route.fulfill({ json: { sections: [], tracks: [], results: [] } })
  );
  await page.goto(`${base}/profile/${A}`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "Edit Profil", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Edit Profil", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Bio", exact: true })
    .fill("Bio yang diperbarui");
  const save = page.getByRole("button", {
    name: "Simpan perubahan",
    exact: true,
  });
  await save.click();
  await page.getByRole("button", { name: "Menyimpan…", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Menyimpan…", exact: true })
      .isDisabled(),
    true
  );
  await page
    .getByRole("dialog", { name: "Edit Profil" })
    .waitFor({ state: "hidden" });
  assert.equal(patchCalls, 1);
  // Banner input -> real canvas crop/compression -> private storage -> saved reference.
  await page.getByRole("button", { name: "Edit Profil", exact: true }).click();
  const fileInput = page.locator("input[type=file]").first();
  await fileInput.setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bad"),
  });
  await page
    .getByText("Gunakan JPG, PNG, atau WebP.", { exact: true })
    .waitFor();
  await fileInput.setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: picture,
  });
  await page.getByAltText("Preview crop").waitFor();
  await page.getByRole("slider", { name: "Zoom", exact: true }).fill("1.5");
  await page.getByRole("button", { name: "Gunakan crop", exact: true }).click();
  await page
    .getByRole("button", { name: "Simpan perubahan", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Edit Profil" })
    .waitFor({ state: "hidden" });
  assert.equal(uploadCalls, 1);
  assert.ok(profile.banner_path.endsWith(".webp"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByAltText("Banner profil").waitFor();
  await page.getByRole("button", { name: "Edit Profil", exact: true }).click();
  await ctx.setOffline(true);
  await page
    .getByRole("button", { name: "Simpan perubahan", exact: true })
    .click();
  await page
    .getByText(
      "Offline. Perubahan belum disimpan. Hubungkan internet lalu coba lagi.",
      { exact: true }
    )
    .waitFor();
  assert.equal(patchCalls, 2, "offline save never claims success or submits");
  await ctx.setOffline(false);
  await page.getByRole("button", { name: "Tutup", exact: true }).click();
  // Starting music mounts one mini-player above the tabs and route changes keep
  // the actual player stage DOM alive (not only React queue state).
  await page.getByRole("button", { name: "Putar", exact: true }).click();
  const mini = page.getByRole("button", {
    name: "Open Now Playing for Lagu Uji",
    exact: true,
  });
  await mini.waitFor();
  const mb = await mini.boundingBox();
  const nb = await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .boundingBox();
  assert.ok(
    mb.y + mb.height <= nb.y,
    "mini-player does not overlap the navigation"
  );
  await page
    .getByTestId("youtube-stage")
    .evaluate((el) => (el.dataset.persisted = "yes"));
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Library", exact: true })
    .click();
  await page.waitForURL(`${base}/`);
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Profil", exact: true })
    .click();
  await page.waitForURL(`${base}/profile/${A}`);
  assert.equal(
    await page.getByTestId("youtube-stage").getAttribute("data-persisted"),
    "yes"
  );
  // Revalidation must replace public content with the private placeholder.
  profile.status = "private";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("heading", { name: "Profil ini privat" }).waitFor();
  assert.equal(await page.getByText("Musik menemani perjalanan.").count(), 0);
  await ctx.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 320/390/1280px, five tabs, login gate, owner editor async save, banner crop/upload/reload, offline save failure, mini-player spacing and persistent stage, reduced motion, privacy revalidation, no browser errors. Browser data are controlled fixtures; authorization tested separately in PostgreSQL."
  );
} finally {
  await browser.close();
}
