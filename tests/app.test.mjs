import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { encodeText } from '../src/qr.js';
import { toSvg, paintCanvas } from '../src/render.js';

function setup(withWorker = false) {
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { url: 'https://example.github.io/qr-studio/', runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  const downloads = [];
  const errors = [];
  let worker;
  Object.assign(window, { TextEncoder, encodeText, toSvg, paintCanvas });
  window.addEventListener('error', e => errors.push(e.error));
  window.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  if (withWorker) {
    window.Worker = class {
      constructor(url, options) { worker = this; assert.match(String(url), /\/qr-studio\/src\/worker.js$/); assert.equal(options.type, 'module'); }
      postMessage(request) { requests.push(request); }
      terminate() { this.terminated = true; }
    };
  }
  const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replaceAll('import.meta.url', '"https://example.github.io/qr-studio/src/app.js"');
  window.eval(source);
  const $ = id => window.document.getElementById(id);
  const change = (id, value) => { $(id).value = value; $(id).dispatchEvent(new window.Event('change', { bubbles: true })); };
  const submit = text => { $('message').value = text; $('settings').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); };
  return { dom, window, $, change, submit, requests, downloads, errors, get worker() { return worker; } };
}

test('DOM integration: generation, examples, settings, validation, inspection, export, and clear', async () => {
  const app = setup();
  try {
    const { $, window, submit, change } = app;
    assert.equal($('preview-status').textContent, 'Ready to scan');
    assert.ok($('qr-preview').querySelector('svg'));
    assert.equal($('download-png').disabled, false);
    assert.equal($('version').options.length, 41);
    assert.equal($('mask').options.length, 9);
    window.document.querySelector('[data-example="hello"]').click();
    assert.equal($('stat-version').textContent, '01');
    assert.equal($('stat-mask').textContent, '4 / auto');
    assert.equal($('dimensions').textContent, '290 × 290 px');
    change('scale', '20');
    assert.equal($('dimensions').textContent, '580 × 580 px');
    $('inspector').open = true;
    $('inspector').dispatchEvent(new window.Event('toggle'));
    assert.equal(window.document.querySelectorAll('.mask-card').length, 8);
    assert.match($('inspect-content').textContent, /35, 115, 35, 153, 236/);
    $('download-svg').click();
    assert.equal(app.downloads[0].type, 'image/svg+xml');
    assert.equal(app.downloads[1], 'qr-v1-M.svg');
    change('mask', '0'); assert.equal($('stat-mask').textContent, '0 / fixed');
    change('mode', 'numeric');
    assert.equal($('error').hidden, false);
    assert.match($('error').textContent, /only digits/);
    assert.equal($('qr-preview').children.length, 0);
    assert.ok($('download-svg').disabled);
    submit('007'); assert.equal($('error').hidden, true);
    assert.match($('result-caption').textContent, /Numeric/);
    change('mode', 'byte'); change('version', '1'); submit('a'.repeat(30));
    assert.match($('error').textContent, /does not fit/);
    change('version', 'auto');
    assert.equal($('preview-status').textContent, 'Ready to scan');
    window.document.querySelector('[data-example="unicode"]').click();
    assert.match($('result-caption').textContent, /UTF-8 \/ ECI 26/);
    submit('<img src=x onerror=alert(1)>');
    assert.equal(window.document.querySelectorAll('img').length, 0);
    assert.equal($('preview-status').textContent, 'Ready to scan');
    $('clear').click();
    assert.equal($('message').value, '');
    assert.equal($('preview-status').textContent, 'Ready when you are');
    assert.ok($('download-png').disabled);
    assert.equal($('qr-preview').children.length, 0);
    // Let the native details toggle event finish before tearing down the DOM.
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(app.errors, []);
    assert.equal(window.localStorage.length, 0);
  } finally { app.dom.window.close(); }
});

test('worker integration: discard stale results and recover from worker startup failure', () => {
  const app = setup(true);
  try {
    const initial = app.requests[0];
    app.submit('HELLO');
    const latest = app.requests[1];
    app.worker.onmessage({ data: { id: latest.id, result: encodeText(latest.text, latest.options) } });
    assert.equal(app.$('stat-version').textContent, '01');
    app.worker.onmessage({ data: { id: initial.id, error: 'stale error' } });
    assert.equal(app.$('error').hidden, true);
    app.submit('你好');
    app.worker.onerror({ preventDefault() {} });
    assert.ok(app.worker.terminated);
    assert.equal(app.$('preview-status').textContent, 'Ready to scan');
    assert.match(app.$('result-caption').textContent, /UTF-8/);
    assert.deepEqual(app.errors, []);
  } finally { app.dom.window.close(); }
});
