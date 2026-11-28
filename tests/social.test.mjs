import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  C = "33333333-3333-4333-8333-333333333333";
test("social migration: follow RLS, private feed, two-party consent, invite binding, optimistic save, revocation, inbox isolation", async () => {
  const db = new PGlite();
  try {
    for (const path of [
      "tests/fixtures/schema.sql",
      "supabase/migrations/20261127010000_private_profiles_streak_playlists.sql",
      "supabase/migrations/20261127020000_follows_blends.sql",
      "supabase/migrations/20261127030000_social_rpc_privileges.sql",
    ]) {
      await db.exec(await readFile(path, "utf8"));
      if(path === "tests/fixtures/schema.sql") await db.exec("alter default privileges in schema public grant execute on functions to anon,authenticated; alter default privileges in schema public grant all on tables to anon,authenticated");
    }
    const scalar = async (q, p = []) =>
      Object.values((await db.query(q, p)).rows[0])[0];
    const as = async (id) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id || "",
      ]);
      await db.exec(`set role ${id ? "authenticated" : "anon"}`);
    };
    await db.query(
      "insert into profiles(id,name,email) values($1,'Alice','a@invalid'),($2,'Bob','b@invalid'),($3,'C','c@invalid')",
      [A, B, C]
    );
    await db.query(
      "insert into user_liked_tracks(user_id,video_id,track) values($1,'secret',$2::jsonb)",
      [
        B,
        JSON.stringify({
          videoId: "secret",
          title: "Private favorite",
          artist: "Secret artist",
          artists: [],
          type: "SONG",
          thumbnail: "",
          duration: 10,
        }),
      ]
    );
    await as(A);
    await db.query(
      "insert into user_follows(follower_id,following_id) values($1,$2)",
      [A, B]
    );
    await assert.rejects(
      db.query(
        "insert into user_follows(follower_id,following_id) values($1,$2)",
        [B, A]
      )
    );
    await assert.rejects(
      db.query(
        "insert into user_follows(follower_id,following_id) values($1,$1)",
        [A]
      )
    );
    assert.equal(
      (await scalar("select get_follow_counts($1)", [B])).followers_count,
      1
    );
    assert.equal(
      (await scalar("select get_profile_page($1)", [A])).share_friend_activity,
      false
    );
    let feed = (await db.query("select * from get_following_feed()")).rows;
    assert.equal(feed[0].name, "Profil privat");
    assert.equal(feed[0].last_track, null);
    const id = await scalar("select create_blend_invite($1)", [B]);
    const code = await scalar(
      "select invite_code from blend_playlists where id=$1",
      [id]
    );
    await assert.rejects(db.query("select get_blend_tastes($1)", [id]));
    await as(C);
    assert.equal(await scalar("select count(*)::int from blend_playlists"), 0);
    await assert.rejects(db.query("select join_blend($1)", [code]));
    await as(B);
    assert.equal(
      await scalar("select count(*)::int from social_notifications"),
      1
    );
    assert.equal(await scalar("select join_blend($1)", [code]), id);
    assert.equal(await scalar("select join_blend($1)", [code]), id);
    assert.equal(
      (await scalar("select get_blend_tastes($1)", [id]))[B][0].videoId,
      "secret"
    );
    await as(A);
    assert.equal(
      (await scalar("select get_blend_tastes($1)", [id]))[B][0].title,
      "Private favorite"
    );
    await as(B);
    await assert.rejects(
      db.query("update blend_playlists set match_percent=100 where id=$1", [id])
    );
    const version = await scalar(
      "select version from blend_playlists where id=$1",
      [id]
    );
    await db.query("select save_blend_mix($1,$2,'[]',50,'[]',$3)", [
      id,
      version,
      B,
    ]);
    await assert.rejects(
      db.query("select save_blend_mix($1,$2,'[]',50,'[]',$3)", [id, version, B])
    );
    await as(A);
    assert.equal(
      await scalar(
        "select count(*)::int from social_notifications where event='blend_accepted'"
      ),
      1
    );
    await db.query("select leave_blend($1)", [id]);
    await assert.rejects(db.query("select get_blend_tastes($1)", [id]));
    assert.deepEqual(
      await scalar("select tracks from blend_playlists where id=$1", [id]),
      []
    );
    await as(B);
    await db.query("delete from user_follows where follower_id=$1", [A]);
    assert.equal(
      (await scalar("select get_follow_counts($1)", [B])).followers_count,
      1
    );
    await db.query(
      "update profiles set is_public=true,share_friend_activity=false where id=$1",
      [B]
    );
    await as(A);
    feed = (await db.query("select * from get_following_feed()")).rows;
    assert.equal(feed[0].name, "Bob");
    assert.equal(feed[0].last_track, null);
    await db.query(
      "delete from user_follows where follower_id=$1 and following_id=$2",
      [A, B]
    );
    await as(null);
    assert.equal(
      (await scalar("select get_follow_counts($1)", [B])).followers_count,
      0
    );
    await assert.rejects(db.query("select * from blend_playlists"));
    assert.equal(await scalar("select has_function_privilege('anon','public.get_blend_tastes(uuid)','EXECUTE')"),false);
    assert.equal(await scalar("select has_function_privilege('anon','public.save_user_playlist(jsonb,integer)','EXECUTE')"),false);
    assert.equal(await scalar("select has_table_privilege('authenticated','public.user_follows','UPDATE')"),false);
    assert.equal(await scalar("select has_column_privilege('authenticated','public.user_follows','created_at','INSERT')"),false);
  } finally {
    await db.close();
  }
});
