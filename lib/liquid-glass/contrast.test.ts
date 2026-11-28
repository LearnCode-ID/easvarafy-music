import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Conservative WCAG AA token check: composite the shared tint against a
// worst-case fully black/white album image. This is not a whole-page audit.
const css = readFileSync('app/liquid-glass.css', 'utf8');
const luminance = (rgb: number[]) => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
const over = (front: number[], alpha: number, back: number[]) => front.map((c, i) => c * alpha + back[i] * (1 - alpha));
const hex = (s: string) => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
for (const dark of [false, true]) test(`${dark ? 'dark' : 'light'} shared glass ink and secondary labels meet 4.5:1 on worst-case ambient`, () => {
  const block = css.split(dark ? '.dark {' : ':root {')[1].split('}')[0];
  const token = (name: string) => block.match(new RegExp(`--${name}: ([^;]+);`))![1];
  const opacity = Number(token('ambient-opacity'));
  const base = over(dark ? [255, 255, 255] : [0, 0, 0], opacity, dark ? [17, 18, 22] : [247, 248, 252]);
  const tint = token('glass-tint').match(/[\d.]+/g)!.map(Number);
  const card = token('glass-card').match(/[\d.]+/g)!.map(Number);
  for (const bg of [base, over(tint.slice(0, 3), tint[3], base), over(card.slice(0, 3), card[3], base)]) {
    for (const name of ['glass-ink', 'glass-muted']) {
      const a = luminance(hex(token(name))), b = luminance(bg);
      const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1`);
    }
  }
});
