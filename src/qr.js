import { ECC_WORDS, BLOCK_COUNTS } from './tables.js';

// QR Code Model 2. Coordinates are matrix[y][x]; a dark module is 1.
const LEVELS = { L: { index: 0, bits: 1 }, M: { index: 1, bits: 0 }, Q: { index: 2, bits: 3 }, H: { index: 3, bits: 2 } };
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const MODES = { numeric: { indicator: 1, widths: [10, 12, 14] }, alphanumeric: { indicator: 2, widths: [9, 11, 13] }, byte: { indicator: 4, widths: [8, 16, 16] } };
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function append(bits, value, width) {
  for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`${name} must be an integer from ${min} to ${max}.`);
}

export function capacity(version, level = 'M') {
  integer(version, 1, 40, 'Version');
  if (!Object.hasOwn(LEVELS, level)) throw new RangeError('Choose correction level L, M, Q, or H.');
  const a = Math.floor(version / 7) + 2;
  let available = (16 * version + 128) * version + 64;
  if (version >= 2) available -= (25 * a - 10) * a - 55;
  if (version >= 7) available -= 36;
  const total = Math.floor(available / 8);
  const correctionPerBlock = ECC_WORDS[LEVELS[level].index][version];
  const blockCount = BLOCK_COUNTS[LEVELS[level].index][version];
  const data = total - correctionPerBlock * blockCount;
  return { available, total, remainder: available % 8, correctionPerBlock, blockCount, data, bits: data * 8 };
}

export function multiply(a, b) {
  let result = 0;
  while (b) {
    if (b & 1) result ^= a;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
    b >>>= 1;
  }
  return result;
}

export function generator(degree) {
  integer(degree, 1, 255, 'Generator degree');
  let coefficients = [1];
  let root = 1;
  for (let i = 0; i < degree; i++) {
    const next = Array(coefficients.length + 1).fill(0);
    for (let j = 0; j < coefficients.length; j++) {
      next[j] ^= coefficients[j];
      next[j + 1] ^= multiply(coefficients[j], root);
    }
    coefficients = next;
    root = multiply(root, 2);
  }
  return coefficients;
}

export function remainder(data, divisor) {
  const degree = divisor.length - 1;
  const result = Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= multiply(factor, divisor[i + 1]);
  }
  return result;
}

export function alignmentPositions(version) {
  integer(version, 1, 40, 'Version');
  if (version === 1) return [];
  const a = Math.floor(version / 7) + 2;
  const step = 2 * Math.floor((8 * version + 3 * a + 5) / (4 * a - 4));
  return [6, ...Array.from({ length: a - 1 }, (_, j) => 4 * version + 10 - j * step).reverse()];
}

function bch(value, degree, polynomial) {
  let result = value << degree;
  for (let bit = 31 - Math.clz32(result); bit >= degree; bit--) {
    if ((result >>> bit) & 1) result ^= polynomial << (bit - degree);
  }
  return (value << degree) | result;
}

export function formatWord(level, mask) {
  if (!Object.hasOwn(LEVELS, level)) throw new RangeError('Invalid correction level.');
  integer(mask, 0, 7, 'Mask');
  return bch((LEVELS[level].bits << 3) | mask, 10, 0x537) ^ 0x5412;
}

export function versionWord(version) {
  integer(version, 7, 40, 'Version');
  return bch(version, 12, 0x1f25);
}

function writeFormat(set, size, word) {
  for (let i = 0; i < 15; i++) {
    const bit = (word >>> i) & 1;
    if (i < 6) set(8, i, bit, 5);
    else if (i === 6) set(8, 7, bit, 5);
    else if (i === 7) set(8, 8, bit, 5);
    else if (i === 8) set(7, 8, bit, 5);
    else set(14 - i, 8, bit, 5);
    if (i < 8) set(size - 1 - i, 8, bit, 5);
    else set(8, size - 15 + i, bit, 5);
  }
}

function functionPatterns(version) {
  const size = 4 * version + 17;
  const matrix = Array.from({ length: size }, () => new Uint8Array(size));
  const functions = matrix.map(row => row.slice());
  const set = (x, y, value, type) => { matrix[y][x] = Number(value); functions[y][x] = type; };
  for (let p = 8; p <= size - 9; p++) {
    set(p, 6, p % 2 === 0, 3);
    set(6, p, p % 2 === 0, 3);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && y >= 0 && x < size && y < size) set(x, y, d !== 2 && d !== 4, d === 4 ? 2 : 1);
    }
  }
  const positions = alignmentPositions(version);
  for (const cy of positions) for (const cx of positions) {
    if ((cx === 6 && (cy === 6 || cy === size - 7)) || (cx === size - 7 && cy === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1, 4);
    }
  }
  writeFormat(set, size, 0);
  set(8, size - 8, 1, 7);
  if (version >= 7) {
    const word = versionWord(version);
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + i % 3, b = Math.floor(i / 3), bit = (word >>> i) & 1;
      set(a, b, bit, 6);
      set(b, a, bit, 6);
    }
  }
  return { matrix, functions };
}

// Run-based N3 with virtual light borders, including scaled 1:1:3:1:1 patterns.
export function score(matrix) {
  const n = matrix.length;
  let n1 = 0, n2 = 0, n3 = 0, dark = 0;
  for (let axis = 0; axis < 2; axis++) for (let index = 0; index < n; index++) {
    const runs = [{ color: 0, length: n }];
    let previous = -1, length = 0;
    for (let p = 0; p < n; p++) {
      const color = axis ? matrix[p][index] : matrix[index][p];
      if (color === previous) length++;
      else {
        if (length >= 5) n1 += length - 2;
        previous = color;
        length = 1;
      }
      if (runs.at(-1).color === color) runs.at(-1).length++;
      else runs.push({ color, length: 1 });
    }
    if (length >= 5) n1 += length - 2;
    if (runs.at(-1).color === 0) runs.at(-1).length += n;
    else runs.push({ color: 0, length: n });
    for (let i = 1; i + 5 < runs.length; i += 2) {
      const u = runs[i].length;
      if (runs[i + 1].length !== u || runs[i + 2].length !== 3 * u || runs[i + 3].length !== u || runs[i + 4].length !== u) continue;
      const left = runs[i - 1].length, right = runs[i + 5].length;
      if (left >= 4 * u && right >= u) n3 += 40;
      if (right >= 4 * u && left >= u) n3 += 40;
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const value = matrix[y][x];
    dark += value;
    if (y + 1 < n && x + 1 < n && matrix[y][x + 1] === value && matrix[y + 1][x] === value && matrix[y + 1][x + 1] === value) n2 += 3;
  }
  const n4 = 10 * Math.max(0, Math.ceil(Math.abs(20 * dark - 10 * n * n) / (n * n)) - 1);
  return { n1, n2, n3, n4, total: n1 + n2 + n3 + n4 };
}

export function encodeText(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError('The message must be text.');
  if (text.length > 10000) throw new RangeError('This message is too long for one QR code.');
  // Reject isolated UTF-16 surrogates rather than silently replacing the payload.
  for (const char of text) {
    const point = char.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) throw new RangeError('The message contains an incomplete Unicode character.');
  }
  let mode = options.mode ?? 'byte';
  if (mode === 'auto') mode = /^\d+$/.test(text) ? 'numeric' : text.length && [...text].every(c => ALPHABET.includes(c)) ? 'alphanumeric' : 'byte';
  if (!Object.hasOwn(MODES, mode)) throw new RangeError('Choose byte, numeric, alphanumeric, or automatic mode.');
  if (mode === 'numeric' && !/^\d*$/.test(text)) throw new RangeError('Numeric mode accepts only digits 0–9.');
  if (mode === 'alphanumeric' && ![...text].every(c => ALPHABET.includes(c))) throw new RangeError('Alphanumeric mode accepts uppercase A–Z, digits, spaces, and $ % * + - . / :');
  const bytes = new TextEncoder().encode(text);
  return encode({ text, bytes, mode, eci: mode === 'byte' && bytes.some(b => b > 127) }, options);
}

export function encodeBytes(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Pass a Uint8Array of raw bytes.');
  if (bytes.length > 2953) throw new RangeError('This byte sequence is too long for one QR code.');
  return encode({ text: '', bytes, mode: 'byte', eci: false }, options);
}

function encode(payload, options) {
  const { text, bytes, mode, eci } = payload;
  const level = options.level ?? 'M';
  if (!Object.hasOwn(LEVELS, level)) throw new RangeError('Choose correction level L, M, Q, or H.');
  const requestedVersion = options.version ?? 'auto';
  const requestedMask = options.mask ?? 'auto';
  if (requestedVersion !== 'auto') integer(requestedVersion, 1, 40, 'Version');
  if (requestedMask !== 'auto') integer(requestedMask, 0, 7, 'Mask');
  const content = [];
  if (mode === 'byte') for (const byte of bytes) append(content, byte, 8);
  else if (mode === 'numeric') {
    for (let i = 0; i < text.length; i += 3) {
      const group = text.slice(i, i + 3);
      append(content, Number(group), [0, 4, 7, 10][group.length]);
    }
  } else {
    for (let i = 0; i < text.length; i += 2) {
      const first = ALPHABET.indexOf(text[i]);
      append(content, i + 1 < text.length ? first * 45 + ALPHABET.indexOf(text[i + 1]) : first, i + 1 < text.length ? 11 : 6);
    }
  }
  const count = mode === 'byte' ? bytes.length : text.length;
  let version = requestedVersion === 'auto' ? 1 : requestedVersion;
  const max = requestedVersion === 'auto' ? 40 : requestedVersion;
  let cap, countWidth, encodedBits;
  for (; version <= max; version++) {
    cap = capacity(version, level);
    countWidth = MODES[mode].widths[version < 10 ? 0 : version < 27 ? 1 : 2];
    encodedBits = (eci ? 12 : 0) + 4 + countWidth + content.length;
    if (count < 2 ** countWidth && encodedBits <= cap.bits) break;
  }
  if (version > max) {
    throw new RangeError(requestedVersion === 'auto'
      ? 'This message is too long for one QR code at this correction level. Shorten it or choose a lower level.'
      : `The message does not fit version ${requestedVersion} at level ${level}. Choose automatic sizing or a larger version.`);
  }
  const bits = [];
  if (eci) { append(bits, 7, 4); append(bits, 26, 8); }
  append(bits, MODES[mode].indicator, 4);
  append(bits, count, countWidth);
  bits.push(...content);
  const terminatorBits = Math.min(4, cap.bits - bits.length);
  append(bits, 0, terminatorBits);
  const alignmentBits = (8 - bits.length % 8) % 8;
  append(bits, 0, alignmentBits);
  const padWords = (cap.bits - bits.length) / 8;
  for (let i = 0; i < padWords; i++) append(bits, i % 2 ? 0x11 : 0xec, 8);
  const data = Array.from({ length: bits.length / 8 }, (_, i) => bits.slice(i * 8, i * 8 + 8).reduce((a, b) => a * 2 + b, 0));
  const shortLength = Math.floor(cap.total / cap.blockCount) - cap.correctionPerBlock;
  const shortCount = cap.blockCount - cap.total % cap.blockCount;
  const divisor = generator(cap.correctionPerBlock);
  const blocks = [];
  let offset = 0;
  for (let i = 0; i < cap.blockCount; i++) {
    const length = shortLength + Number(i >= shortCount);
    const chunk = data.slice(offset, offset + length);
    blocks.push({ data: chunk, correction: remainder(chunk, divisor) });
    offset += length;
  }
  const interleaved = [];
  for (const key of ['data', 'correction']) {
    const length = Math.max(...blocks.map(b => b[key].length));
    for (let i = 0; i < length; i++) for (const block of blocks) if (i < block[key].length) interleaved.push(block[key][i]);
  }
  const stream = [];
  for (const word of interleaved) append(stream, word, 8);
  append(stream, 0, cap.remainder);
  const { matrix: unmasked, functions } = functionPatterns(version);
  const size = unmasked.length;
  let position = 0, upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let row = 0; row < size; row++) {
      const y = upward ? size - 1 - row : row;
      for (const x of [right, right - 1]) if (!functions[y][x]) unmasked[y][x] = stream[position++];
    }
    upward = !upward;
  }
  if (position !== cap.available || stream.length !== position || interleaved.length !== cap.total || offset !== cap.data) throw new Error('Internal QR capacity mismatch.');
  const candidates = MASKS.map((condition, mask) => {
    const matrix = unmasked.map(row => row.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!functions[y][x] && condition(x, y)) matrix[y][x] ^= 1;
    const format = formatWord(level, mask);
    writeFormat((x, y, value) => { matrix[y][x] = value; }, size, format);
    return { mask, matrix, format, score: score(matrix) };
  });
  const best = candidates.reduce((a, b) => b.score.total < a.score.total ? b : a);
  const selected = requestedMask === 'auto' ? best : candidates[requestedMask];
  return {
    version, size, level, mode, eci, byteCount: bytes.length, count, countWidth,
    encodedBits, terminatorBits, alignmentBits, padWords, capacity: cap,
    data, blocks, interleaved, unmasked, functions, candidates,
    mask: selected.mask, bestMask: best.mask, matrix: selected.matrix,
    format: selected.format, score: selected.score,
  };
}
