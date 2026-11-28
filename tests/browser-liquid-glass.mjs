import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.UI_TEST_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir('.cache', { recursive: true });
const errors = [];
async function assertThemeColors(locator, background, foreground) {
  const actual = await locator.evaluate((el, tokens) => {
    const probe = document.createElement('span');
    probe.style.backgroundColor = `var(${tokens.background})`;
    probe.style.color = `var(${tokens.foreground})`;
    el.append(probe);
    const expected = getComputedStyle(probe);
    const rendered = getComputedStyle(el);
    const result = { background: rendered.backgroundColor, foreground: rendered.color, expectedBackground: expected.backgroundColor, expectedForeground: expected.color };
    probe.remove();
    return result;
  }, { background, foreground });
  assert.equal(actual.background, actual.expectedBackground, 'action keeps the selected theme background');
  assert.equal(actual.foreground, actual.expectedForeground, 'action keeps its matching contrasting foreground');
}
const track = (i) => ({ provider: 'youtube', videoId: `glass-${i}`, title: `Glass song ${i}`, artist: `Artist ${i}`, artists: [{ name: `Artist ${i}`, artistId: null }], duration: 180, thumbnail: `https://glass-art.test/glass-art-${i}.svg`, type: 'SONG' });
try {
  for (const [width, theme, dockStyle, dynamicColor = true, playerControlsStyle = 'EXPRESSIVE', accentPreset = 'metrolist', forceLite = false] of [[320, 'light', 'default'], [390, 'dark', 'default'], [1366, 'light', 'default'], [1366, 'dark', 'default'], [390, 'dark', 'liquid-glass'], [390, 'light', 'default', false], [390, 'dark', 'default', false, 'CLASSIC', 'emerald'], [390, 'light', 'default', false, 'CLASSIC', 'violet'], [1366, 'dark', 'liquid-glass', true, 'EXPRESSIVE', 'metrolist', true]]) {
    const context = await browser.newContext({ viewport: { width, height: 860 }, colorScheme: theme, reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    await context.addInitScript(({ theme, dockStyle, dynamicColor, playerControlsStyle, accentPreset, forceLite }) => {
      Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: forceLite ? 2 : 8 });
      Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: forceLite ? 2 : 8 });
      window.__browseRenders = 0;
      new PerformanceObserver(list => { window.__browseRenders += list.getEntries().filter(entry => entry.name === 'easvarafy:browse-render').length; }).observe({ type: 'mark' });
      localStorage.setItem('sonora_settings_v1', JSON.stringify({ theme, dockStyle, dynamicColor, playerControlsStyle, accentPreset }));
      class FakePlayer {
        constructor(el, options) { this.options = options; this.position = 0; this.started = Date.now(); this.state = 2; window.__glassPlayer = this; queueMicrotask(() => options.events.onReady({ target: this })); }
        loadVideoById(id) { this.id = id; this.position = 0; this.started = Date.now(); }
        playVideo() { this.started = Date.now(); this.state = 1; this.options.events.onStateChange({ data: 1, target: this }); }
        pauseVideo() { this.position = this.getCurrentTime(); this.state = 2; this.options.events.onStateChange({ data: 2, target: this }); }
        getCurrentTime() { return this.position + (this.state === 1 ? (Date.now() - this.started) / 1000 : 0); }
        getDuration() { return 180; }
        getPlayerState() { return this.state; }
        seekTo(t) { this.position = t; this.started = Date.now(); }
        setVolume(v) { this.volume = v; }
        setPlaybackRate() {} unMute() {} mute() {} destroy() {}
      }
      window.YT = { Player: FakePlayer };
    }, { theme, dockStyle, dynamicColor, playerControlsStyle, accentPreset, forceLite });
    const page = await context.newPage();
    if (width === 320) { const cdp = await context.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 }); }
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/fixture.supabase.co/**', route => route.fulfill({ json: [] }));
    await page.route('**/glass-art-*.svg', route => route.request().url().includes('art-2.') ? route.abort() : route.fulfill({ contentType: 'image/svg+xml', headers: { 'access-control-allow-origin': '*' }, body: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><path fill="${route.request().url().includes('art-1.') ? '#28aac0' : '#cc4864'}" d="M0 0h320v320H0z"/></svg>` }));
    await page.route('**/api/music/**', route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith('/up-next') ? { candidates: Array.from({ length: 30 }, (_, i) => ({ track: track(i), source: 'catalog', order: i })) } : { shelves: [], tracks: [], results: [], lines: [], quickPickCandidates: [], trendingTracks: [] } }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('home-editorial-card').first().click();
    const open = page.getByRole('button', { name: 'Open Now Playing for Glass song 0', exact: true });
    await open.waitFor();
    if (dynamicColor) {
      await page.waitForFunction(() => document.querySelector('[data-testid="artwork-ambient"]')?.getAttribute('data-palette-source') === 'pixels');
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ambient-a').trim()), 'rgb(204 72 100)');
    } else {
      assert.equal(await page.getByTestId('artwork-ambient').getAttribute('data-palette-source'), 'theme');
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ambient-a')), '');
    }
    if (width < 1024 && dockStyle === 'default') {
      const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
      const box = await nav.boundingBox();
      assert.ok(box.x >= 10 && box.x + box.width <= width - 10 && box.y + box.height < 860 - 4, 'navigation is inset');
      await assertThemeColors(nav.locator('[aria-current="page"]'), '--m3-primary-container', '--m3-on-primary-container');
      assert.equal(await nav.evaluate(el => getComputedStyle(el).backdropFilter), 'none', 'mobile avoids costly backdrop blur');
    }
    const lite = await page.locator('.glass-app').getAttribute('data-effects') === 'lite';
    if (width >= 1024 && !forceLite) {
      assert.equal(lite, false, 'capable desktop retains full effects');
      assert.match(await page.locator('.glass-sidebar').evaluate(el => getComputedStyle(el).backdropFilter), /blur\(20px\) saturate\(1.8\)/);
    }
    if (lite) {
      assert.equal(await page.locator('[data-liquid-glass-engine="kube-svg-refraction"]').count(), 0);
      assert.equal(await page.locator('.glass-ambient-mesh').evaluate(el => getComputedStyle(el).animationName), 'none');
    }
    if (width === 320) {
      await page.waitForFunction(() => window.__glassPlayer?.getCurrentTime() >= 6);
      const baseline = await page.evaluate(() => ({ renders: window.__browseRenders, time: window.__glassPlayer.getCurrentTime() }));
      await page.waitForFunction(time => window.__glassPlayer.getCurrentTime() >= time + 2, baseline.time);
      const after = await page.evaluate(() => window.__browseRenders);
      assert.equal(after - baseline.renders, 0, `steady playback must not rerender browsing on progress ticks: ${JSON.stringify(await page.evaluate(() => performance.getEntriesByName('easvarafy:music-change').map(e => e.detail)))}`);
      console.log(`PASS 6x CPU / 320px render budget: ${after - baseline.renders} browse commits during 2s advancing playback`);
    }
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Now Playing', exact: true });
    await dialog.waitFor();
    if (lite) assert.equal(await page.getByTestId('player-background').getAttribute('data-player-bg-renderer'), 'lite');
    await assertThemeColors(dialog.getByRole('button', { name: 'Pause', exact: true }), '--m3-primary', '--m3-on-primary');
    await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
    await dialog.getByRole('button', { name: 'Play', exact: true }).waitFor();
    await assertThemeColors(dialog.getByRole('button', { name: 'Play', exact: true }), '--m3-primary', '--m3-on-primary');
    const seek = dialog.getByRole('slider', { name: 'Seek playback position' });
    await seek.fill('45');
    await page.waitForFunction(() => window.__glassPlayer.position === 45);
    await dialog.getByRole('slider', { name: 'Volume', exact: true }).fill('35');
    await page.waitForFunction(() => window.__glassPlayer.volume === 35);
    await dialog.getByRole('button', { name: 'Next track', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Glass song 1', exact: true }).waitFor();
    if (dynamicColor) await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ambient-a').trim() === 'rgb(40 170 192)');
    await dialog.getByRole('button', { name: 'Previous track', exact: true }).click();
    await dialog.getByRole('heading', { name: 'Glass song 0', exact: true }).waitFor();
    await page.waitForFunction(() => { const img = document.querySelector('[data-testid="now-playing-artwork"] img'); return img?.complete && img.naturalWidth > 0; });
    await page.getByTestId('now-playing-content').evaluate(el => { el.scrollTop = 0; });
    assert.ok((await page.getByTestId('now-playing-artwork').boundingBox()).y >= (width < 640 ? 104 : 50), 'artwork is not clipped behind the header');
    await dialog.screenshot({ path: `.cache/glass-player-${width}-${theme}-${dockStyle}-${dynamicColor}-${playerControlsStyle}-${accentPreset}.png` });
    await dialog.getByRole('tab', { name: 'Queue', exact: true }).click();
    await dialog.getByRole('button', { name: /Remove Glass song 1 from queue/ }).waitFor();
    if (dynamicColor && width === 320) {
      await dialog.getByRole('tab', { name: 'Playing', exact: true }).click();
      await dialog.getByRole('button', { name: 'Next track', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Glass song 1', exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Next track', exact: true }).click();
      await dialog.getByRole('heading', { name: 'Glass song 2', exact: true }).waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="artwork-ambient"]')?.getAttribute('data-palette-source') === 'artwork-fallback');
      assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--ambient-a')), '');
    }
    await dialog.getByRole('button', { name: 'Close Now Playing', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    if (width === 320) assert.equal(await page.locator('.glass-ambient-mesh').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.screenshot({ path: `.cache/glass-home-${width}-${theme}-${dockStyle}-${dynamicColor}-${playerControlsStyle}-${accentPreset}.png` });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS Liquid Glass: inset navigation, adaptive lite/full effects, actual pixel palette and track changes, play/pause, previous/next, seek, volume, queue, reduced motion, no overflow/errors; 320/390/1366 light/dark plus optical dock, colored classic/expressive play-pause and active navigation. Controlled fixtures, not live media.');
} finally { await browser.close(); }
