// Tests the shared index's Worker end to end on this machine: wrangler dev (the real Workers
// runtime) with a fresh local D1 database, no Cloudflare account involved.
//   cd server && npm install && npm test
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const WRANGLER = path.join(HERE, 'node_modules/.bin/wrangler');
const STATE = path.join(HERE, '.wrangler/test-state');
const ADMIN = 'test-admin-token';
const GAME = 'http://localhost:8077';

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
};

const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });

// A fresh database and a Worker with these settings.
async function startWorker(vars) {
  rmSync(STATE, { recursive: true, force: true });
  mkdirSync(STATE, { recursive: true });
  execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'clearance-index', '--local', '--persist-to', STATE], { cwd: HERE, stdio: 'pipe' });
  const port = await freePort();
  const args = ['dev', '--port', String(port), '--persist-to', STATE, '--show-interactive-dev-session=false', '--var', `ADMIN_TOKEN:${ADMIN}`];
  for (const [k, v] of Object.entries(vars)) args.push('--var', `${k}:${v}`);
  const proc = spawn(WRANGLER, args, { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  const url = `http://localhost:${port}`;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url + '/')).ok) return { url, stop: () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch {} } }; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
  throw new Error('wrangler dev did not start:\n' + log.slice(-2000));
}

const bits = (fill = 0) => Buffer.alloc(150, fill).toString('base64');
const post = (url, body, headers = {}) => fetch(url + '/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: GAME, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const ip = (n) => ({ 'CF-Connecting-IP': `10.0.0.${n}` }); // wrangler dev passes this header through; Cloudflare sets it in production
const admin = { Authorization: `Bearer ${ADMIN}` };

console.log('index worker (wrangler dev, local D1)');
let w = await startWorker({ UPLOADS_PER_HOUR: '4', UPLOADS_PER_DAY: '1000', HOLD_NEW: '0' });
try {
  let first;
  await test('a print and its label are filed; the sender gets a key back', async () => {
    const r = await post(w.url, { label: 'sadness', bits: bits(0x0f) }, ip(1));
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('access-control-allow-origin'), GAME);
    first = await r.json();
    assert.ok(first.id >= 1 && /^[0-9a-f]{32}$/.test(first.key) && /^\d{4}-\d\d-\d\d$/.test(first.day));
    assert.equal(first.status, 'live');
  });
  await test('the index lists it with its count, newest first', async () => {
    await post(w.url, { label: 'sadness', bits: bits(0xf0) }, ip(1));
    await post(w.url, { label: 'notbelong', bits: bits(0xff) }, ip(1));
    const j = await (await fetch(w.url + '/api/index?per=1')).json();
    assert.equal(j.labels.length, 10);
    const sad = j.labels.find((l) => l.label === 'sadness');
    assert.equal(sad.n, 2); assert.equal(sad.entries.length, 1, 'per=1');
    assert.equal(sad.entries[0].bits, bits(0xf0), 'newest first');
    assert.deepEqual(Object.keys(sad.entries[0]).sort(), ['bits', 'day', 'id', 'label'], 'nothing but the print, its label, its day and its number');
    assert.equal(j.labels.find((l) => l.label === 'notbelong').n, 1);
    assert.equal(j.total, 3);
  });
  await test('older prints page by id', async () => {
    const j = await (await fetch(w.url + '/api/entries?label=sadness&limit=1')).json();
    assert.equal(j.entries.length, 1); assert.equal(j.more, true);
    const k = await (await fetch(`${w.url}/api/entries?label=sadness&limit=5&before=${j.entries[0].id}`)).json();
    assert.equal(k.entries.length, 1); assert.equal(k.more, false); assert.equal(k.entries[0].id, first.id);
  });
  await test('anything but {label, bits} is refused', async () => {
    const cases = [
      [{ label: 'sadness', bits: bits(), emb: [0.1] }, /unexpected field: emb/],
      [{ label: 'sadness', bits: bits(), lat: 40.7 }, /unexpected field/],
      [{ label: 'happy', bits: bits() }, /unknown label/],
      [{ label: 'sadness', bits: Buffer.alloc(151).toString('base64') }, /150 bytes/],
      [{ label: 'sadness', bits: Buffer.alloc(600).toString('base64') }, /150 bytes/],
      [{ label: 'sadness' }, /150 bytes/],
      ['not json', /not JSON/],
      [[1, 2], /not an object/],
    ];
    for (const [body, why] of cases) {
      const r = await post(w.url, body, ip(2));
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
      assert.match((await r.json()).error, why);
    }
    const big = await post(w.url, JSON.stringify({ label: 'sadness', bits: 'A'.repeat(4000) }), ip(2));
    assert.equal(big.status, 413);
  });
  await test('only the game\'s own pages may upload or delete', async () => {
    const r = await post(w.url, { label: 'sadness', bits: bits() }, { ...ip(3), Origin: 'https://example.com' });
    assert.equal(r.status, 403);
    const pre = await fetch(w.url + '/api/entries', { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 403);
    const ok = await fetch(w.url + '/api/entries', { method: 'OPTIONS', headers: { Origin: GAME, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
    assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), GAME);
    assert.match(ok.headers.get('access-control-allow-headers'), /X-Delete-Key/);
    const tunnel = await fetch(w.url + '/api/entries', { method: 'OPTIONS', headers: { Origin: 'https://some-words-here.trycloudflare.com', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(tunnel.status, 204, 'the phone test tunnel');
    const pub = await fetch(w.url + '/api/index', { headers: { Origin: 'https://example.com' } });
    assert.equal(pub.headers.get('access-control-allow-origin'), '*', 'anyone may read');
  });
  await test('uploads from one address are limited per hour', async () => {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await post(w.url, { label: 'alone', bits: bits(i) }, ip(9))).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 429, 429]);
    assert.equal((await post(w.url, { label: 'alone', bits: bits() }, ip(10))).status, 201, 'another address still can');
  });
  await test('the sender withdraws with their key, and only with it', async () => {
    const wrong = await fetch(`${w.url}/api/entries/${first.id}`, { method: 'DELETE', headers: { Origin: GAME, 'X-Delete-Key': '0'.repeat(32) } });
    assert.equal(wrong.status, 404);
    const none = await fetch(`${w.url}/api/entries/${first.id}`, { method: 'DELETE', headers: { Origin: GAME } });
    assert.equal(none.status, 403);
    const ok = await fetch(`${w.url}/api/entries/${first.id}`, { method: 'DELETE', headers: { Origin: GAME, 'X-Delete-Key': first.key } });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), GAME);
    const j = await (await fetch(w.url + '/api/index?per=10')).json();
    assert.ok(!j.labels.find((l) => l.label === 'sadness').entries.some((e) => e.id === first.id));
  });
  await test('the admin token deletes anything; a wrong token does nothing', async () => {
    const j = await (await fetch(w.url + '/api/index?per=10')).json();
    const id = j.labels.find((l) => l.label === 'notbelong').entries[0].id;
    assert.equal((await fetch(`${w.url}/api/entries/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(`${w.url}/api/admin/entries`, { headers: { Authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(`${w.url}/api/entries/${id}`, { method: 'DELETE', headers: admin })).status, 200);
    assert.equal((await fetch(`${w.url}/api/entries/${id}`, { method: 'DELETE', headers: admin })).status, 404, 'already gone');
    const list = await (await fetch(`${w.url}/api/admin/entries?status=all`, { headers: admin })).json();
    assert.ok(list.entries.length >= 5 && list.entries.every((e) => e.status === 'live'));
  });
  await test('responses never carry the delete key or the key hash', async () => {
    const all = await (await fetch(`${w.url}/api/admin/entries?status=all&limit=500`, { headers: admin })).text();
    assert.ok(!/key/.test(all));
    const pub = await (await fetch(`${w.url}/api/index?per=200`)).text();
    assert.ok(!/key/.test(pub));
  });
} finally { w.stop(); }

console.log('index worker, held for approval and closed for the day');
w = await startWorker({ UPLOADS_PER_HOUR: '100', UPLOADS_PER_DAY: '3', HOLD_NEW: '1' });
try {
  await test('with HOLD_NEW on, prints wait for approval', async () => {
    const r = await (await post(w.url, { label: 'suspicious', bits: bits(1) }, ip(1))).json();
    assert.equal(r.status, 'held');
    let j = await (await fetch(w.url + '/api/index?per=5')).json();
    assert.equal(j.total, 0, 'not shown while held');
    const held = await (await fetch(`${w.url}/api/admin/entries?status=held`, { headers: admin })).json();
    assert.deepEqual(held.entries.map((e) => e.id), [r.id]);
    assert.equal((await fetch(`${w.url}/api/entries/${r.id}/approve`, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 403);
    assert.equal((await fetch(`${w.url}/api/entries/${r.id}/approve`, { method: 'POST', headers: admin })).status, 200);
    j = await (await fetch(w.url + '/api/index?per=5')).json();
    assert.equal(j.labels.find((l) => l.label === 'suspicious').entries[0].id, r.id);
  });
  await test('the whole index closes after its daily cap', async () => {
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await post(w.url, { label: 'waiting', bits: bits() }, ip(20 + i))).status);
    assert.deepEqual(codes, [201, 201, 503]);
  });
} finally { w.stop(); }
rmSync(STATE, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
