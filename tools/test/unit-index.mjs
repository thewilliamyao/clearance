// The shared index, without a browser or a server: what a unit sends (only the 40x30 two-tone
// print and its label), the queue, withdrawing, and the server's own rules.
import assert from 'node:assert/strict';
import { Developer } from '../../src/engine/develop.js';
import { TONES } from '../../src/game/tiers.js';
import { THEMES, themeColors } from '../../src/engine/palette.js';
import { LEARNED_LABEL } from '../../src/game/requests.js';
import { SharedIndex, packBits, unpackBits, toB64, fromB64, heading, dayText, indexBase, INDEX_LABELS, PRINT_BYTES } from '../../src/game/shared-index.js';
import { LABELS, parseSubmission, originAllowed } from '../../server/src/rules.js';

// A 640x480 test frame: a gradient with a dark disc, like a head against a window.
function frame() {
  const w = 640, h = 480, a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4, d = Math.hypot(x - 300, y - 220) < 120;
    const v = d ? 40 : 90 + (x / w) * 150;
    a[p] = v; a[p + 1] = v * 0.95; a[p + 2] = v * 0.9; a[p + 3] = 255;
  }
  return a;
}

// A stand-in for the Game (save + persist) and a fake index answering like server/src/worker.js.
function rig({ share = true, answer } = {}) {
  const calls = [];
  const g = { save: { settings: { share }, outbox: [], shared: [] }, saved: 0, persist() { this.saved++; } };
  let next = 1;
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body });
    const a = answer && answer(url, opts);
    if (a instanceof Error) throw a;
    if (a) return a;
    const json = (status, j) => ({ ok: status < 300, status, json: async () => j });
    if (opts.method === 'POST') return json(201, { id: next++, key: 'ab'.repeat(16), day: '2026-11-21', status: 'live' });
    if (opts.method === 'DELETE') return json(200, { deleted: 1 });
    return json(200, { total: 1, labels: [{ label: 'sadness', n: 1, entries: [{ id: 7, label: 'sadness', day: '2026-11-21', bits: toB64(new Uint8Array(PRINT_BYTES).fill(0x0f)) }] }, { label: 'mystery', n: 2, entries: [] }] });
  };
  return { g, calls, ix: new SharedIndex(g, { base: 'https://index.test', fetchFn }) };
}
const px = () => { const p = new Uint8Array(1200); for (let i = 0; i < p.length; i++) p[i] = (i * 7) % 3 === 0 ? 1 : 0; return p; };

export async function run(test) {
  console.log('shared index');
  await test('the index print is the game\'s lowest grade (SENSOR I, TONE I), bit for bit', () => {
    const dev = new Developer(), f = frame();
    const bits = dev.bits(f, 640, 480);
    assert.equal(bits.length, 40 * 30);
    const P = themeColors(THEMES[0]);
    const print = dev.process(f, 640, 480, 40, 30, TONES[0], THEMES[0], false);
    for (let i = 0; i < bits.length; i++) assert.equal(bits[i], print[i] === P.paper ? 1 : 0, `pixel ${i}`);
    assert.ok(bits.some((b) => b) && bits.some((b) => !b), 'two tones');
  });
  await test('150 bytes pack and unpack; base64 is 200 characters', () => {
    const p = px(), packed = packBits(p);
    assert.equal(packed.length, 150);
    assert.deepEqual(unpackBits(packed), p);
    const b64 = toB64(packed);
    assert.equal(b64.length, 200);
    assert.deepEqual(fromB64(b64), packed);
    assert.equal(packBits(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1]))[0], 0x81, 'high bit first');
  });
  await test('the game and the server agree on the labels', () => {
    assert.deepEqual(INDEX_LABELS, LABELS);
    assert.deepEqual(Object.keys(LEARNED_LABEL), LABELS);
    assert.equal(heading('sadness'), 'WHAT RECORDERS CALL SAD');
    assert.equal(heading('notbelong'), 'WHO RECORDERS SAY DOES NOT BELONG');
    assert.equal(dayText('2026-11-21'), '21 NOV 2026');
    assert.equal(indexBase('?index=http://localhost:8787/'), 'http://localhost:8787');
  });
  await test('sharing is off until the Recorder turns it on', async () => {
    const { ix, calls, g } = rig({ share: false });
    assert.equal(ix.file(4, 'sadness', px()), false);
    await ix.flush();
    assert.equal(calls.length, 0); assert.equal(g.save.outbox.length, 0);
    const none = new SharedIndex({ save: { settings: { share: true } }, persist() {} }, { base: '' });
    assert.equal(none.on, false, 'no index configured: nothing is sent');
  });
  await test('a filing sends exactly the print and its label, then keeps the key', async () => {
    const { ix, calls, g } = rig();
    assert.equal(ix.file(4, 'notbelong', px()), true);
    await ix.flush();
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.method, 'POST'); assert.equal(c.url, 'https://index.test/api/entries');
    const body = JSON.parse(c.body);
    assert.deepEqual(Object.keys(body).sort(), ['bits', 'label'], 'nothing but the label and the print');
    assert.equal(body.label, 'notbelong');
    assert.deepEqual(unpackBits(fromB64(body.bits)), px());
    assert.ok(!parseSubmission(c.body).error, 'the server takes it');
    assert.deepEqual(Object.keys(c.headers), ['Content-Type'], 'no identifying headers');
    assert.equal(g.save.outbox.length, 0);
    assert.equal(g.save.shared.length, 1);
    assert.equal(g.save.shared[0].key, 'ab'.repeat(16));
    assert.equal(ix.statusOf(4).state, 'shared');
    assert.equal(ix.mine(1).photo, 4);
  });
  await test('only shift 5 labels and whole prints are sent', () => {
    const { ix } = rig();
    assert.equal(ix.file(1, 'red', px()), false);
    assert.equal(ix.file(1, 'sadness', new Uint8Array(10)), false);
    assert.equal(ix.file(1, 'sadness', null), false);
  });
  await test('no connection, 429 or 5xx keep the print queued; other refusals drop it', async () => {
    let mode = 'offline';
    const { ix, g } = rig({ answer: (u, o) => (o.method !== 'POST' ? null : mode === 'offline' ? new Error('offline') : mode === 'busy' ? { ok: false, status: 429, json: async () => ({}) } : mode === 'bad' ? { ok: false, status: 400, json: async () => ({}) } : null) });
    ix.file(5, 'waiting', px());
    await ix.flush();
    assert.equal(g.save.outbox.length, 1); assert.equal(ix.statusOf(5).state, 'queued');
    mode = 'busy'; await ix.flush();
    assert.equal(g.save.outbox.length, 1);
    mode = 'bad'; await ix.flush();
    assert.equal(g.save.outbox.length, 0, 'refused for good'); assert.equal(g.save.shared.length, 0);
    mode = 'ok'; ix.file(6, 'waiting', px()); await ix.flush();
    assert.equal(g.save.shared.length, 1);
  });
  await test('turning sharing off drops what hasn\'t gone', async () => {
    const { ix, g, calls } = rig({ answer: () => new Error('offline') });
    ix.file(5, 'tired', px());
    await ix.flush();
    g.save.settings.share = false; ix.stop();
    assert.equal(g.save.outbox.length, 0);
    g.save.settings.share = true; await ix.flush();
    assert.equal(calls.length, 1, 'nothing more was sent');
  });
  await test('withdrawing sends the key and forgets the print', async () => {
    const { ix, g, calls } = rig();
    ix.file(4, 'sadness', px()); await ix.flush();
    await ix.load();
    const entry = g.save.shared[0];
    assert.equal(await ix.withdraw(entry), true);
    const del = calls.find((c) => c.method === 'DELETE');
    assert.equal(del.url, `https://index.test/api/entries/${entry.id}`);
    assert.equal(del.headers['X-Delete-Key'], entry.key);
    assert.equal(g.save.shared.length, 0); assert.equal(ix.statusOf(4), null);
  });
  await test('the index loads, decodes prints and skips labels the game doesn\'t know', async () => {
    const { ix } = rig();
    const d = await ix.load();
    assert.deepEqual(d.labels.map((l) => l.label), ['sadness']);
    assert.equal(d.labels[0].entries[0].px.length, 1200);
    assert.equal(d.labels[0].entries[0].px[4], 1); // 0x0f: four ink, four paper
    assert.equal(d.labels[0].entries[0].px[3], 0);
  });
  await test('server rules: only {label, bits}, only the game\'s pages', () => {
    const ok = JSON.stringify({ label: 'hiding', bits: toB64(packBits(px())) });
    assert.deepEqual(parseSubmission(ok), { label: 'hiding', bits: toB64(packBits(px())) });
    assert.match(parseSubmission(JSON.stringify({ label: 'hiding', bits: toB64(packBits(px())), emb: [] })).error, /unexpected field/);
    assert.match(parseSubmission(JSON.stringify({ label: 'hiding', bits: toB64(new Uint8Array(160)) })).error, /150 bytes/);
    assert.equal(parseSubmission('x'.repeat(2000)).status, 413);
    const env = { ALLOWED_ORIGINS: 'https://thewilliamyao.github.io,http://localhost:8077', ALLOW_TUNNELS: '1' };
    assert.ok(originAllowed('https://thewilliamyao.github.io', env));
    assert.ok(originAllowed('https://a-b-c.trycloudflare.com', env));
    assert.ok(!originAllowed('https://a-b-c.trycloudflare.com', { ...env, ALLOW_TUNNELS: '0' }));
    assert.ok(!originAllowed('https://thewilliamyao.github.io.evil.com', env));
    assert.ok(!originAllowed('null', env));
  });
}
