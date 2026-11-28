import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playlistCoverPath } from './playlistCover';
const path = '11111111-1111-4111-8111-111111111111/cover-22222222-2222-4222-8222-222222222222.webp';
test('playlist image references only resolve a safe owner-scoped raster object path', () => {
  assert.equal(playlistCoverPath(`playlist-covers:${path}`), path);
  for (const value of ['', undefined, 'https://evil.test/a.jpg', `playlist-covers:${path}/`, `playlist-covers:${path}?token=x`, 'playlist-covers:../image.svg', `playlist-covers:${path.replace('.webp', '.svg')}`]) assert.equal(playlistCoverPath(value), null);
});
