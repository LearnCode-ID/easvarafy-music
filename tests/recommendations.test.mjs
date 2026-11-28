import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
test("recommendation migration: two owners, anonymous denial, whitelist, limits, replay dedupe, epoch reset and disabled ingestion", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;alter default privileges in schema public grant execute on functions to anon,authenticated;alter default privileges in schema public grant all on tables to anon,authenticated;`
    );
    await db.query("insert into auth.users values($1),($2)", [A, B]);
    await db.exec(
      await readFile(
        "supabase/migrations/20261127040000_private_recommendations.sql",
        "utf8"
      )
    );
    const scalar = async (q, p = []) =>
      Object.values((await db.query(q, p)).rows[0])[0];
    const as = async (id) => {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id || "",
      ]);
      await db.exec(`set role ${id ? "authenticated" : "anon"}`);
    };
    const get = () => scalar("select public.get_recommendation_taste()");
    const ingest = (events, epoch = 0) =>
      scalar("select public.ingest_recommendation_signals($1::jsonb,$2)", [
        JSON.stringify(events),
        epoch,
      ]);
    const event = {
      id: "event-1",
      kind: "listen",
      origin: "explicit",
      seconds: 40,
      at: Date.now(),
      user_id: B,
      email: "ignored",
      track: {
        provider: "youtube",
        videoId: "real-track",
        title: "Actual provider metadata",
        artist: "Artist",
        artists: [{ name: "Artist", artistId: "UC-real" }],
        duration: 180,
        thumbnail: "",
        type: "SONG",
        secret: "ignored",
      },
    };
    await as(null);
    await assert.rejects(get, /permission denied/);
    await assert.rejects(() => ingest([event]), /permission denied/);
    await as(A);
    assert.deepEqual(await get(), { enabled: true, epoch: 0, events: [] });
    let taste = await ingest([event]);
    assert.equal(taste.events.length, 1);
    assert.equal(taste.events[0].user_id, undefined);
    assert.equal(taste.events[0].track.secret, undefined);
    assert.equal(
      (await ingest([event])).events.length,
      1,
      "retry is idempotent"
    );
    await as(B);
    assert.deepEqual((await get()).events, []);
    assert.equal(
      await scalar(
        "select count(*)::int from public.recommendation_tastes where user_id=$1",
        [A]
      ),
      0,
      "RLS hides A even with table SELECT grant"
    );
    await assert.rejects(
      () =>
        db.query(
          "update public.recommendation_tastes set events=$1 where user_id=$2",
          ["[]", A]
        ),
      /permission denied/
    );
    await assert.rejects(
      () => ingest([{ ...event, kind: "forged" }]),
      /Invalid signal/
    );
    await assert.rejects(
      () => ingest([{ ...event, seconds: 999999 }]),
      /Invalid signal/
    );
    await assert.rejects(
      () => ingest(Array.from({ length: 31 }, () => event)),
      /Batch limit/
    );
    await assert.rejects(
      () =>
        ingest([
          { ...event, track: { ...event.track, title: "x".repeat(180001) } },
        ]),
      /Invalid batch/
    );
    for (let i = 0; i < 6; i++)
      await ingest(
        Array.from({ length: 30 }, (_, j) => ({
          ...event,
          id: `batch-${i}-${j}`,
        }))
      );
    await assert.rejects(
      () => ingest([{ ...event, id: "rate-over" }]),
      /Rate limit/
    );
    await as(A);
    const reset = await scalar(
      "select public.set_recommendation_preferences(true,true)"
    );
    assert.equal(reset.epoch, 1);
    assert.deepEqual(reset.events, []);
    assert.deepEqual(
      (await ingest([event], 0)).events,
      [],
      "stale offline batch cannot restore reset data"
    );
    await scalar("select public.set_recommendation_preferences(false,false)");
    assert.deepEqual(
      (await ingest([event], 2)).events,
      [],
      "disabled account ignores signals"
    );
    await as(B);
    assert.equal((await get()).events.length, 180, "A reset never touches B");
  } finally {
    await db.close();
  }
});
