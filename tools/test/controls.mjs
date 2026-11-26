// The unit's body and buttons on phone-sized screens, upright and sideways, plus a desktop:
// screenshots of each layout, and checks that every control is on screen, nothing overlaps
// the picture, and that touches on the control wheel send the right directions (including
// sliding the thumb round the ring, and that no arm moves after a press). The unit is always
// sideways: on an upright phone it is turned a quarter (its top at the phone's right edge),
// so the drawn arms of the wheel, the buttons and the camera picture are checked in that
// frame too. Then the DEV touch test, the FILM flash and the work order coming back.
//   cd tools && node test/controls.mjs      (needs python3 serve.py running)
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/controls/', import.meta.url));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const IMG = path.join(REPO, 'room-watch/ref/1.jpg');

const SIZES = [
  { name: 'iphone-portrait', width: 390, height: 664, dpr: 3, mobile: true },
  { name: 'iphone-landscape', width: 844, height: 340, dpr: 3, mobile: true, insets: true },
  { name: 'iphone-landscape-full', width: 844, height: 390, dpr: 3, mobile: true, insets: true },
  { name: 'se-portrait', width: 375, height: 548, dpr: 2, mobile: true },
  { name: 'se-landscape', width: 667, height: 326, dpr: 2, mobile: true },
  { name: 'android-portrait', width: 360, height: 680, dpr: 3, mobile: true },
  { name: 'android-landscape', width: 800, height: 312, dpr: 3, mobile: true },
  { name: 'desktop', width: 1280, height: 860, dpr: 2, mobile: false },
  { name: 'desktop-small', width: 1024, height: 680, dpr: 1, mobile: false },
  { name: 'tablet-portrait', width: 820, height: 1180, dpr: 2, mobile: true },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const errors = [];
const fail = (m) => { errors.push(m); console.log('  !! ' + m); };

for (const sz of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: sz.width, height: sz.height }, deviceScaleFactor: sz.dpr, isMobile: sz.mobile, hasTouch: sz.mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`${sz.name}: ${e.message}`));
  await page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(IMG), contentType: 'image/jpeg' }));
  await page.goto(`${BASE}?image=${encodeURIComponent('/__fixture/' + encodeURIComponent(IMG))}`);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
  await page.waitForTimeout(1600);

  // Geometry: every control inside the window, none overlapping the screen or each other.
  const geo = await page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    return { vw: innerWidth, vh: innerHeight, screen: r('#screen'), bezel: r('#bezel'), wheel: r('#wheel'), ok: r('#ok'), select: r('#select'), shutter: r('#shutter'), plate: r('#plate'), print: r('#print'), cls: document.getElementById('device').className };
  });
  const inside = (b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= geo.vw + 0.5 && b.y + b.h <= geo.vh + 0.5;
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  for (const k of ['bezel', 'wheel', 'select', 'shutter']) if (!inside(geo[k])) fail(`${sz.name}: ${k} is off screen ${JSON.stringify(geo[k])}`);
  for (const k of ['wheel', 'select', 'shutter', 'plate', 'print']) if (hit(geo.bezel, geo[k])) fail(`${sz.name}: ${k} overlaps the screen`);
  for (const [a, b] of [['wheel', 'select'], ['wheel', 'shutter'], ['select', 'shutter']]) if (hit(geo[a], geo[b])) fail(`${sz.name}: ${a} overlaps ${b}`);
  const turned = geo.cls.includes('turned');
  if (turned !== (sz.mobile && sz.height > sz.width && !geo.cls.includes('framed'))) fail(`${sz.name}: turned is ${turned} (${geo.cls})`);
  // The screen is always on the unit's left: the phone's top when turned.
  const mid = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  if (turned ? !(mid(geo.bezel).y < mid(geo.wheel).y) : !(mid(geo.bezel).x < mid(geo.wheel).x)) fail(`${sz.name}: the screen is not on the unit's left`);
  const sc = Math.max(geo.screen.w, geo.screen.h) / 320;
  console.log(`${sz.name.padEnd(22)} ${geo.cls.padEnd(12)} screen ${Math.round(geo.screen.w)}x${Math.round(geo.screen.h)} (${sc.toFixed(2)}x, ${(sc * sz.dpr).toFixed(2)} device px)  wheel ${Math.round(geo.wheel.w)}  shutter ${Math.round(geo.shutter.w)}`);
  if (sc < 0.85) fail(`${sz.name}: screen only ${sc.toFixed(2)}x`);
  if (geo.wheel.w < 120) fail(`${sz.name}: wheel only ${Math.round(geo.wheel.w)} px`);
  await page.screenshot({ path: path.join(OUT, `${sz.name}.png`) });

  // The wheel: touches in each quarter, a slide round the ring, then OK, SELECT and the shutter.
  if (sz.mobile) {
    await page.evaluate(() => {
      const inp = window.__clearance.input, log = (window.__log = []);
      const p = inp.press.bind(inp);
      inp.press = (b) => { log.push(b); p(b); };
    });
    const c = { x: geo.wheel.x + geo.wheel.w / 2, y: geo.wheel.y + geo.wheel.h / 2 }, R = geo.wheel.w * 0.38;
    // Angles in the unit's own frame; turned, the unit's up is the page's right.
    const rot = turned ? Math.PI / 2 : 0;
    const at = (a) => ({ x: c.x + Math.cos(a + rot) * R, y: c.y + Math.sin(a + rot) * R });
    const marks = () => page.evaluate(() => [...document.querySelectorAll('#wheel .mk')].map((m) => { const b = m.getBoundingClientRect(); return `${Math.round(b.left)},${Math.round(b.top)}`; }).join(' '));
    const before = await marks();
    const taps = [['UP', -Math.PI / 2], ['RIGHT', 0], ['DOWN', Math.PI / 2], ['LEFT', Math.PI], ['UP', -Math.PI / 2 + 0.6], ['RIGHT', -0.6]];
    for (const [want, a] of taps) {
      const p = at(a);
      await page.evaluate(() => { window.__log.length = 0; });
      await page.touchscreen.tap(p.x, p.y);
      await page.waitForTimeout(60);
      const got = await page.evaluate(() => window.__log.join(','));
      if (got !== want) fail(`${sz.name}: tap at ${Math.round((a * 180) / Math.PI)}° gave "${got}", wanted ${want}`);
    }
    // Slide from UP round to RIGHT with a mouse-type pointer (pointer capture keeps it).
    await page.evaluate(() => { window.__log.length = 0; });
    const p0 = at(-Math.PI / 2);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down();
    for (let k = 1; k <= 8; k++) { const p = at(-Math.PI / 2 + (k / 8) * (Math.PI / 2)); await page.mouse.move(p.x, p.y); }
    const held = await page.evaluate(() => document.getElementById('wheel').dataset.dir);
    await page.mouse.up();
    const slid = await page.evaluate(() => window.__log.join(','));
    if (slid !== 'UP,RIGHT') fail(`${sz.name}: slide UP→RIGHT gave "${slid}"`);
    if (held !== 'RIGHT') fail(`${sz.name}: wheel shows ${held} while RIGHT is held`);
    const after = await marks();
    if (before !== after) fail(`${sz.name}: the wheel's marks moved after presses (${before} → ${after})`);
    const left = await page.evaluate(() => document.getElementById('wheel').dataset.dir);
    if (left) fail(`${sz.name}: wheel still shows ${left} pressed after release`);
    for (const [sel, want] of [['#ok', 'OK'], ['#select', 'SELECT'], ['#shutter', 'SHUTTER']]) {
      const b = geo[sel.slice(1)];
      await page.evaluate(() => { window.__log.length = 0; });
      await page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
      await page.waitForTimeout(60);
      const got = await page.evaluate(() => window.__log.join(','));
      if (got !== want) fail(`${sz.name}: tap on ${sel} gave "${got}"`);
    }
  }
  await ctx.close();
}

// The graphite body and the in-game BODY setting.
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(IMG), contentType: 'image/jpeg' }));
  await page.goto(`${BASE}?image=${encodeURIComponent('/__fixture/' + encodeURIComponent(IMG))}`);
  await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
  await page.evaluate(() => { window.__clearance.game.save.settings.body = 'graphite'; });
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.getElementById('device').dataset.body);
  if (body !== 'graphite') fail(`graphite body not applied (${body})`);
  await page.screenshot({ path: path.join(OUT, 'graphite-landscape.png') });
  await ctx.close();
}

const fixture = async (page) => page.route('**/__fixture/**', (route) => route.fulfill({ body: readFileSync(IMG), contentType: 'image/jpeg' }));
const withImage = `image=${encodeURIComponent('/__fixture/' + encodeURIComponent(IMG))}`;
const upright = { viewport: { width: 390, height: 664 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

// The camera picture on an upright page: a portrait frame (top half red, bottom half blue,
// as an upright phone sends it) is turned a quarter left, so its top lands on the left of
// the picture; level, the same frame is only cropped (red above blue).
{
  const ctx = await browser.newContext(upright);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`turned camera: ${e.message}`));
  await page.goto(BASE);
  await page.waitForFunction(() => window.__clearance && window.__clearance.camera, null, { timeout: 15000 });
  const res = await page.evaluate(async () => {
    const { camera } = window.__clearance;
    const c = document.createElement('canvas'); c.width = 300; c.height = 400;
    const x = c.getContext('2d'); x.fillStyle = '#f00'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#00f'; x.fillRect(0, 200, 300, 200);
    await camera.useImage(c.toDataURL());
    const sample = () => {
      const o = document.createElement('canvas'); o.width = 64; o.height = 48;
      const g = o.getContext('2d'); camera.draw(g, 64, 48);
      const px = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return d[0] > 128 && d[2] < 128 ? 'red' : d[2] > 128 && d[0] < 128 ? 'blue' : 'other'; };
      return { left: px(8, 24), right: px(56, 24), top: px(32, 6), bottom: px(32, 42), w: camera.width, h: camera.height };
    };
    const turn = camera.turn, a = sample();
    camera.turn = false; const b = sample(); camera.turn = turn;
    return { turn, a, b };
  });
  if (!res.turn) fail('turned camera: camera.turn is off on an upright phone');
  if (res.a.left !== 'red' || res.a.right !== 'blue') fail(`turned camera: the frame's top should land on the left ${JSON.stringify(res.a)}`);
  if (res.a.w !== 400 || res.a.h !== 300) fail(`turned camera: ${res.a.w}x${res.a.h}, wanted 400x300`);
  if (res.b.top !== 'red' || res.b.bottom !== 'blue') fail(`level camera: wanted red above blue ${JSON.stringify(res.b)}`);
  console.log(`turned camera          ${res.a.w}x${res.a.h}, top of the frame on the ${res.a.left === 'red' ? 'left' : '?'}`);
  await ctx.close();
}

// DEV ▸ TOUCH TEST (?touchtest): a ring where the touch landed and what the page says was
// under it, here a tap on the drawn shutter of the turned unit.
{
  const ctx = await browser.newContext(upright);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`touch test: ${e.message}`));
  await fixture(page);
  await page.goto(`${BASE}?touchtest&${withImage}`);
  await page.waitForFunction(() => window.__clearance && document.getElementById('touchpanel'), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const b = await page.evaluate(() => { const r = document.getElementById('shutter').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await page.touchscreen.tap(b.x, b.y);
  await page.waitForTimeout(150);
  const txt = await page.textContent('#touchpanel');
  if (!/WAS ON: SHUTTER/.test(txt)) fail(`touch test: ${txt}`);
  const rings = await page.$$eval('#touchtest > div', (els) => els.length);
  if (rings !== 1) fail(`touch test: ${rings} rings`);
  await page.screenshot({ path: path.join(OUT, 'touchtest.png') });
  console.log(`touch test             ${txt.split('\n').pop()}`);
  await ctx.close();
}

// The FILM box flashes after a photo that leaves less film than the open requests + 2 (not
// when coming back from the menu); the work order list comes back at a new shift and when a
// game is resumed, even if OK had hidden it.
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`film flash: ${e.message}`));
  await fixture(page);
  await page.goto(`${BASE}?${withImage}`);
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 15000 });
  const r = await page.evaluate(async () => {
    const g = window.__clearance.game, f = g.screens.field;
    g.jumpTo(1); g.save.phase = 'field'; g.go('field');
    const open = f.open().length;
    g.order.film = open + 1; f.enter(undefined, 'develop'); const low = f.filmFlash;
    g.order.film = open + 2; f.enter(undefined, 'develop'); const enough = f.filmFlash;
    g.order.film = open + 1; f.enter(undefined, 'menu'); const menu = f.filmFlash;
    f.enter(undefined, 'develop');
    return { open, low, enough, menu, film: g.order.film, size: g.filmSize };
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, 'film-flash.png') });
  if (!(r.low > 0)) fail(`film flash: no flash with ${r.open + 1} film for ${r.open} open requests`);
  if (r.enough !== 0) fail(`film flash: flashed with ${r.open + 2} film for ${r.open} open requests`);
  if (r.menu !== 0) fail('film flash: flashed coming back from the menu');
  if (r.size !== 10) fail(`film: FILM I gives ${r.size}, wanted 10`);
  const h = await page.evaluate(async () => {
    const g = window.__clearance.game;
    g.save.settings.hud = 1; g.startShift(); const shift = g.save.settings.hud;
    g.save.settings.hud = 1; await g.resume(); const resumed = g.save.settings.hud;
    return { shift, resumed };
  });
  if (h.shift !== 0) fail('work order: still hidden at a new shift');
  if (h.resumed !== 0) fail('work order: still hidden after resuming');
  console.log(`film flash             ${r.open} open: flashes at ${r.open + 1} film, not at ${r.open + 2}; work order shown at a new shift and on resume`);
  await ctx.close();
}

console.log(errors.length ? `\n${errors.length} PROBLEMS` : '\ncontrols ok');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(errors.length ? 1 : 0);
