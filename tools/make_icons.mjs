// Draws the Office seal with the game's own pixel code and saves the app icons
// (icons/icon-180.png, icon-192.png, icon-512.png). Needs the local server running.
//   cd tools && node make_icons.mjs
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:8077/');
const icons = await page.evaluate(async () => {
  const { Screen, hex } = await import('./src/engine/screen.js');
  const { seal } = await import('./src/game/ui.js');
  const scr = new Screen(null);
  const ink = hex('#1d1b22'), paper = hex('#d9d0b8'), red = hex('#c63a2c');
  const render = (n, scale) => {
    scr.clear(ink);
    seal(scr, n >> 1, n >> 1, (n >> 1) - 3, ink, paper);
    scr.rect(n - 5, 2, 2, 2, red); // the REC light
    const c = document.createElement('canvas'); c.width = n * scale; c.height = n * scale;
    const ctx = c.getContext('2d');
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = scr.buf[y * 320 + x];
      ctx.fillStyle = `rgb(${v & 255},${(v >>> 8) & 255},${(v >>> 16) & 255})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
    return c.toDataURL('image/png');
  };
  return { 180: render(30, 6), 192: render(32, 6), 512: render(32, 16) };
});
for (const [size, url] of Object.entries(icons)) writeFileSync(`${OUT}icon-${size}.png`, Buffer.from(url.split(',')[1], 'base64'));
console.log('wrote icons to', OUT);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 2000))]);
process.exit(0);
