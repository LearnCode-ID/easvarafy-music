import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followerDisplay } from './followerDisplay';

test('admin cosmetic follower label is exactly 1,2 jt without altering input', () => {
  for (const count of [0, 12, 1200000, null, undefined]) {
    const result = followerDisplay(count, 'admin');
    assert.equal(result.label, '1,2 jt');
    assert.match(result.note!, /Angka tampilan/);
  }
  const status = { followers_count: 12, following_count: 3, is_following: false };
  followerDisplay(status.followers_count, 'admin');
  assert.deepEqual(status, { followers_count: 12, following_count: 3, is_following: false });
});

test('ordinary, developer and hidden roles keep real follower counts', () => {
  for (const role of ['user', 'developer', undefined] as const) {
    assert.equal(followerDisplay(17, role).label, '17');
    assert.equal(followerDisplay(0, role).label, '0');
    assert.equal(followerDisplay(null, role).label, '…');
    assert.equal(followerDisplay(17, role).note, undefined);
  }
});
