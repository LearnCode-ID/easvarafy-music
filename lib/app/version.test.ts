import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_UPDATE_URL,
  compareVersions,
  evaluateUpdate,
  formatVersionLabel,
  normalizeReleaseNotes,
  parseVersion,
  parseVersionPayload,
  type AppVersionInfo,
} from './version';

const latest = (patch: Partial<AppVersionInfo> = {}): AppVersionInfo => ({
  latestVersion: '1.1.0',
  latestBuild: 40,
  minVersion: null,
  minBuild: null,
  updateUrl: APP_UPDATE_URL,
  releaseNotes: [],
  forceUpdate: false,
  publishedAt: null,
  ...patch,
});

test('parseVersion handles prefixes and suffixes', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.2.3-beta+45'), [1, 2, 3]);
  assert.deepEqual(parseVersion(''), []);
  assert.deepEqual(parseVersion(null), []);
});

test('compareVersions pads missing parts', () => {
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.9', '1.1.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('v2', '1.99'), 1);
});

test('evaluateUpdate: newer version name -> available', () => {
  assert.deepEqual(evaluateUpdate({ version: '1.0.0', build: 99 }, latest()), { kind: 'available', force: false });
});

test('evaluateUpdate: same version, lower build -> available (old APKs are 1.0 / build 1)', () => {
  assert.equal(evaluateUpdate({ version: '1.1.0', build: 12 }, latest()).kind, 'available');
  assert.equal(evaluateUpdate({ version: '1.0', build: 1 }, latest({ latestVersion: '1.0.0' })).kind, 'available');
});

test('evaluateUpdate: same or newer -> up to date', () => {
  assert.equal(evaluateUpdate({ version: '1.1.0', build: 40 }, latest()).kind, 'up-to-date');
  assert.equal(evaluateUpdate({ version: '1.2.0', build: 1 }, latest()).kind, 'up-to-date');
  assert.equal(evaluateUpdate({ version: '1.1.0', build: null }, latest()).kind, 'up-to-date');
});

test('evaluateUpdate: force flag and minimum version', () => {
  assert.deepEqual(evaluateUpdate({ version: '1.0.0', build: 5 }, latest({ forceUpdate: true })), {
    kind: 'available',
    force: true,
  });
  const min = latest({ minVersion: '1.0.5' });
  assert.deepEqual(evaluateUpdate({ version: '1.0.0', build: 5 }, min), { kind: 'available', force: true });
  assert.deepEqual(evaluateUpdate({ version: '1.0.6', build: 5 }, min), { kind: 'available', force: false });
  // forceUpdate never affects an install that is already current.
  assert.equal(evaluateUpdate({ version: '1.1.0', build: 40 }, latest({ forceUpdate: true })).kind, 'up-to-date');
});

test('normalizeReleaseNotes accepts arrays, lines and pipes', () => {
  assert.deepEqual(normalizeReleaseNotes(['- a', ' b ', '']), ['a', 'b']);
  assert.deepEqual(normalizeReleaseNotes('• satu\n• dua'), ['satu', 'dua']);
  assert.deepEqual(normalizeReleaseNotes('satu | dua'), ['satu', 'dua']);
  assert.deepEqual(normalizeReleaseNotes(42), []);
});

test('parseVersionPayload validates and defaults', () => {
  assert.equal(parseVersionPayload(null), null);
  assert.equal(parseVersionPayload({ latestVersion: '' }), null);
  const parsed = parseVersionPayload({
    latestVersion: '1.1.0',
    latestBuild: '57',
    updateUrl: 'http://evil.example',
    releaseNotes: ['x'],
    forceUpdate: 'true',
  });
  assert.ok(parsed);
  assert.equal(parsed.latestBuild, 57);
  assert.equal(parsed.updateUrl, APP_UPDATE_URL);
  assert.equal(parsed.forceUpdate, true);
  assert.deepEqual(parsed.releaseNotes, ['x']);
});

test('formatVersionLabel', () => {
  assert.equal(formatVersionLabel('v1.1.0', 57), '1.1.0 (57)');
  assert.equal(formatVersionLabel('1.1.0'), '1.1.0');
  assert.equal(formatVersionLabel(null), '—');
});
