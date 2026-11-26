// Plays the whole game in headless Chrome with still pictures as the camera: every screen,
// every shift, both endings, the LAB. Saves screenshots to tools/test/out/play/ and fails on
// any page error.   cd tools && node test/playthrough.mjs
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LABELS } from '../../server/src/rules.js';

const BASE = process.env.BASE || 'http://localhost:8077/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/play/', import.meta.url));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const IMG = {
  room: path.join(REPO, 'room-watch/ref/1.jpg'),
  room2: path.join(REPO, 'room-watch/ref/3.jpg'),
  face: path.join(REPO, 'portfolio/content/about/william-yao-2017-headshot.jpg'),
  turned: path.join(REPO, 'portfolio/content/about/william-yao-bw-headshot.jpg'),
  studio: path.join(REPO, 'portfolio/content/about/william-yao-studio.jpg'),
  sunset: path.join(REPO, 'portfolio/content/about/william-yao-sunset-camera.jpg'),
  cat: path.join(REPO, 'ancient-cats/Japan 01 - Hiroshige cat at the window (1857).jpg'),
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: false });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource|^INFO:|^W[0-9]{4} /.test(m.text())) errors.push(m.text()); });
await page.route('**/__fixture/**', (route) => {
  const f = decodeURIComponent(route.request().url().split('/__fixture/')[1]);
  route.fulfill({ body: readFileSync(f), contentType: 'image/jpeg' });
});
const fx = (k) => '/__fixture/' + encodeURIComponent(IMG[k]);
// A stand-in for the shared index (server/), on this origin so there's no CORS: it records
// exactly what the unit sends.
const fake = { entries: [], posts: [], deletes: [] };
await page.route('**/__index/**', (route) => {
  // Everything up to /__index goes: the live site sits under /clearance/.
  const req = route.request(), m = req.method(), p = new URL(req.url()).pathname.replace(/^.*\/__index/, '');
  const json = (status, j) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(j) });
  if (m === 'POST' && p === '/api/entries') {
    const body = req.postData(), j = JSON.parse(body);
    fake.posts.push({ body, headers: req.headers() });
    const e = { id: fake.entries.length + fake.deletes.length + 1, label: j.label, bits: j.bits, day: '2026-11-21', key: [...Array(32)].map(() => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('') };
    fake.entries.push(e);
    return json(201, { id: e.id, key: e.key, day: e.day, status: 'live' });
  }
  if (m === 'GET' && p === '/api/index') {
    const labels = LABELS.map((l) => { const es = fake.entries.filter((e) => e.label === l).reverse(); return { label: l, n: es.length, entries: es.map(({ id, label, day, bits }) => ({ id, label, day, bits })) }; });
    return json(200, { labels, total: fake.entries.length });
  }
  const d = /^\/api\/entries\/(\d+)$/.exec(p);
  if (m === 'DELETE' && d) {
    const key = req.headers()['x-delete-key'], k = fake.entries.findIndex((e) => e.id === Number(d[1]) && e.key === key);
    fake.deletes.push({ id: Number(d[1]), key, ok: k >= 0 });
    if (k < 0) return json(404, { error: 'no such entry for this key' });
    fake.entries.splice(k, 1);
    return json(200, { deleted: Number(d[1]) });
  }
  return json(404, { error: 'not found' });
});
let n = 0;
const shot = async (name) => { await page.locator('#screen').screenshot({ path: path.join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) }); };
const press = async (b, wait = 350) => { await page.evaluate((x) => window.__clearance.press(x), b); await page.waitForTimeout(wait); };
const state = () => page.evaluate(() => window.__clearance.game.stateName);
const ev = (f, a) => page.evaluate(f, a);
const expect = async (want, label) => { const s = await state(); if (s !== want) { errors.push(`${label}: expected ${want}, got ${s}`); console.log(`  !! ${label}: expected ${want}, got ${s}`); } };
const useImage = (k) => ev((u) => window.__clearance.camera.useImage(u), fx(k));

await page.goto(`${BASE}?image=${encodeURIComponent(fx('room'))}&index=${encodeURIComponent(BASE + '__index')}`);
await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('clearance'); });
await page.reload();
await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
await page.waitForTimeout(1800);
await shot('title');
await press('OK', 900);
await expect('order', 'title → order');
await page.waitForTimeout(800); await shot('order-typing');
await press('OK', 600); await shot('order-issued');
await press('OK', 600);
await expect('field', 'order → field');
await shot('field-day1-hint');
await page.waitForTimeout(7200); await shot('field-day1');
await press('DOWN', 200); await shot('field-next-request');
await press('SHUTTER', 50); await shot('develop-flash');
await page.waitForTimeout(600); await shot('develop-printing');
await page.waitForTimeout(3200); await shot('develop-stamped');
await press('OK', 400);
await expect('field', 'develop → field');

// Menu, archive, settings.
await press('SELECT', 400); await shot('menu');
await press('DOWN'); await press('DOWN'); await press('OK', 500);
await expect('archive', 'menu → archive');
await shot('archive');
await press('OK', 400); await shot('archive-photo');
await press('SELECT'); await press('SELECT', 400);
await expect('menu', 'archive → menu');
for (let k = 0; k < 3; k++) await press('DOWN', 120); // the menu remembers ARCHIVE; SETTINGS is three rows down (past THE INDEX, LAB)
await press('OK', 400); await expect('settings', 'menu → settings'); await shot('settings');
await press('RIGHT', 300); await shot('settings-palette-phosphor');
await press('LEFT', 300);
// SHARE WITH THE INDEX: off by default; turning it on asks first.
if (await ev(() => window.__clearance.game.save.settings.share)) errors.push('sharing was on before the Recorder turned it on');
for (let k = 0; k < 6; k++) await press('DOWN', 120);
await shot('settings-share');
await press('OK', 400); await expect('confirm', 'share → confirm'); await shot('confirm-share');
await press('LEFT'); await press('OK', 400); await expect('settings', 'confirm → settings');
if (!(await ev(() => window.__clearance.game.save.settings.share))) errors.push('SHARE did not turn sharing on');
await shot('settings-share-on');
await press('SELECT', 400); await expect('menu', 'settings → menu');

// End the shift early: citation path. The menu remembers SETTINGS (row 5); END SHIFT is row 6.
await press('DOWN', 120);
await press('OK', 400); await expect('confirm', 'end shift → confirm'); await shot('confirm-end');
await press('LEFT'); await press('OK', 600); await expect('report', 'confirm → report');
await page.waitForTimeout(1200); await shot('report');
await press('OK', 500); await expect('shop', 'report → shop'); await shot('shop');
await ev(() => { window.__clearance.game.save.merit = 300; });
await press('OK', 500); await shot('shop-bought-sensor');
await press('DOWN'); await press('OK', 500); await shot('shop-bought-tone');
for (let k = 0; k < 4; k++) await press('DOWN', 120);
await press('OK', 800); await expect('order', 'shop → order day 2');
await page.waitForTimeout(400); await press('OK', 400); await press('OK', 500);
await expect('field', 'day 2 field');
await page.waitForTimeout(2500); // inventory module loads
await shot('field-day2');
await press('SHUTTER', 4500); await shot('develop-day2');
await press('OK', 400);

// Shift 5 with sharing on: each filing goes to the index as a 40x30 two-tone print and its
// label, nothing else; THE INDEX shows it; the Recorder can withdraw it (INDEX screen, archive).
async function indexChecks() {
  const filed = await ev(() => window.__clearance.game.store.list.filter((p) => p.day === 5 && p.verdict && p.verdict.ok).map((p) => p.verdict.key));
  await page.waitForTimeout(500);
  console.log(`  shift 5: ${filed.length} filed, ${fake.posts.length} sent to the index`);
  if (!filed.length) errors.push('shift 5 filed nothing, so nothing could be shared');
  if (fake.posts.length !== filed.length) errors.push(`shift 5 filed ${filed.length} but sent ${fake.posts.length}`);
  for (const p of fake.posts) {
    const j = JSON.parse(p.body);
    if (Object.keys(j).sort().join() !== 'bits,label') errors.push(`the unit sent more than the print and its label: ${Object.keys(j)}`);
    if (Buffer.from(j.bits, 'base64').length !== 150) errors.push('the print is not 40x30 two-tone (150 bytes)');
    if (!filed.includes(j.label)) errors.push(`sent label ${j.label} was not filed`);
  }
  if (fake.posts.length) {
    await ev(() => window.__clearance.game.go('index', 'menu'));
    await page.waitForTimeout(900); await shot('index-labels');
    await ev(() => { const s = window.__clearance.game.screens.index; s.row = window.__clearance.game.index.data.labels.findIndex((l) => l.entries.length); });
    await press('OK', 300); await shot('index-sheet');
    await press('OK', 300); await shot('index-print-yours');
    await press('DOWN', 400); await expect('confirm', 'withdraw → confirm'); await shot('confirm-withdraw');
    await press('LEFT'); await press('OK', 900); await expect('index', 'confirm → index');
    const d = fake.deletes[0];
    if (!d || !d.ok) errors.push(`withdrawing from THE INDEX failed: ${JSON.stringify(d)}`);
    await shot('index-withdrawn');
    if (fake.entries.length) {
      // The other one, from the archive.
      await ev(() => { const g = window.__clearance.game, a = g.screens.archive; g.go('archive', 'menu'); a.sel = g.store.list.findIndex((p) => { const s = g.index.statusOf(p.id); return s && s.state === 'shared'; }); a.view = true; });
      await page.waitForTimeout(300); await shot('archive-shared');
      await press('DOWN', 400); await press('LEFT'); await press('OK', 900);
      await expect('archive', 'withdraw → archive');
      if (!fake.deletes[1] || !fake.deletes[1].ok) errors.push('withdrawing from the archive failed');
    }
    if (await ev(() => window.__clearance.game.save.shared.length)) errors.push('withdrawn prints are still listed as shared');
    await ev(() => window.__clearance.game.go('field'));
  }
}

// Shifts 3-7 through the developer jump, each with a picture that should file something.
// Each picture aims at the request it should meet (only the selected request is judged); if
// the shift's random order doesn't have that one, the first open request stays selected.
// Shift 5: NO to ARE YOU SURE ...? files nothing and the request stays open for another photo
// (the refusal is still counted, ENDINGS.md).
async function declineCheck() {
  await ev(() => { const g = window.__clearance.game; g.save.phase = 'field'; g.go('field'); });
  const key = await ev(() => {
    const g = window.__clearance.game;
    const r = g.order.requests.find((q) => !q.done && !q.withdrawn && ['notbelong', 'sadness', 'tired', 'waiting', 'hurry', 'alone'].includes(q.key));
    if (!r) return null;
    g.screens.field.focus = g.order.requests.indexOf(r);
    return r.key;
  });
  if (!key) { console.log('  shift 5 NO: no open request with a subject left to try'); return; }
  const before = await ev(() => ({ merit: window.__clearance.game.save.merit, film: window.__clearance.game.order.film }));
  await useImage('studio'); await page.waitForTimeout(500);
  await press('SHUTTER', 5000);
  const asked = await ev(() => { const l = window.__clearance.game.store.list; return !!l[l.length - 1].verdict.soft; });
  if (!asked) { errors.push(`shift 5 NO: the unit did not ask about ${key}`); await press('OK', 600); return; }
  await press('RIGHT', 400); await shot('develop-day5-no');
  await press('OK', 900);
  const st = await ev((k) => {
    const g = window.__clearance.game, r = g.order.requests.find((q) => q.key === k), v = g.store.list[g.store.list.length - 1].verdict;
    return { state: g.stateName, open: !r.done && !r.withdrawn, refusals: g.save.refusals, refused: !!v.refused, filed: !!v.ok, merit: g.save.merit, film: g.order.film };
  }, key);
  console.log(`  shift 5 NO on ${key}: ${JSON.stringify(st)}`);
  if (st.state !== 'field') errors.push(`NO should go back to the field, went to ${st.state}`);
  if (!st.open || st.filed) errors.push('NO filed the photo or closed the request');
  if (st.refusals !== 1 || !st.refused) errors.push('NO was not counted as a refusal');
  if (st.merit !== before.merit) errors.push('NO paid merit');
  if (st.film !== before.film - 1) errors.push('the photo did not use a frame');
  if (st.state === 'field') {
    await shot('field-day5-after-no');
    const sel = await ev(() => { const f = window.__clearance.game.screens.field; f.fixFocus(0); const r = f.selected(); return r ? r.key : null; });
    if (sel !== key) errors.push(`after NO the request should still be selected for another photo (got ${sel})`);
  }
}
const plan = { 3: [['face', 'person'], ['face', 'face']], 4: [['face', 'atyou'], ['turned', 'away']], 5: [['sunset', 'waiting'], ['studio', 'alone']], 6: [['room2', 'place'], ['face', 'again']], 7: [['face', 'self']] };
const aim = (key) => ev((k) => { const g = window.__clearance.game, i = g.order.requests.findIndex((r) => r.key === k && !r.done); if (i >= 0) g.screens.field.focus = i; return i; }, key);
for (const day of [3, 4, 5, 6, 7]) {
  await ev((d) => { const g = window.__clearance.game; g.jumpTo(d); g.go('order'); }, day);
  await page.waitForTimeout(500); await press('OK', 400);
  await shot(`order-day${day}`);
  await press('OK', 500);
  await ev(() => Promise.all(window.__clearance.game.enabledModules().map((m) => window.__clearance.game.modules.ensure(m))));
  for (const [k, [img, key]] of plan[day].entries()) {
    await useImage(img);
    await aim(key);
    await page.waitForTimeout(400);
    if (k === 0) await shot(`field-day${day}`);
    await press('SHUTTER', 5000);
    await shot(`develop-day${day}-${img}`);
    const last = () => ev(() => { const l = window.__clearance.game.store.list; const p = l[l.length - 1]; return p.verdict; });
    let v = await last(), asked = '';
    // Shift 5 asks ARE YOU SURE ...?: YES (selected first) files this photo, stamp and all.
    if (v.soft && !v.ok) {
      asked = `ASKED (${v.why}) → YES → `;
      await press('OK', 900); await shot(`develop-day${day}-${img}-yes`);
      v = await last();
      if (!v.ok) errors.push(`shift ${day}: YES did not file the photo`);
      if (v.ok && v.marks.some((m) => /\?$/.test(m.label || ''))) errors.push('the filed subject still has its question mark');
    }
    console.log(`  shift ${day} ${img}: ${asked}${v.ok ? 'FILED ' + v.text + ' +' + v.merit : 'NOT FILED (' + v.why + ')'}`);
    await press('OK', 600);
    if ((await state()) !== 'field') break;
  }
  if (day === 5) { await indexChecks(); await declineCheck(); }
}
await expect('ending', 'self-portrait → ending');
await page.waitForTimeout(2500); await shot('ending-filed-contact');
await press('OK', 1200); await shot('ending-filed-notice');
await press('OK', 1200); await shot('ending-filed-stamped');
await press('OK', 2000); await shot('ending-filed-revoked');
await press('OK', 800); await expect('title', 'ending → title'); await shot('title-after-ending');

// The end-shift bubble: one filing short of the quota, file one more. KEEP SHOOTING first,
// then the next filing brings it back and END SHIFT goes to the report.
await ev(() => {
  const g = window.__clearance.game; g.newGame(); g.jumpTo(3); g.save.phase = 'field';
  // A fixed order (the draw is random): one request the face picture can't meet, then two it can.
  const mk = (key) => ({ key, arg: null, done: false, photo: null, merit: 0 });
  g.order.requests = [mk('withbag'), mk('face'), mk('person')]; g.order.quota = 2;
  const o = g.order; let need = o.quota - 1;
  for (const r of o.requests) if (need > 0 && !['face', 'person', 'two'].includes(r.key)) { r.done = true; r.merit = 20; o.earned += 20; need--; }
  g.go('field');
});
await useImage('face');
await ev(() => Promise.all(window.__clearance.game.enabledModules().map((m) => window.__clearance.game.modules.ensure(m))));
await page.waitForTimeout(400); await shot('field-quota-minus-one');
await press('SHUTTER', 5000); await press('OK', 700);
await expect('field', 'quota met → field');
if (!(await ev(() => !!window.__clearance.game.screens.field.bubble))) errors.push('no end-shift bubble after the quota was met');
await shot('bubble-quota-met');
await press('RIGHT', 200); await shot('bubble-keep-shooting'); await press('OK', 400);
if (await ev(() => !!window.__clearance.game.screens.field.bubble)) errors.push('KEEP SHOOTING did not close the bubble');
await press('SHUTTER', 5000); await press('OK', 700);
const again = await ev(() => { const g = window.__clearance.game; return { state: g.stateName, bubble: !!g.screens.field.bubble, filed: g.filed(), quota: g.order.quota, closed: !!g.order.closed }; });
console.log('  after another exposure:', JSON.stringify(again));
if (again.state === 'field' && again.bubble) { await press('OK', 900); await expect('report', 'bubble END SHIFT → report'); }
else if (again.state !== 'report') errors.push(`after a second filing past the quota: ${JSON.stringify(again)}`);
await page.waitForTimeout(600); await shot('report-from-bubble');

// The other ending: open the back of the unit on shift 5.
await ev(() => { const g = window.__clearance.game; g.newGame(); g.jumpTo(5); g.save.phase = 'field'; g.go('field'); });
await useImage('room'); await page.waitForTimeout(300);
await press('SHUTTER', 4000);
// If the unit asks ARE YOU SURE ...? about the room, answer NO: back to the field, nothing filed.
if (await ev(() => { const l = window.__clearance.game.store.list; return !!l[l.length - 1].verdict.soft; })) await press('RIGHT', 200);
await press('OK', 500);
await press('SELECT', 400);
for (let k = 0; k < 7; k++) await press('DOWN', 120);
await shot('menu-day5');
await press('OK', 400); await expect('confirm', 'expose → confirm'); await shot('confirm-expose');
await press('LEFT'); await press('OK', 2600); await shot('ending-exposed-burn');
await press('OK', 1200); await shot('ending-exposed-report');
await press('OK', 1200); await shot('ending-exposed-stamped');
await press('OK', 1500); await shot('ending-exposed-end');

// LAB: every page.
await ev(() => window.__clearance.game.go('lab'));
await useImage('face');
await page.waitForTimeout(2500);
for (let p = 0; p < 6; p++) { await page.waitForTimeout(900); await shot(`lab-${p}`); await press('RIGHT', 100); }
await press('SHUTTER', 9000); await shot('lab-bench');

// Layouts.
await page.locator('body').screenshot({ path: path.join(OUT, 'layout-portrait.png') });
await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'layout-landscape.png') });
await page.setViewportSize({ width: 1280, height: 860 }); await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'layout-desktop.png') });

console.log(errors.length ? `\nERRORS:\n${errors.join('\n')}` : '\nplaythrough ok, no page errors');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(errors.length ? 1 : 0);
