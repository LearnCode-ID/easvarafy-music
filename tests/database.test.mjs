import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("actual migration: two owners + anonymous, RLS, privacy transitions, media, playlists, calendar streak", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("./fixtures/schema.sql", import.meta.url), "utf8")
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261127010000_private_profiles_streak_playlists.sql",
          import.meta.url
        ),
        "utf8"
      )
    );
    const scalar = async (sql, params = []) =>
      Object.values((await db.query(sql, params)).rows[0])[0];
    const as = async (uid) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        uid || "",
      ]);
      await db.exec(`set role ${uid ? "authenticated" : "anon"}`);
    };
    const page = (id) => scalar("select public.get_profile_page($1)", [id]);
    const count = (table, id = A) =>
      scalar(`select count(*)::int from ${table} where user_id=$1`, [id]);
    await db.query(
      "insert into profiles(id,name,email,avatar_url,banner_path) values($1::uuid,'Account A','private@example.invalid',$1::text||'/legacy.png',$1::text||'/banner.webp'),($2,'Account B','private2@example.invalid',null,null)",
      [A, B]
    );
    await db.query(
      "update profiles set avatar_url='profile-media:'||id::text||'/avatar.webp' where id=$1",
      [A]
    );
    await db.query(
      "insert into storage.objects values('profile-media',$1::text||'/banner.webp'),('profile-media',$1||'/avatar.webp'),('avatars',$1||'/old.png')",
      [A]
    );
    await db.query("insert into monthly_listening_stats(user_id,month_key,play_count,listen_seconds,last_track_video_id,last_track_title,last_track_artist,last_track_thumbnail) values($1,'2026-11',159,59520,'secret-video','Private title','Private artist','private-thumbnail')",[A]);
    await as(A);
    assert.equal(
      (await page(A)).is_public,
      false,
      "new profiles default private"
    );
    const payload = {
      id: "real-user-playlist",
      ownerId: A,
      name: "Favorit",
      description: "Genuine user data",
      isPublic: true,
      tracks: [
        { videoId: "youtube-B", title: "Second" },
        { videoId: "youtube-A", title: "First" },
      ],
    };
    const save = (p, version = 0) =>
      scalar("select public.save_user_playlist($1,$2)", [
        JSON.stringify(p),
        version,
      ]);
    let pl = await save(payload);
    assert.equal(pl.version, 1);
    await assert.rejects(save({...payload,ownerId:B}),/Pemilik playlist/);
    assert.deepEqual(
      pl.tracks.map((t) => t.videoId),
      ["youtube-B", "youtube-A"]
    );
    const reordered = { ...payload, tracks: [...payload.tracks].reverse() };
    pl = await save(reordered, 1);
    assert.equal(pl.version, 2);
    await assert.rejects(save(payload, 1), /perangkat lain/);
    assert.deepEqual(
      (
        await scalar(
          "select tracks from user_playlists where id='real-user-playlist'"
        )
      ).map((t) => t.videoId),
      ["youtube-A", "youtube-B"]
    );
    await as(B);
    assert.deepEqual(await page(A), { status: "private" });
    assert.equal(await count("user_playlists"), 0);
    assert.equal(
      (await db.query("select * from profiles where id=$1", [A])).rows.length,
      0
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0
    );
    assert.equal(
      (
        await db.query(
          "update profiles set bio='attack' where id=$1 returning id",
          [A]
        )
      ).rows.length,
      0
    );
    assert.equal(
      (
        await db.query(
          "update user_playlists set name='attack' where user_id=$1 returning id",
          [A]
        )
      ).rows.length,
      0
    );
    await assert.rejects(
      db.query(
        "insert into user_playlists(id,user_id,name) values('attack',$1,'attack')",
        [A]
      ),
      /row-level security/
    );
    await as(null);
    assert.deepEqual(await page(A), { status: "private" });
    assert.equal(await count("user_playlists"), 0);
    await assert.rejects(
      scalar("select record_daily_activity()"),
      /permission denied/
    );
    await as(A);
    await db.query("update profiles set is_public=true where id=$1", [A]);
    await as(null);
    assert.equal((await db.query("select * from get_monthly_top_listeners('2026-11')")).rows.length,0,'leaderboard requires statistics opt-in');
    const directory = (await db.query("select * from search_public_profiles('Account A')")).rows[0];
    assert.equal(directory.month_play_count,0,'directory does not expose disabled stats');
    const publicPage = await page(A);
    assert.equal(publicPage.status, "ok");
    assert.equal("email" in publicPage, false);
    assert.equal("stats" in publicPage, false);
    assert.equal(publicPage.streak, null);
    assert.equal(publicPage.role, "user");
    assert.equal(await count("user_playlists"), 1);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      2,
      "unreferenced old images are not public"
    );
    const legacy = (await db.query("select * from get_public_profile($1)", [A]))
      .rows[0];
    assert.equal(legacy.month_play_count, 0, "legacy RPC gates stats opt-in");
    assert.equal(
      legacy.last_track_title,
      null,
      "legacy RPC never exposes private history"
    );
    await as(A);
    await db.query(
      "insert into user_playlists(id,user_id,name,is_public,tracks) values('private-list',$1,'Private',false,'[{\"videoId\":\"secret\"}]')",
      [A]
    );
    await db.query("update profiles set is_public=false where id=$1", [A]);
    await as(null);
    assert.deepEqual(await page(A), { status: "private" });
    assert.equal(await count("user_playlists"), 0);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
      "media denied after privatizing"
    );
    await as(A);
    assert.equal(
      await count("user_playlists"),
      2,
      "owner retains all playlists"
    );
    await db.query("update profiles set is_public=true where id=$1", [A]);
    await as(B);
    assert.equal(
      await count("user_playlists"),
      1,
      "only formerly public playlist becomes visible again"
    );
    assert.equal(
      (
        await db.query(
          "select tracks from user_playlists where id='private-list'"
        )
      ).rows.length,
      0
    );
    assert.equal(await count("user_streaks"), 0);
    await as(A);
    const activity = (zone) =>
      scalar("select record_daily_activity($1)", [zone]);
    let streak = await activity("Asia/Jakarta");
    assert.equal(streak.current, 1);
    const duplicateOpens = await Promise.all(Array.from({length:8},()=>activity('Asia/Jakarta')));
    assert.ok(duplicateOpens.every(s=>s.current===1),'overlapping same-day calls stay idempotent');
    assert.equal(streak.longest, 1);
    assert.equal(streak.active_today, true);
    streak = await activity("America/New_York");
    assert.equal(streak.current, 1);
    assert.equal(
      streak.timezone,
      "Asia/Jakarta",
      "another device cannot reset timezone"
    );
    assert.equal(await count("user_activity_days"), 1, "same day idempotent");
    await assert.rejects(
      db.query("update user_streaks set current_streak=999"),
      /permission denied/
    );
    await assert.rejects(
      db.query("insert into user_activity_days values($1,current_date+1)", [A]),
      /permission denied/
    );
    // Set historical server state as DB owner, never add a client-controlled date
    // parameter to the production RPC just for testing.
    await db.exec("reset role");
    await db.query(
      "update user_streaks set last_active=(now() at time zone timezone)::date-1,current_streak=5,longest_streak=8 where user_id=$1",
      [A]
    );
    await db.query("delete from user_activity_days where user_id=$1", [A]);
    await as(A);
    streak = await scalar("select read_profile_streak($1)", [A]);
    assert.equal(
      streak.current,
      5,
      "yesterday streak retained before activity"
    );
    assert.equal(streak.active_today, false);
    streak = await activity("Asia/Jakarta");
    assert.equal(streak.current, 6);
    assert.equal(streak.longest, 8);
    await db.exec("reset role");
    await db.query(
      "update user_streaks set last_active=(now() at time zone timezone)::date-2,current_streak=6 where user_id=$1",
      [A]
    );
    await as(A);
    assert.equal(
      (await scalar("select read_profile_streak($1)", [A])).current,
      0,
      "skipped day expires streak"
    );
    streak = await activity("Asia/Jakarta");
    assert.equal(streak.current, 1);
    assert.equal(streak.longest, 8);
    await as(B);
    assert.equal(
      await scalar("select read_profile_streak($1)", [A]),
      null,
      "streak hidden without opt-in"
    );
    await as(A);
    await db.query(
      "update profiles set show_streak=true,show_stats=true where id=$1",
      [A]
    );
    await as(null);
    assert.equal((await page(A)).streak.current, 1);
    assert.equal((await page(A)).streak.timezone,null,'public streak does not expose account timezone preference');
    assert.equal('show_stats' in await page(A),false,'public DTO excludes privacy/account settings');
    const top = (await db.query("select * from get_monthly_top_listeners('2026-11')")).rows[0];
    assert.equal(top.play_count,159);
    assert.equal(top.last_track_title,null,'legacy leaderboard never exposes private listening history');
    assert.equal(top.liked_count,0);
    await assert.rejects(
      db.query("select * from user_streaks"),
      /permission denied/,
      "raw streak table never public"
    );
    assert.equal((await page(B)).status, "private");
    assert.deepEqual(await page("33333333-3333-4333-8333-333333333333"), {
      status: "not_found",
    });
    // Calendar dates, not elapsed seconds: DST-short/long days & UTC offset.
    assert.equal(
      await scalar(
        "select ('2026-03-09 04:01Z'::timestamptz at time zone 'America/New_York')::date - ('2026-03-08 05:01Z'::timestamptz at time zone 'America/New_York')::date"
      ),
      1
    );
    assert.equal(
      await scalar(
        "select ('2026-11-02 05:01Z'::timestamptz at time zone 'America/New_York')::date - ('2026-11-01 04:01Z'::timestamptz at time zone 'America/New_York')::date"
      ),
      1
    );
  } finally {
    await db.close();
  }
});
