// Renders one picture at every SENSOR x TONE tier into a single sheet (tools/test/out/ladder.png).
//   node test/ladder.mjs [image]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const img = process.argv[2] || fileURLToPath(new URL('../../../portfolio/content/about/william-yao-2017-headshot.jpg', import.meta.url));
const out = process.argv[3] || fileURLToPath(new URL('./out/ladder.png', import.meta.url));
mkdirSync(fileURLToPath(new URL('./out/', import.meta.url)), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await page.route('**/__fixture/**', (r) => r.fulfill({ body: readFileSync(img), contentType: 'image/jpeg' }));
await page.goto('http://localhost:8077/?image=' + encodeURIComponent('/__fixture/x.jpg'));
await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 8000 }).catch(async (e) => { console.log('state', await page.evaluate(() => window.__clearance ? window.__clearance.camera.state + ' ' + !!window.__clearance.camera.image : 'no hook')); throw e; });
const data = await page.evaluate(async (LIVE) => {
  const { SENSORS, TONES } = await import('./src/game/tiers.js');
  const g = window.__clearance.game;
  const rgba = g.grabFrame(1);
  const c = document.createElement('canvas'); c.width = 6 * 330 + 10; c.height = 5 * 250 + 10;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#111'; ctx.fillRect(0, 0, c.width, c.height);
  for (let si = 0; si < SENSORS.length; si++) for (let ti = 0; ti < TONES.length; ti++) {
    const s = SENSORS[si], col = g.dev.process(rgba, 320, 240, s.w, s.h, TONES[ti], g.theme, LIVE);
    const im = new ImageData(new Uint8ClampedArray(col.buffer.slice(0)), s.w, s.h);
    const tmp = document.createElement('canvas'); tmp.width = s.w; tmp.height = s.h; tmp.getContext('2d').putImageData(im, 0, 0);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(tmp, 10 + ti * 330, 10 + si * 250, 320, 240);
  }
  return c.toDataURL('image/png');
}, process.env.LIVE === '1');
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log('wrote', out);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2000))]); process.exit(0);
