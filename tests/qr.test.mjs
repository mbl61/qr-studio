import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encodeText, encodeBytes, capacity, generator, remainder, alignmentPositions, formatWord, versionWord } from '../src/qr.js';
import { toSvg, paintCanvas } from '../src/render.js';

const fixtures = JSON.parse(readFileSync(new URL('./reference-fixtures.json', import.meta.url)));
const hash = matrix => createHash('sha256').update(Uint8Array.from(matrix.flatMap(row => [...row]))).digest('hex');

test('HELLO: byte mode, level M, padding, RS bytes, all penalties, and metadata', () => {
  const q = encodeText('HELLO');
  assert.equal(q.version, 1); assert.equal(q.mask, 4); assert.equal(q.format, 0x45f9);
  assert.deepEqual(q.data, [64,84,132,84,196,196,240,236,17,236,17,236,17,236,17,236]);
  assert.deepEqual(q.blocks[0].correction, [35,115,35,153,236,8,201,247,55,223]);
  assert.deepEqual(generator(10), [1,216,194,159,111,199,94,95,113,157,193]);
  assert.deepEqual(q.candidates.map(c => Object.values(c.score)), [
    [186,114,800,0,1100], [217,177,800,0,1194], [202,96,800,0,1098], [176,96,840,0,1112],
    [163,129,760,0,1052], [210,171,840,0,1221], [211,168,840,0,1219], [174,129,880,0,1183],
  ]);
  assert.equal(q.encodedBits, 52); assert.equal(q.terminatorBits, 4); assert.equal(q.alignmentBits, 0); assert.equal(q.padWords, 9);
});

for (const fixture of fixtures.allVersions) {
  test(`independent matrices: version ${fixture.version}, level ${fixture.level}, all 8 masks`, () => {
    const { version, level, length, seed } = fixture;
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 73 + seed * 19 + Math.floor(i / 3)) % 256);
    const q = encodeBytes(bytes, { version, level });
    assert.equal(q.capacity.data, fixture.dataCapacity);
    for (const candidate of q.candidates) {
      assert.equal(hash(candidate.matrix), fixture.candidates[candidate.mask].hash, `mask ${candidate.mask}`);
      assert.equal(candidate.score.total, fixture.candidates[candidate.mask].score, `penalty ${candidate.mask}`);
    }
    assert.equal(q.mask, fixture.candidates.findIndex(c => c.score === Math.min(...fixture.candidates.map(c => c.score))));
    assert.equal(q.data.length, q.capacity.data);
    assert.equal(q.interleaved.length, q.capacity.total);
    const available = q.functions.reduce((sum, row) => sum + row.filter(value => value === 0).length, 0);
    assert.equal(available, q.capacity.available);
    const divisor = generator(q.capacity.correctionPerBlock);
    for (const block of q.blocks) assert.ok(remainder([...block.data, ...block.correction], divisor).every(value => value === 0));
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) {
      // Format fields vary by mask; all other reserved cells are invariant.
      if (q.functions[y][x] && q.functions[y][x] !== 5) assert.ok(q.candidates.every(c => c.matrix[y][x] === q.unmasked[y][x]));
    }
  });
}

for (const [index, fixture] of fixtures.textCases.entries()) {
  test(`independent text fixture ${index + 1}: ${fixture.mode}, ${fixture.text.length} characters`, () => {
    const q = encodeText(fixture.text, { mode: fixture.mode, level: fixture.level, version: fixture.forcedVersion ?? 'auto' });
    assert.equal(q.version, fixture.version); assert.equal(q.mask, fixture.mask);
    assert.equal(hash(q.matrix), fixture.hash); assert.equal(q.score.total, fixture.score);
  });
}

test('mixed-length blocks, version 32 alignment, and version BCH', () => {
  const q = encodeText('HELLO', { version: 5, level: 'Q' });
  assert.deepEqual(q.blocks.map(b => b.data.length), [15,15,16,16]);
  assert.equal(q.capacity.remainder, 7);
  assert.deepEqual(alignmentPositions(32), [6,34,60,86,112,138]);
  assert.equal(versionWord(7), 0x07c94);
  assert.equal(formatWord('M', 4), 0x45f9);
});

test('automatic mode, explicit levels, UTF-8 counts, raw bytes, and manual masks', () => {
  assert.equal(encodeText('00123', { mode: 'auto' }).mode, 'numeric');
  assert.equal(encodeText('HELLO WORLD', { mode: 'auto' }).mode, 'alphanumeric');
  assert.equal(encodeText('hello', { mode: 'auto' }).mode, 'byte');
  assert.equal(encodeText('A', { level: 'L' }).level, 'L');
  const q = encodeText('你好👋');
  assert.equal(q.count, 10); assert.equal(q.eci, true);
  assert.equal(encodeBytes(new Uint8Array([0,128,255])).eci, false);
  const fixed = encodeText('HELLO', { mask: 0 });
  assert.equal(fixed.mask, 0); assert.equal(fixed.bestMask, 4);
  assert.equal(hash(fixed.matrix), hash(fixed.candidates[0].matrix));
});

test('capacity boundaries and shortened terminator', () => {
  assert.equal(encodeText('0'.repeat(41), { level: 'L', mode: 'numeric' }).terminatorBits, 1);
  assert.equal(encodeText('A'.repeat(14)).version, 1);
  assert.equal(encodeText('A'.repeat(15)).version, 2);
  assert.throws(() => encodeText('A'.repeat(15), { version: 1 }), /does not fit/);
  assert.throws(() => encodeText('1'.repeat(7090), { level: 'L', mode: 'numeric' }), /too long/);
  assert.throws(() => encodeText('A'.repeat(4297), { level: 'L', mode: 'alphanumeric' }), /too long/);
  assert.throws(() => encodeBytes(new Uint8Array(2954)), /too long/);
});

test('invalid input and options fail clearly', () => {
  for (const options of [{ mode: 'invalid' }, { level: 'X' }, { level: '__proto__' }, { version: 0 }, { version: 41 }, { version: 1.5 }, { mask: 8 }, { mask: -1 }]) assert.throws(() => encodeText('A', options));
  assert.throws(() => encodeText('12a', { mode: 'numeric' }), /only digits/);
  assert.throws(() => encodeText('lowercase', { mode: 'alphanumeric' }), /uppercase/);
  assert.throws(() => encodeText('\ud800'), /Unicode/);
  assert.throws(() => encodeText(null), /text/);
  assert.throws(() => encodeBytes([0]), /Uint8Array/);
  assert.throws(() => capacity(0));
});

test('SVG and canvas exports preserve the matrix and four-module quiet zone', () => {
  const q = encodeText('HELLO');
  const svg = toSvg(q.matrix, { scale: 20 });
  assert.match(svg, /width="580" height="580" viewBox="0 0 29 29"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  const painted = Array.from({ length: 580 }, () => new Uint8Array(580));
  const ctx = { fillStyle: '', fillRect(x,y,w,h) { for (let r=y;r<y+h;r++) for(let c=x;c<x+w;c++) painted[r][c] = this.fillStyle === '#000' ? 1 : 0; } };
  const canvas = { getContext: () => ctx };
  paintCanvas(canvas, q.matrix, { scale: 20 });
  assert.equal(canvas.width, 580); assert.equal(ctx.imageSmoothingEnabled, false);
  for (let y=0;y<29;y++) for(let x=0;x<29;x++) assert.equal(painted[y*20+10][x*20+10], q.matrix[y-4]?.[x-4] ?? 0);
  assert.throws(() => toSvg(q.matrix, { border: 3 }), /four/);
  assert.throws(() => paintCanvas(canvas, q.matrix, { scale: 1.5 }), /integer/);
});
