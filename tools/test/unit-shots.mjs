// Pictures of the whole unit for the READMEs: docs/unit.png (desktop: the camera on a table)
// and docs/unit-phone.png (a phone held sideways). Shift 2 in the field with
// a room as the camera (no faces), two requests filed.
//   cd tools && node test/unit-shots.mjs      (needs python3 serve.py running)
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const DOCS = fileURLToPath(new URL('../../docs/', import.meta.url));
const IMG = path.join(REPO, 'room-watch/ref/1.jpg');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
async function shoot(name, viewport, dpr, framed) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr });
  await page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(IMG), contentType: 'image/jpeg' }));
  await page.goto(`${BASE}?image=${encodeURIComponent('/__fixture/' + encodeURIComponent(IMG))}`);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
  await page.evaluate(() => {
    const g = window.__clearance.game;
    g.save.own.sensor = 2; g.save.own.tone = 2;
    g.jumpTo(2); g.save.phase = 'field';
    const o = g.order;
    for (const k of [0, 2]) { o.requests[k].done = true; o.requests[k].merit = 15; }
    o.film = 9; o.shots = 3;
    g.go('field');
    g.screens.field.focus = 1;
  });
  await page.waitForTimeout(3500);
  const r = await page.evaluate(() => { const b = document.getElementById('device').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: b.height }; });
  const m = framed ? 36 : 0;
  await page.screenshot({ path: path.join(DOCS, name), clip: { x: Math.max(0, r.x - m), y: Math.max(0, r.y - m), width: Math.min(viewport.width, r.width + 2 * m), height: Math.min(viewport.height, r.height + 2 * m) } });
  await page.close();
}
await shoot('unit.png', { width: 1100, height: 700 }, 1.5, true);
await shoot('unit-phone.png', { width: 844, height: 390 }, 1.5, false);
console.log('wrote docs/unit.png and docs/unit-phone.png');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
