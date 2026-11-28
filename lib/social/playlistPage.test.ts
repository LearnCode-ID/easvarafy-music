import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPlaylistId,
  playlistPath,
  publicPlaylistUrl,
  getPlaylistPage,
} from "./playlistPage";

test("playlist routes allow legacy IDs and UUIDs but reject paths and query injection", async () => {
  for (const id of [
    "owned-list",
    "11111111-1111-4111-8111-111111111111",
    "playlist_1",
  ]) {
    assert.equal(isPlaylistId(id), true);
    assert.equal(playlistPath(id), `/playlist/${id}`);
    assert.equal(playlistPath(id, true), `/playlist/?id=${id}`);
  }
  for (const id of [
    "",
    "../private",
    "a/b",
    "a?owner=foreign",
    "a#frag",
    "a%2fb",
    "a".repeat(129),
  ]) {
    assert.equal(isPlaylistId(id), false);
    assert.throws(() => playlistPath(id));
    assert.equal(await getPlaylistPage(id), null);
  }
});
test("shared playlist URL uses the canonical public HTTPS origin, including native fallback", () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL = "https://music.example.org/ignored";
    assert.equal(
      publicPlaylistUrl("owned-list"),
      "https://music.example.org/playlist/owned-list"
    );
    process.env.NEXT_PUBLIC_APP_URL = "capacitor://localhost";
    assert.throws(() => publicPlaylistUrl("owned-list"));
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});
