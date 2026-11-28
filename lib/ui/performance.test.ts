import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotStore } from './snapshotStore';
import { shouldUseLiteEffects } from './effects';

test('playback clock does not broadcast to browsing subscribers', () => {
  const state = { track: 'a', play: () => {}, library: [] as string[] };
  const music = createSnapshotStore(state);
  const clock = createSnapshotStore(0);
  let browseUpdates = 0, timeUpdates = 0;
  music.subscribe(() => browseUpdates++);
  clock.subscribe(() => timeUpdates++);
  for (let i = 1; i <= 40; i++) { music.publish({ ...state }); clock.publish(i / 4); }
  assert.equal(browseUpdates, 0, 'ten seconds of progress leaves the feed untouched');
  assert.equal(timeUpdates, 40);
  assert.equal(music.getSnapshot(), state, 'equal snapshots retain reference identity');
  music.publish({ ...state, track: 'b' });
  assert.equal(browseUpdates, 1, 'real track changes still update browsing');
});
test('snapshot subscriptions clean up and equal numbers do not notify', () => {
  const store = createSnapshotStore(0);
  let updates = 0;
  const stop = store.subscribe(() => updates++);
  store.publish(0); store.publish(1); stop(); store.publish(2);
  assert.equal(updates, 1);
  assert.equal(store.getSnapshot(), 2);
  assert.equal(store.getServerSnapshot(), 0, 'SSR snapshot stays fixed while Suspense hydrates');
});
test('constrained device hints select lite effects without requiring new browser APIs', () => {
  for (const hints of [{ mobile: true }, { cores: 4 }, { memoryGB: 2 }, { saveData: true }, { reducedMotion: true }]) {
    assert.equal(shouldUseLiteEffects(hints), true);
  }
  assert.equal(shouldUseLiteEffects({ mobile: true, cores: 8 }), true);
  assert.equal(shouldUseLiteEffects({ mobile: false, cores: 8, memoryGB: 8 }), false);
  assert.equal(shouldUseLiteEffects({}), false, 'unknown desktop hardware is not misclassified; media queries identify phones');
});
