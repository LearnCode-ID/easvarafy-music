import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteFromPixels } from './palette';

const pixels = (...colors: number[][]) => new Uint8ClampedArray(colors.flat());
test('artwork palette selects real dominant clusters, not a track ID hash', () => {
  assert.deepEqual(paletteFromPixels(pixels([220, 30, 40, 255], [220, 30, 40, 255], [20, 180, 210, 255], [120, 80, 190, 255])), ['rgb(220 30 40)', 'rgb(20 180 210)', 'rgb(120 80 190)']);
});
test('artwork sampling ignores transparent and black letterbox pixels', () => {
  assert.deepEqual(paletteFromPixels(pixels([0, 0, 0, 255], [255, 255, 255, 0], [80, 140, 200, 255])), Array(3).fill('rgb(80 140 200)'));
  assert.equal(paletteFromPixels(pixels([0, 0, 0, 255])), null);
  assert.equal(paletteFromPixels([]), null);
});
test('quantization averages neighboring pixels and handles grayscale', () => {
  assert.deepEqual(paletteFromPixels(pixels([100, 100, 100, 255], [110, 110, 110, 255])), Array(3).fill('rgb(105 105 105)'));
});
