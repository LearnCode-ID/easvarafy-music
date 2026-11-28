export type ArtworkPalette = readonly [string, string, string];

/** Quantized dominant pixel clusters; transparent/near-black letterbox pixels
 * are ignored. Runs only on a 32px thumbnail, never on a scrolling frame. */
export function paletteFromPixels(pixels: ArrayLike<number>): ArtworkPalette | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    if (pixels[i + 3] < 128 || Math.max(r, g, b) < 24) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++; bucket.r += r; bucket.g += g; bucket.b += b;
    buckets.set(key, bucket);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.n - a.n);
  if (!ranked.length) return null;
  const colors = ranked.map(({ n, r, g, b }) => [Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  const chosen = [colors[0]];
  for (const color of colors.slice(1)) {
    if (chosen.every((c) => c.reduce((sum, value, i) => sum + (value - color[i]) ** 2, 0) > 3600)) chosen.push(color);
    if (chosen.length === 3) break;
  }
  while (chosen.length < 3) chosen.push(chosen[chosen.length - 1]);
  const rgb = (color: number[]) => `rgb(${color.join(' ')})`;
  return [rgb(chosen[0]), rgb(chosen[1]), rgb(chosen[2])];
}
