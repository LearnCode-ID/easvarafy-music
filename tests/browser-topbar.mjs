import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

// Controlled guest/catalogue fixtures. No production writes or live playback.
const base = process.env.UI_TEST_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
await mkdir('.cache', { recursive: true });
const errors = [];
try {
  for (const [width, theme, pureBlack] of [[320, 'light', false], [390, 'dark', false], [390, 'dark', true], [820, 'light', false], [820, 'dark', false]]) {
    const context = await browser.newContext({ viewport: {width, height: 844}, colorScheme: theme });
    await context.addInitScript(({theme, pureBlack}) => {
      Object.defineProperty(navigator, 'deviceMemory', {configurable: true, value: 8});
      Object.defineProperty(navigator, 'hardwareConcurrency', {configurable: true, value: 8});
      localStorage.setItem('sonora_settings_v1', JSON.stringify({theme, pureBlack}));
    }, {theme, pureBlack});
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/fixture.supabase.co/**', route => route.fulfill({json: []}));
    await page.route('**/api/music/**', route => route.fulfill({json: {shelves: [], tracks: [], results: [], quickPickCandidates: [], trendingTracks: []}}));
    await page.goto(base, {waitUntil: 'networkidle'});
    await page.locator('.glass-topbar').waitFor();
    const check = async () => {
      const style = await page.locator('.glass-topbar').evaluate(header => {
        const actual = getComputedStyle(header);
        return {background: actual.backgroundColor, page: getComputedStyle(document.querySelector('.glass-app')).backgroundColor, blur: actual.backdropFilter, border: actual.borderBottomWidth};
      });
      assert.equal(style.background, style.page, 'header shares the exact page background color');
      assert.equal(style.blur, 'none', 'no glass blur changes the header tone');
      assert.equal(style.border, '0px', 'no contrasting divider');
      if (pureBlack) assert.equal(style.background, 'rgb(0, 0, 0)');
    };
    await check();
    // CSS fallbacks must not replace the topbar with the glass surface token.
    for (const effects of ['lite', 'full']) {
      await page.locator('.glass-app').evaluate((app, value) => app.dataset.effects = value, effects);
      await check();
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {features: [{name: 'prefers-reduced-transparency', value: 'reduce'}]});
    await check();
    await cdp.send('Emulation.setEmulatedMedia', {features: []});
    await page.locator('.glass-topbar').screenshot({path: `.cache/topbar-${width}-${theme}-${pureBlack}.png`});
    await page.getByRole('button', {name: 'Open settings', exact: true}).click();
    await check();
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      document.querySelector('main').append(spacer);
      window.scrollTo(0, 500);
    });
    await check();
    assert.equal(Math.round((await page.locator('.glass-topbar').boundingBox()).y), 0, 'header stays sticky while scrolling');
    assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
    await context.close();
    console.log(`PASS topbar ${width}px ${theme}${pureBlack ? ' pure black' : ''}: page-matched background, lite/full/reduced-transparency, settings action, sticky scroll`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
