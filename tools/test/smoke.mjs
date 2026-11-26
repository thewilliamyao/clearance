// Quick look: load the game in headless Chromium with a still image as the camera, press
// through the first screens and save screenshots to tools/test/out/.
//   node test/smoke.mjs [imagePath] [steps...]
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const img = process.argv[2] || fileURLToPath(new URL('../../../room-watch/ref/1.jpg', import.meta.url));
const steps = process.argv.slice(3);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.route('**/__fixture/**', (route) => {
  const f = decodeURIComponent(route.request().url().split('/__fixture/')[1]);
  if (!existsSync(f)) return route.fulfill({ status: 404 });
  route.fulfill({ body: readFileSync(f), contentType: f.endsWith('.png') ? 'image/png' : 'image/jpeg' });
});
await page.goto(`${BASE}?image=${encodeURIComponent('/__fixture/' + encodeURIComponent(img))}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(OUT, 'smoke-0.png') });
let k = 1;
for (const s of steps) {
  if (s.startsWith('wait')) await page.waitForTimeout(Number(s.slice(4)) || 1000);
  else if (s.startsWith('eval:')) console.log(await page.evaluate(s.slice(5)));
  else { await page.evaluate((b) => window.__clearance.press(b), s); await page.waitForTimeout(500); }
  await page.screenshot({ path: path.join(OUT, `smoke-${k++}.png`) });
}
console.log('state:', await page.evaluate(() => window.__clearance.game.stateName));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
