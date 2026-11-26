// Screenshots of the game's progression, shift by shift, for the write-up: the work order
// (the memo and that shift's prompts), the viewfinder at the grade a Recorder would have by
// then, and a developed exposure filed for one of the prompts. Plus the title, the end-shift
// bubble, the report, the requisition form, the LAB and both endings.
// Saves to tools/test/out/story/ (ignored: some use William's own headshots; never commit them).
//   cd tools && node test/story-shots.mjs      (needs python3 serve.py running)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/story/', import.meta.url));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const IMG = {
  tv: path.join(REPO, 'room-watch/ref-living/4-tv-wall-photo.jpg'),
  room: path.join(REPO, 'room-watch/ref/1.jpg'),
  dining: path.join(REPO, 'room-watch/ref-living/2-dining-nook-cord-compare.jpg'),
  sofa: path.join(REPO, 'room-watch/ref-living/1-sofa-wave-rug.jpg'),
  cat: path.join(REPO, 'ancient-cats/Japan 01 - Hiroshige cat at the window (1857).jpg'),
  face: path.join(REPO, 'portfolio/content/about/william-yao-2017-headshot.jpg'),
  turned: path.join(REPO, 'portfolio/content/about/william-yao-bw-headshot.jpg'),
  studio: path.join(REPO, 'portfolio/content/about/william-yao-studio.jpg'),
};

// Each shift: a typical work order (from that shift's pool), the grades a Recorder would hold,
// and the picture + request for the filed exposure.
const SHIFTS = [
  { n: 1, keys: ['rect', 'red', 'circle', 'light', 'nothing', 'green'], own: { sensor: 0, tone: 0 }, shot: ['tv', 'rect'] },
  { n: 2, keys: ['chair', 'plant', 'vehicle', 'animal', 'triangle', 'screen'], own: { sensor: 1, tone: 1 }, shot: ['dining', 'chair'] },
  { n: 3, keys: ['person', 'face', 'two', 'onphone', 'far', 'crowd'], own: { sensor: 2, tone: 1 }, shot: ['face', 'face'] },
  { n: 4, keys: ['smile', 'nosmile', 'away', 'atyou', 'surprise'], own: { sensor: 2, tone: 2 }, shot: ['turned', 'away'] },
  { n: 5, keys: ['sadness', 'alone', 'notbelong', 'suspicious', 'hiding', 'waiting'], own: { sensor: 3, tone: 3 }, shot: ['studio', 'sadness'] },
  { n: 6, keys: ['again', 'unaware', 'seen', 'place', 'again'], own: { sensor: 3, tone: 4 }, shot: ['face', 'again'] },
  { n: 7, keys: ['self'], own: { sensor: 4, tone: 5 }, shot: ['face', 'self'] },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 390, height: 680 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(decodeURIComponent(route.request().url().split('/__fixture/')[1])), contentType: 'image/jpeg' }));
const fx = (k) => '/__fixture/' + encodeURIComponent(IMG[k]);
const ev = (f, a) => page.evaluate(f, a);
const press = async (b, wait = 350) => { await ev((x) => window.__clearance.press(x), b); await page.waitForTimeout(wait); };
const shot = (name) => page.locator('#screen').screenshot({ path: path.join(OUT, `${name}.png`) });
const useImage = (k) => ev((u) => window.__clearance.camera.useImage(u), fx(k));
const state = () => ev(() => window.__clearance.game.stateName);

await page.goto(`${BASE}?image=${encodeURIComponent(fx('room'))}`);
await ev(() => { localStorage.clear(); indexedDB.deleteDatabase('clearance'); });
await page.reload();
await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
await ev(() => Promise.all(['objects', 'faces', 'affect', 'intent'].map((m) => window.__clearance.game.modules.ensure(m))));
await page.waitForTimeout(1800);
await shot('00-title');

let againId = null;
for (const S of SHIFTS) {
  await ev(({ S, againId }) => {
    const g = window.__clearance.game;
    g.save.day = S.n;
    g.save.merit = Math.max(g.save.merit, 60 * S.n);
    Object.assign(g.save.own, S.own);
    let ex = 0;
    const requests = S.keys.map((key) => ({ key, arg: key === 'again' ? (ex++ === 0 && againId ? againId : Math.max(1, (againId || 2) - 1)) : null, done: false, photo: null, merit: 0 }));
    const quota = { 1: 4, 2: 4, 3: 3, 4: 3, 5: 3, 6: 3, 7: 1 }[S.n];
    g.save.order = { requests, quota, film: g.filmSize, earned: 0, shots: 0, seed: S.n, day: S.n };
    g.save.phase = 'order';
    g.go('order');
    g.screens.order.t = 99; // the memo fully typed, ISSUED stamped
  }, { S, againId });
  await page.waitForTimeout(700);
  await shot(`${S.n}a-order`);
  await ev(() => { const g = window.__clearance.game; g.save.phase = 'field'; g.go('field'); });
  const [img, key] = S.shot;
  await useImage(img);
  await ev((k) => { const g = window.__clearance.game, i = g.order.requests.findIndex((r) => r.key === k); g.screens.field.focus = Math.max(0, i); }, key);
  await page.waitForTimeout(1500);
  await shot(`${S.n}b-field`);
  await press('SHUTTER', 5500);
  await shot(`${S.n}c-develop`);
  const v = await ev(() => { const l = window.__clearance.game.store.list; const p = l[l.length - 1]; return { id: p.id, ...p.verdict }; });
  console.log(`shift ${S.n}: ${v.ok ? 'FILED ' + v.text : 'NOT FILED ' + v.why}`);
  if (S.n === 5) againId = v.id; // shift 6 asks for this subject again
  if (S.n === 7) break; // the self-portrait ends the game
  await press('OK', 800);
}

// The ending that follows the self-portrait.
await press('OK', 2500); await shot('8a-ending-file');
await press('OK', 1200); await shot('8b-ending-notice');
await press('OK', 1200); await shot('8c-ending-stamped');
await press('OK', 2200); await shot('8d-ending-revoked');

// The end-shift bubble, the report and the requisition form (shift 2).
await ev(() => { const g = window.__clearance.game; g.newGame(); g.save.day = 2; g.save.merit = 140; g.save.own.sensor = 1; g.save.own.tone = 1; g.startShift(); g.save.phase = 'field'; const o = g.order; for (let k = 0; k < o.quota; k++) { o.requests[k].done = true; o.requests[k].merit = 20; o.earned += 20; } g.go('field', 'quota'); });
await useImage('sofa');
await page.waitForTimeout(900); await shot('9a-bubble');
await press('OK', 1400); await shot('9b-report');
await press('OK', 900); await shot('9c-requisition');

// The other ending: opening the back of the unit.
await ev(() => { const g = window.__clearance.game; g.newGame(); g.save.day = 5; g.startShift(); g.save.phase = 'field'; g.go('field'); });
await useImage('room'); await page.waitForTimeout(400);
await press('SHUTTER', 4500); await press('OK', 600);
await ev(() => window.__clearance.game.go('ending', 'exposed'));
await page.waitForTimeout(700); await shot('10a-exposed-burn');
await page.waitForTimeout(1900);
await press('OK', 1200); await press('OK', 1200); await shot('10b-exposed-report');

// The LAB.
await ev(() => window.__clearance.game.go('lab'));
await useImage('face');
await page.waitForTimeout(2500);
await press('SHUTTER', 9000);
await shot('11-lab');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'story shots ok');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(errors.length ? 1 : 0);
