import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanupReport,
  provenSeedMarker,
} from "../scripts/cleanup-demo-playlists.mjs";

test("cleanup never matches names, guessed IDs, or partial marker values", () => {
  for (const row of [
    { name: "Favorit" },
    { name: "My Playlist" },
    { id: "seed-playlist-1" },
    { is_demo: "true" },
    { source: "seedling" },
  ])
    assert.equal(provenSeedMarker(row), null);
  assert.deepEqual(provenSeedMarker({ is_demo: true }), ["is_demo", true]);
  assert.deepEqual(provenSeedMarker({ source: "seed" }), ["source", "seed"]);
  assert.deepEqual(
    cleanupReport([
      { id: "real", name: "Favorit", tracks: [{ videoId: "genuine" }] },
    ]),
    [
      {
        id: "real",
        user_id: undefined,
        name: "Favorit",
        track_count: 1,
        marker: null,
        action: "retain-unproven",
      },
    ]
  );
});
