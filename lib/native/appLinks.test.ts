import { test } from 'node:test';
import assert from 'node:assert/strict';
import { androidAssetLinks, nativeAppLinkPath } from './appLinks';

const origin = 'https://easvarafy-music.vercel.app';
const id = '11111111-1111-4111-8111-111111111111';
test('HTTPS content links become static-compatible native routes', () => {
  assert.equal(nativeAppLinkPath(`${origin}/playlist/my-playlist_1`), '/playlist/?id=my-playlist_1');
  assert.equal(nativeAppLinkPath(`${origin}/profile/${id}/?utm_source=share#ignored`), `/profile/?id=${id}`);
});
test('reject foreign hosts, auth, custom schemes, malformed and unsafe IDs', () => {
  for (const url of [
    'not a url', `http://easvarafy-music.vercel.app/playlist/abc`,
    'https://easvarafy-music.vercel.app.attacker.com/playlist/abc',
    'https://attacker.com/playlist/abc', `${origin}:444/playlist/abc`,
    'https://user:pass@easvarafy-music.vercel.app/playlist/abc',
    'com.easvarafy.app://auth/callback?code=secret', `${origin}/auth/callback?code=secret`,
    `${origin}/profile/not-a-uuid`, `${origin}/playlist/`, `${origin}/playlist/abc/more`,
    `${origin}/playlist/%2fadmin`, `${origin}/playlist/${'a'.repeat(129)}`,
    `${origin}/admin`, `${origin}/playlist/?id=abc`,
  ]) assert.equal(nativeAppLinkPath(url), null, url);
});
test('association trusts only explicit valid signing certificate hashes', () => {
  assert.deepEqual(androidAssetLinks(undefined), []);
  const hash = Array(32).fill('AB').join(':');
  const links = androidAssetLinks(`${hash.toLowerCase()}, ${hash}`);
  assert.deepEqual(links[0].target.sha256_cert_fingerprints, [hash]);
  assert.equal(links[0].target.package_name, 'com.easvarafy.app');
  assert.deepEqual(links[0].relation, ['delegate_permission/common.handle_all_urls']);
  for (const bad of ['placeholder', 'AB:CD', 'G'.repeat(64)]) assert.throws(() => androidAssetLinks(bad));
});

test('cold launch, repeated warm links, and disposal work without losing subsequent links', async () => {
  const { listenForAppLinks } = await import('./appLinks');
  let handler: (event: { url: string }) => void = () => {};
  let removed = 0;
  const paths: string[] = [];
  const stop = listenForAppLinks(Promise.resolve({
    async addListener(_event, fn) { handler = fn; return { async remove() { removed++; } }; },
    async getLaunchUrl() { return { url: `${origin}/playlist/cold` }; },
  }), path => paths.push(path), error => { throw error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(paths, ['/playlist/?id=cold']);
  handler({ url: `${origin}/profile/${id}` });
  handler({ url: `${origin}/playlist/cold` });
  assert.equal(paths.length, 3); // not permanently deduplicated: reopening is legitimate
  stop();
  handler({ url: `${origin}/playlist/after-dispose` });
  assert.equal(paths.length, 3);
  assert.equal(removed, 1);
});

test('new live intent wins a delayed launch URL; OAuth is left to the auth listener', async () => {
  const { listenForAppLinks } = await import('./appLinks');
  let handler: (event: { url: string }) => void = () => {};
  let finish!: (value: { url: string }) => void;
  const launch = new Promise<{ url: string }>(resolve => { finish = resolve; });
  const paths: string[] = [];
  const stop = listenForAppLinks(Promise.resolve({
    async addListener(_event, fn) { handler = fn; return { async remove() {} }; },
    getLaunchUrl() { return launch; },
  }), path => paths.push(path), error => { throw error; });
  await new Promise(resolve => setImmediate(resolve));
  handler({ url: 'com.easvarafy.app://auth/callback?code=private' });
  assert.deepEqual(paths, []);
  handler({ url: `${origin}/playlist/new` });
  finish({ url: `${origin}/playlist/stale` });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(paths, ['/playlist/?id=new']);
  stop();
});

test('cleanup during async registration removes listener and does not navigate', async () => {
  const { listenForAppLinks } = await import('./appLinks');
  let finish!: (value: { remove(): Promise<void> }) => void;
  const registration = new Promise<{ remove(): Promise<void> }>(resolve => { finish = resolve; });
  let removed = 0;
  const stop = listenForAppLinks(Promise.resolve({
    addListener() { return registration; },
    async getLaunchUrl() { throw new Error('must not read launch URL after disposal'); },
  }), () => { throw new Error('must not navigate'); }, error => { throw error; });
  await new Promise(resolve => setImmediate(resolve));
  stop();
  finish({ async remove() { removed++; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(removed, 1);
});
