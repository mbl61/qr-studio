import test from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { encodeText } from '../src/qr.js';
import { paintCanvas, toSvg } from '../src/render.js';

function rasterCanvas() {
  const canvas = { width: 0, height: 0, pixels: null };
  const context = { fillStyle: '#fff', fillRect(x, y, w, h) {
    canvas.pixels ??= new Uint8ClampedArray(canvas.width * canvas.height * 4);
    const color = this.fillStyle === '#000' ? 0 : 255;
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      const i = (row * canvas.width + col) * 4;
      canvas.pixels[i] = canvas.pixels[i + 1] = canvas.pixels[i + 2] = color;
      canvas.pixels[i + 3] = 255;
    }
  } };
  canvas.getContext = () => context;
  return canvas;
}

for (const [name, text, options] of [
  ['ASCII', 'HELLO', {}], ['URL', 'https://example.com/path?a=1&b=2', { level: 'Q' }],
  ['Unicode', '你好, world 👋', {}], ['leading zeros', '0000123000', { mode: 'numeric' }],
  ['spaces', '  HELLO WORLD  ', { mode: 'alphanumeric' }],
  ['mixed blocks', 'Version five, four blocks.', { version: 5, level: 'Q' }],
  ['version metadata', 'SEVEN', { version: 7, level: 'H' }],
]) {
  test(`independent decoder recovers ${name} from the raster export`, () => {
    const q = encodeText(text, options);
    const canvas = paintCanvas(rasterCanvas(), q.matrix, { scale: 8 });
    const decoded = jsQR(canvas.pixels, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
    assert.ok(decoded, 'QR code located');
    assert.equal(decoded.data, text);
    assert.equal(decoded.version, q.version);
  });
}

test('independent decoder recovers the SVG path output', () => {
  const svg = toSvg(encodeText('SVG export').matrix, { scale: 8 });
  const width = Number(svg.match(/width="(\d+)"/)[1]);
  const canvas = rasterCanvas(); canvas.width = canvas.height = width;
  const context = canvas.getContext('2d'); context.fillRect(0, 0, width, width); context.fillStyle = '#000';
  for (const match of svg.matchAll(/M(\d+),(\d+)h(\d+)v1h-\d+z/g)) context.fillRect(Number(match[1]) * 8, Number(match[2]) * 8, Number(match[3]) * 8, 8);
  assert.equal(jsQR(canvas.pixels, width, width).data, 'SVG export');
});
