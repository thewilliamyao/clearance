// Screenshots for the player's guide: every screen a Recorder sees, shift by shift, plus the
// menus, settings, archive, requisitions, the LAB, both endings, the palettes and the bodies.
// Saves to tools/test/out/guide/ (private: some use William's headshots).
//   cd tools && node test/guide-shots.mjs      (needs python3 serve.py running)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/guide/', import.meta.url));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const IMG = {
  tv: 'room-watch/ref-living/4-tv-wall-photo.jpg',
  room: 'room-watch/ref/1.jpg',
  dining: 'room-watch/ref-living/2-dining-nook-cord-compare.jpg',
  sofa: 'room-watch/ref-living/1-sofa-wave-rug.jpg',
  face: 'portfolio/content/about/william-yao-2017-headshot.jpg',
  turned: 'portfolio/content/about/william-yao-bw-headshot.jpg',
  sunset: 'portfolio/content/about/william-yao-sunset-camera.jpg',
  studio: 'portfolio/content/about/william-yao-studio.jpg',
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 390, height: 680 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(path.join(REPO, decodeURIComponent(route.request().url().split('/__fixture/')[1]))), contentType: 'image/jpeg' }));
const fx = (k) => '/__fixture/' + encodeURIComponent(IMG[k]);
const ev = (f, a) => page.evaluate(f, a);
const wait = (ms) => page.waitForTimeout(ms);
const press = async (b, ms = 350) => { await ev((x) => window.__clearance.press(x), b); await wait(ms); };
const shot = (name) => page.locator('#screen').screenshot({ path: path.join(OUT, `${name}.png`) });
const useImage = (k) => ev((u) => window.__clearance.camera.useImage(u), fx(k));
const state = () => ev(() => window.__clearance.game.stateName);
const log = (s) => console.log('  ' + s);
// Develop a shot, waiting until the stamp is down (or give up after 12 s).
async function expose(name) {
  await press('SHUTTER', 600);
  for (let k = 0; k < 40; k++) { if (await ev(() => { const d = window.__clearance.game.screens.develop; return window.__clearance.game.stateName === 'develop' && d.stamped; })) break; await wait(300); }
  await wait(900);
  await shot(name);
  const v = await ev(() => { const l = window.__clearance.game.store.list; const p = l[l.length - 1]; return { id: p.id, ...p.verdict }; });
  log(`${name}: ${v.ok ? 'FILED ' + v.text : (v.soft ? 'ASKED ' : 'NOT FILED ') + v.why}`);
  return v;
}
// A shift's work order with chosen requests, the grades a Recorder would hold by then.
async function order(n, keys, own, againId = null) {
  await ev(({ n, keys, own, againId }) => {
    const g = window.__clearance.game;
    g.save.day = n; g.save.merit = Math.max(g.save.merit, 60 * n);
    Object.assign(g.save.own, own);
    let ex = 0;
    const requests = keys.map((key) => ({ key, arg: key === 'again' ? (ex++ === 0 && againId ? againId : Math.max(1, (againId || 2) - 1)) : null, done: false, photo: null, merit: 0 }));
    const quota = { 1: 4, 2: 4, 3: 3, 4: 3, 5: 3, 6: 3, 7: 1 }[n];
    g.save.order = { requests, quota, film: g.filmSize, earned: 0, shots: 0, seed: n, day: n };
    g.save.phase = 'order'; g.go('order'); g.screens.order.t = 99;
  }, { n, keys, own, againId });
  await wait(700);
}
const field = async (img, key) => {
  await ev(() => { const g = window.__clearance.game; g.save.phase = 'field'; g.go('field'); });
  await useImage(img);
  await ev((k) => { const g = window.__clearance.game, i = g.order.requests.findIndex((r) => r.key === k && !r.done); g.screens.field.focus = Math.max(0, i); g.screens.field.hintT = 0; }, key);
  await wait(1600);
};
const aim = (key) => ev((k) => { const g = window.__clearance.game, i = g.order.requests.findIndex((r) => r.key === k && !r.done); if (i >= 0) g.screens.field.focus = i; }, key);

await page.goto(`${BASE}?image=${encodeURIComponent(fx('room'))}`);
await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('clearance'); });
await page.reload();
await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
await ev(() => Promise.all(['objects', 'faces', 'affect', 'intent'].map((m) => window.__clearance.game.modules.ensure(m))));
await wait(2600);
await shot('00-title');

// Shift 1: the flow, a filing, a miss, the menu, the archive, settings.
await order(1, ['rect', 'red', 'circle', 'light', 'nothing', 'green'], { sensor: 0, tone: 0 });
await shot('01-order');
await field('tv', 'rect'); await shot('01-field');
await expose('01-filed'); await press('OK', 700);
await aim('red'); await wait(1200); await shot('01-field-red');
await expose('01-notfiled'); await press('OK', 700);
await press('SELECT', 700); await shot('02-menu');
await ev(() => window.__clearance.game.go('archive', 'menu')); await wait(600); await shot('02-archive');
await press('OK', 700); await shot('02-archive-print');
await ev(() => window.__clearance.game.go('settings', 'menu')); await wait(600); await shot('02-settings');

// Shifts 2-4.
await order(2, ['chair', 'plant', 'vehicle', 'animal', 'triangle', 'screen'], { sensor: 1, tone: 1 });
await shot('2-order'); await field('dining', 'chair'); await shot('2-field'); await expose('2-filed'); await press('OK', 700);
await order(3, ['person', 'face', 'two', 'onphone', 'far', 'crowd'], { sensor: 2, tone: 1 });
await shot('3-order'); await field('face', 'face'); await shot('3-field'); await expose('3-filed'); await press('OK', 700);
await order(4, ['smile', 'nosmile', 'away', 'atyou', 'surprise'], { sensor: 2, tone: 2 });
await shot('4-order'); await field('turned', 'away'); await shot('4-field'); await expose('4-filed'); await press('OK', 700);

// Shift 5: the unit asks back once, then files; a miss for want of a subject.
await order(5, ['sadness', 'alone', 'notbelong', 'suspicious', 'hiding', 'waiting'], { sensor: 3, tone: 3 });
await shot('5-order');
await field('room', 'waiting'); await shot('5-field-nosubject'); await expose('5-nosubject'); await press('OK', 700);
await useImage('sunset'); await aim('waiting'); await wait(1400); await shot('5-field');
await expose('5-asked'); await press('OK', 700);
await ev(() => { window.__clearance.game.screens.field.hintT = 0; }); await wait(800); await shot('5-field-asked');
const filed5 = await expose('5-filed'); await press('OK', 700);
await useImage('studio'); await aim('sadness'); await wait(1200);
await expose('5-sadness-asked'); await press('OK', 700);
await useImage('turned'); await aim('sadness'); await wait(1200);
await expose('5-sadness-filed'); await press('OK', 700);

// Shift 6: the Recorder's labels in the profile; the subject of an earlier exposure again.
await order(6, ['again', 'unaware', 'seen', 'place', 'again'], { sensor: 3, tone: 4 }, filed5.id);
await shot('6-order'); await field('sunset', 'again'); await shot('6-field'); await expose('6-again'); await press('OK', 700);
await useImage('face'); await aim('seen'); await wait(1200); await expose('6-seen'); await press('OK', 700);

// Shift 7 and the ending that follows the self-portrait.
await order(7, ['self'], { sensor: 4, tone: 5 });
await shot('7-order'); await field('face', 'self'); await shot('7-field'); await expose('7-filed');
await press('OK', 2500); await shot('8a-ending-file');
await press('OK', 1200); await shot('8b-ending-notice');
await press('OK', 1200); await shot('8c-ending-stamped');
await press('OK', 2200); await shot('8d-ending-revoked');

// End of a shift: the quota bubble, the report, the requisition form.
await ev(() => { const g = window.__clearance.game; g.newGame(); g.save.day = 2; g.save.merit = 140; g.save.own.sensor = 1; g.save.own.tone = 1; g.startShift(); g.save.phase = 'field'; const o = g.order; for (let k = 0; k < o.quota; k++) { o.requests[k].done = true; o.requests[k].merit = 20; o.earned += 20; } g.go('field', 'quota'); });
await useImage('sofa'); await wait(900); await shot('9a-bubble');
await press('OK', 1400); await shot('9b-report');
await press('OK', 900); await shot('9c-requisition');

// Ending a shift short of the quota: the confirmation and the citation.
await ev(() => { const g = window.__clearance.game; g.newGame(); g.save.day = 3; g.save.merit = 200; g.startShift(); g.save.phase = 'field'; const o = g.order; o.requests[0].done = true; o.requests[0].merit = 25; o.earned = 25; g.go('field'); });
await useImage('room'); await wait(700);
await press('SELECT', 700);
await ev(() => { const m = window.__clearance.game.screens.menu; m.sel = m.items.findIndex((x) => x.id === 'end'); });
await press('OK', 700); await shot('9e-confirm');
await ev(() => { const g = window.__clearance.game; g.screens.confirm.sel = 0; }); await press('OK', 1600); await shot('9f-citation');

// The other ending: opening the back of the unit (from shift 5).
await ev(() => { const g = window.__clearance.game; g.newGame(); g.save.day = 5; g.startShift(); g.save.phase = 'field'; g.go('field'); });
await useImage('room'); await wait(400);
await expose('10-before'); await press('OK', 600);
await ev(() => window.__clearance.game.go('ending', 'exposed'));
await wait(700); await shot('10a-exposed-burn');
await wait(1900);
await press('OK', 1200); await press('OK', 1200); await shot('10b-exposed-report');

// The LAB: the summary, then the INTENT page.
await ev(() => window.__clearance.game.go('lab'));
await useImage('face'); await wait(2500);
await press('SHUTTER', 9000); await shot('11a-lab');
for (let k = 0; k < 4; k++) await press('RIGHT', 300);
await wait(2500); await shot('11b-lab-intent');

// Palettes: the same viewfinder in each.
await ev(() => { const g = window.__clearance.game; g.newGame(); g.save.day = 4; g.save.own.sensor = 3; g.save.own.tone = 3; g.startShift(); g.save.phase = 'field'; g.go('field'); });
await useImage('sofa');
for (const id of ['ledger', 'phosphor', 'amber', 'cyanotype', 'liquid', 'night']) {
  const ok = await ev((t) => { const g = window.__clearance.game; g.save.settings.theme = t; return g.theme.id === t; }, id);
  if (!ok) { log(`no palette ${id}`); continue; }
  await wait(900); await shot(`12-palette-${id}`);
}
await ev(() => { window.__clearance.game.save.settings.theme = 'ledger'; });

// The bodies: silver and graphite, sideways.
await page.setViewportSize({ width: 1100, height: 700 });
for (const body of ['silver', 'graphite']) {
  await ev((b) => { window.__clearance.game.save.settings.body = b; }, body);
  await wait(1200);
  const r = await ev(() => { const b = document.getElementById('device').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
  await page.screenshot({ path: path.join(OUT, `13-body-${body}.png`), clip: { x: Math.max(0, r.x - 20), y: Math.max(0, r.y - 20), width: Math.min(1100, r.width + 40), height: Math.min(700, r.height + 40) } });
}

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'guide shots ok');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(errors.length ? 1 : 0);
