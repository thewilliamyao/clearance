// The shared index end to end, against a real Worker: the game files on shift 5 with sharing
// on, the print reaches the index, the page shows it, the Recorder withdraws one from the
// archive and the admin deletes the other from the page. It leaves the index as it found it.
//
//   With python3 serve.py running, and either the local Worker
//     cd server && npm run dev          (http://localhost:8787, admin key dev-admin)
//     cd tools && node test/index-e2e.mjs
//   or the deployed one
//     INDEX=https://clearance-index.<subdomain>.workers.dev INDEX_ADMIN=<key> node test/index-e2e.mjs
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const INDEX = (process.env.INDEX || 'http://localhost:8787').replace(/\/+$/, '');
const ADMIN = process.env.INDEX_ADMIN || (INDEX.includes('localhost') ? 'dev-admin' : '');
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/index-e2e/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const FACE = path.join(REPO, 'portfolio/content/about/william-yao-2017-headshot.jpg');

const errors = [];
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) errors.push(what); };
const api = async (p, opts) => { const r = await fetch(INDEX + p, opts); return r.json(); };
const ids = async () => (await api('/api/index?per=200')).labels.flatMap((l) => l.entries.map((e) => ({ ...e, label: l.label })));

console.log(`index e2e: game ${BASE}, index ${INDEX}`);
const before = (await api('/api/index?per=0')).total;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(decodeURIComponent(route.request().url().split('/__fixture/')[1])), contentType: 'image/jpeg' }));
const sent = [];
page.on('request', (r) => { if (r.method() === 'POST' && r.url() === `${INDEX}/api/entries`) sent.push(r.postData()); });
const ev = (f, a) => page.evaluate(f, a);
const press = async (b, wait = 350) => { await ev((x) => window.__clearance.press(x), b); await page.waitForTimeout(wait); };

try {
  await page.goto(`${BASE}?image=${encodeURIComponent('/__fixture/' + encodeURIComponent(FACE))}&index=${encodeURIComponent(INDEX)}`);
  await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('clearance'); });
  await page.reload();
  await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
  // Sharing on (the Settings row and its question are covered by playthrough.mjs), shift 5.
  await ev(async () => {
    const g = window.__clearance.game;
    g.save.settings.share = true; g.jumpTo(5); g.save.phase = 'field'; g.go('field');
    await Promise.all(g.enabledModules().map((m) => g.modules.ensure(m)));
  });
  // File two requests: each photo asks ARE YOU SURE ...?, OK answers YES (filed), OK again leaves.
  const filed = [];
  for (let n = 0; n < 2; n++) {
    const key = await ev(() => { const g = window.__clearance.game, i = g.order.requests.findIndex((r) => !r.done && r.key !== 'hiding'); g.screens.field.focus = i; return g.order.requests[i].key; });
    await press('SHUTTER', 4500); await press('OK', 1200); await press('OK', 600);
    await ev(() => { const g = window.__clearance.game; g.screens.field.bubble = null; });
    filed.push(key);
  }
  await page.waitForFunction((n) => window.__clearance.game.save.shared.length >= n, filed.length, { timeout: 15000 }).catch(() => {});
  const shared = await ev(() => window.__clearance.game.save.shared);
  check(shared.length === 2, `two shift 5 filings (${filed.join(', ')}) reached the index: ${shared.map((s) => s.id).join(', ')}`);
  check(sent.every((b) => Object.keys(JSON.parse(b)).sort().join() === 'bits,label'), 'each upload was only {label, bits}');

  const live = await ids();
  for (const s of shared) {
    const e = live.find((x) => x.id === s.id);
    const body = sent.map((b) => JSON.parse(b)).find((b) => b.label === s.label);
    check(e && e.label === s.label && body && e.bits === body.bits, `index ${s.id} holds the ${s.label} print exactly as sent`);
  }

  // The page shows them.
  const view = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await view.goto(`${BASE}index/?index=${encodeURIComponent(INDEX)}`);
  await view.waitForSelector('.print', { timeout: 10000 }).catch(() => {});
  for (const s of shared) check(await view.locator(`.print[data-id="${s.id}"]`).count() === 1, `the page shows print ${s.id}`);
  await view.screenshot({ path: OUT + 'page.png' });

  // The camera's INDEX screen lists them too.
  await ev(() => window.__clearance.game.go('index', 'menu'));
  await page.waitForTimeout(1500);
  const onScreen = await ev(() => window.__clearance.game.index.data && window.__clearance.game.index.data.total);
  check(onScreen >= 2, `THE INDEX screen loaded ${onScreen} prints`);
  await page.locator('#screen').screenshot({ path: OUT + 'camera-index.png' });

  // The Recorder withdraws the first from the archive.
  await ev((id) => { const g = window.__clearance.game, a = g.screens.archive; g.go('archive', 'menu'); a.sel = g.store.list.findIndex((p) => { const s = g.index.statusOf(p.id); return s && s.entry.id === id; }); a.view = true; }, shared[0].id);
  await page.waitForTimeout(300);
  await page.locator('#screen').screenshot({ path: OUT + 'archive-shared.png' });
  await press('DOWN', 400); await press('LEFT'); await press('OK', 2000);
  check(!(await ids()).some((e) => e.id === shared[0].id), `withdrawn from the archive: print ${shared[0].id} is gone from the index`);

  // The admin deletes the second from the page.
  if (ADMIN) {
    const adm = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    adm.on('dialog', (d) => d.accept());
    await adm.goto(`${BASE}index/?index=${encodeURIComponent(INDEX)}&admin`);
    await adm.fill('#adminKey', ADMIN);
    await adm.getByRole('button', { name: 'UNLOCK' }).click();
    await adm.waitForSelector(`.print[data-id="${shared[1].id}"]`, { timeout: 10000 });
    await adm.locator(`.print[data-id="${shared[1].id}"]`).click();
    await adm.screenshot({ path: OUT + 'admin-dialog.png' });
    await adm.locator('#del').click();
    await adm.waitForTimeout(1500);
    check(!(await ids()).some((e) => e.id === shared[1].id), `deleted by the admin on the page: print ${shared[1].id} is gone`);
  } else {
    // No admin key: take it back with the Recorder's key instead.
    await ev(async (id) => { const g = window.__clearance.game; await g.index.withdraw(g.index.mine(id)); }, shared[1].id);
    console.log('  (no INDEX_ADMIN: the second print was withdrawn with its key instead)');
  }
  const after = (await api('/api/index?per=0')).total;
  check(after === before, `the index is back to ${before} prints (now ${after})`);
} finally {
  await browser.close();
}
console.log(errors.length ? `\n${errors.length} FAILED` : '\nindex e2e ok');
process.exit(errors.length ? 1 : 0);
