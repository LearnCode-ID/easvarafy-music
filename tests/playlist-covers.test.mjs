import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('private playlist cover storage: owner writes, public opt-in, foreign-reference defense and revocation', async () => {
  const db = new PGlite();
  try {
    for (const file of ['tests/fixtures/schema.sql', 'supabase/migrations/20261127010000_private_profiles_streak_playlists.sql', 'supabase/migrations/20261127050000_playlist_cover_uploads.sql']) await db.exec(await readFile(file, 'utf8'));
    const as = async uid => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid || '']); await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`); };
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
    const path = `${A}/cover-33333333-3333-4333-8333-333333333333.webp`;
    const ref = `playlist-covers:${path}`;
    await db.query('insert into profiles(id,name) values ($1,\'A\'),($2,\'B\')', [A, B]);
    await as(A);
    await db.query("insert into storage.objects values ('playlist-covers',$1)", [path]);
    assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id='playlist-covers'"), 1, 'owner sees uploaded but unsaved bytes');
    await assert.rejects(db.query("insert into storage.objects values ('playlist-covers',$1)", [`${B}/foreign.webp`]), /row-level security/);
    await as(B);
    assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id='playlist-covers'"), 0);
    await db.query('update profiles set is_public=true where id=$1', [B]);
    await db.query('insert into user_playlists(user_id,id,name,is_public,cover_url) values($1,\'foreign\',\'Foreign ref\',true,$2)', [B, ref]);
    await as(null);
    assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id='playlist-covers'"), 0, 'publishing another owner\'s reference cannot expose their image');
    await as(A);
    await db.query('insert into user_playlists(user_id,id,name,is_public,cover_url) values($1,\'own\',\'Own\',true,$2)', [A, ref]);
    await as(null);
    assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id='playlist-covers'"), 0, 'public playlist still hidden under private profile');
    await as(A); await db.query('update profiles set is_public=true where id=$1', [A]);
    await as(null);
    assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id='playlist-covers'"), 1);
    await as(B);
    assert.equal((await db.query("delete from storage.objects where bucket_id='playlist-covers' returning name")).rows.length, 0);
    assert.equal((await db.query("update storage.objects set name='overwrite' where bucket_id='playlist-covers' returning name")).rows.length, 0);
    await as(A); await db.query('update user_playlists set is_public=false where user_id=$1', [A]);
    await as(null);
    assert.equal(await scalar("select count(*)::int from storage.objects where bucket_id='playlist-covers'"), 0, 'privacy change takes effect on next read');
    await as(A);
    assert.equal((await db.query("delete from storage.objects where bucket_id='playlist-covers' returning name")).rows.length, 1);
    await db.exec('reset role');
    assert.equal(await scalar("select public from storage.buckets where id='playlist-covers'"), false);
  } finally { await db.close(); }
});
