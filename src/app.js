import { encodeText } from './qr.js';
import { toSvg, paintCanvas } from './render.js';

const $ = id => document.getElementById(id);
const form = $('settings');
let result = null;
let generation = 0;
let timer;
let worker;
let pending;
let inspectorDirty = false;

for (let version = 1; version <= 40; version++) $('version').add(new Option(`Version ${version} · ${4 * version + 17} × ${4 * version + 17}`, version));
for (let mask = 0; mask < 8; mask++) $('mask').add(new Option(`Mask ${mask}`, mask));

try {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => accept(data);
  worker.onerror = event => {
    event.preventDefault();
    worker.terminate();
    worker = null;
    if (pending) runLocally(pending);
  };
} catch { worker = null; }

function getOptions() {
  return {
    level: form.elements.level.value,
    mode: $('mode').value,
    version: $('version').value === 'auto' ? 'auto' : Number($('version').value),
    mask: $('mask').value === 'auto' ? 'auto' : Number($('mask').value),
  };
}

function resetPreview(message, status) {
  result = null;
  $('qr-preview').replaceChildren();
  $('preview-placeholder').hidden = false;
  $('preview-placeholder').textContent = message;
  $('preview-status').textContent = status;
  $('download-png').disabled = $('download-svg').disabled = true;
  $('preview-stage').setAttribute('aria-busy', String(status === 'Updating…'));
  for (const id of ['stat-version', 'stat-grid', 'stat-mask', 'dimensions', 'protect-detail', 'place-detail', 'mask-detail']) $(id).textContent = '—';
  $('encode-detail').textContent = 'Waiting for a message';
  $('result-caption').textContent = 'A clear margin is included for reliable scanning.';
  $('inspect-content').replaceChildren(Object.assign(document.createElement('p'), { className: 'field-help', textContent: 'Enter a valid message to inspect its encoding.' }));
}

function schedule(immediate = false) {
  clearTimeout(timer);
  const id = ++generation;
  pending = null;
  const text = $('message').value;
  const count = new TextEncoder().encode(text).length;
  $('byte-count').textContent = `${count.toLocaleString()} ${count === 1 ? 'byte' : 'bytes'}`;
  $('error').hidden = true;
  $('message').removeAttribute('aria-invalid');
  resetPreview(text.length ? 'Creating your code…' : 'Your next connection starts with a message.', text.length ? 'Updating…' : 'Ready when you are');
  if (!text.length) { $('announcement').textContent = 'Enter a message to generate a QR code.'; return; }
  const request = { id, text, options: getOptions() };
  const generate = () => {
    pending = request;
    if (worker) worker.postMessage(request);
    else runLocally(request);
  };
  if (immediate) generate();
  else timer = setTimeout(generate, 180);
}

function runLocally(request) {
  try { accept({ id: request.id, result: encodeText(request.text, request.options) }); }
  catch (error) { accept({ id: request.id, error: error.message }); }
}

function accept(response) {
  if (response.id !== generation) return;
  pending = null;
  $('preview-stage').setAttribute('aria-busy', 'false');
  if (response.error) {
    resetPreview('Adjust your message or settings to continue.', 'Needs attention');
    $('message').setAttribute('aria-invalid', 'true');
    $('error').hidden = false;
    $('error').textContent = response.error;
    return;
  }
  result = response.result;
  $('preview-placeholder').hidden = true;
  // Generated SVG contains only numeric matrix coordinates and fixed markup.
  $('qr-preview').innerHTML = toSvg(result.matrix);
  $('qr-preview').setAttribute('aria-label', `QR code, version ${result.version}, correction level ${result.level}, mask ${result.mask}`);
  $('preview-status').textContent = 'Ready to scan';
  $('stat-version').textContent = String(result.version).padStart(2, '0');
  $('stat-grid').textContent = `${result.size} × ${result.size}`;
  $('stat-mask').textContent = `${result.mask}${$('mask').value === 'auto' ? ' / auto' : ' / fixed'}`;
  $('result-caption').textContent = `${result.mode[0].toUpperCase() + result.mode.slice(1)} mode · Level ${result.level}${result.eci ? ' · UTF-8 / ECI 26' : ''}`;
  $('encode-detail').textContent = `${result.encodedBits} bits → ${result.capacity.data} data words`;
  $('protect-detail').textContent = `${result.capacity.blockCount} ${result.capacity.blockCount === 1 ? 'block' : 'blocks'} · ${result.capacity.blockCount * result.capacity.correctionPerBlock} correction words`;
  $('place-detail').textContent = `${result.capacity.available.toLocaleString()} encoding cells`;
  $('mask-detail').textContent = `Mask ${result.mask} · ${result.score.total.toLocaleString()} penalty points`;
  $('download-png').disabled = $('download-svg').disabled = false;
  updateDimensions();
  inspectorDirty = true;
  if ($('inspector').open) inspect();
  $('announcement').textContent = `QR code ready. Version ${result.version}, ${result.size} by ${result.size} modules, correction level ${result.level}.`;
}

function updateDimensions() {
  if (!result) return;
  const side = (result.size + 8) * Number($('scale').value);
  $('dimensions').textContent = `${side} × ${side} px`;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function table(headers, rows) {
  const wrapper = element('div', undefined, 'scroll-table');
  const node = element('table');
  const thead = node.createTHead().insertRow();
  headers.forEach(header => { const th = element('th', header); th.scope = 'col'; thead.append(th); });
  const body = node.createTBody();
  for (const { values, selected } of rows) {
    const row = body.insertRow();
    if (selected) row.className = 'chosen';
    values.forEach(value => row.append(element('td', String(value))));
  }
  wrapper.append(node);
  return wrapper;
}

function inspect() {
  if (!result || !inspectorDirty) return;
  inspectorDirty = false;
  const q = result;
  const content = $('inspect-content');
  content.replaceChildren();
  const metrics = element('dl', undefined, 'inspect-metrics');
  for (const [name, value] of [
    ['ENCODED', `${q.encodedBits} / ${q.capacity.bits} bits`], ['TERMINATOR', `${q.terminatorBits} zero bits`],
    ['BYTE ALIGNMENT', `${q.alignmentBits} zero bits`], ['PAD WORDS', q.padWords],
    ['REMAINDER', `${q.capacity.remainder} bits`], ['FORMAT WORD', q.format.toString(2).padStart(15, '0')],
  ]) {
    const group = element('div'); group.append(element('dt', name), element('dd', String(value))); metrics.append(group);
  }
  content.append(metrics, element('h3', 'Data codewords (decimal)'), element('pre', q.data.join(', '), 'codewords'));
  content.append(element('h3', 'Reed–Solomon blocks'));
  content.append(table(['Block', 'Data words', 'Correction words', 'Correction bytes (decimal)'], q.blocks.map((block, i) => ({ values: [i, block.data.length, block.correction.length, block.correction.join(', ')] }))));
  content.append(element('h3', 'Interleaved codewords (decimal)'), element('pre', q.interleaved.join(', '), 'codewords'));
  content.append(element('h3', 'Eight masks. One message.'));
  content.append(element('p', `Mask ${q.bestMask} has the lowest total penalty. ${q.mask === q.bestMask ? 'It is selected below.' : `Mask ${q.mask} is selected manually.`} Scores include the entire symbol and its metadata, excluding the quiet zone. Ties use the smaller mask number.`, 'inline-note'));
  const gallery = element('div', undefined, 'mask-gallery');
  for (const candidate of q.candidates) {
    const card = element('div', undefined, `mask-card${candidate.mask === q.mask ? ' selected' : ''}`);
    card.innerHTML = toSvg(candidate.matrix, { scale: 2 });
    card.append(element('p', `Mask ${candidate.mask}${candidate.mask === q.mask ? ' · selected' : ''}\n${candidate.score.total} points`));
    gallery.append(card);
  }
  content.append(gallery, table(['Mask', 'N1 · runs', 'N2 · squares', 'N3 · finder-like', 'N4 · balance', 'Total'], q.candidates.map(c => ({ selected: c.mask === q.mask, values: [c.mask === q.mask ? `${c.mask} · selected` : c.mask, c.score.n1, c.score.n2, c.score.n3, c.score.n4, c.score.total] }))));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = element('a');
  anchor.href = url; anchor.download = name;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('download-svg').addEventListener('click', () => {
  if (!result) return;
  download(new Blob([toSvg(result.matrix, { scale: Number($('scale').value) })], { type: 'image/svg+xml' }), `qr-v${result.version}-${result.level}.svg`);
});
$('download-png').addEventListener('click', () => {
  if (!result) return;
  const snapshot = result;
  try {
    const canvas = paintCanvas(document.createElement('canvas'), snapshot.matrix, { scale: Number($('scale').value) });
    canvas.toBlob(blob => {
      if (blob) download(blob, `qr-v${snapshot.version}-${snapshot.level}.png`);
      else { $('error').textContent = 'PNG export failed. Try SVG instead.'; $('error').hidden = false; }
    }, 'image/png');
  } catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
});

form.addEventListener('submit', event => { event.preventDefault(); schedule(true); });
$('message').addEventListener('input', () => schedule());
form.addEventListener('change', event => { if (event.target !== $('message')) schedule(true); });
$('scale').addEventListener('change', updateDimensions);
$('clear').addEventListener('click', () => { $('message').value = ''; $('message').focus(); schedule(true); });
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  $('message').value = { link: 'https://example.com', hello: 'HELLO', unicode: '你好, world 👋' }[button.dataset.example];
  if (button.dataset.example === 'hello') {
    form.elements.level.value = 'M'; $('version').value = 'auto'; $('mask').value = 'auto';
  }
  $('mode').value = 'byte';
  schedule(true);
}));
$('inspector').addEventListener('toggle', () => { if ($('inspector').open) inspect(); });
schedule(true);
