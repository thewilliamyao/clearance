// Boot: wire the screen, buttons, camera and sound to the game and run the frame loop.
import { Screen, W, H } from './engine/screen.js';
import { Input } from './engine/input.js';
import { Camera } from './engine/camera.js';
import { Sfx } from './engine/audio.js';
import { Game } from './game/game.js';
import { loadContent } from './game/content.js';
import { TouchTest } from './engine/touchtest.js';

const canvas = document.getElementById('screen');
const device = document.getElementById('device');
const led = document.getElementById('led');
const screen = new Screen(canvas);
const input = new Input();
const camera = new Camera(document.getElementById('cam'));
const sfx = new Sfx();
input.attach(device, canvas);

// Lay the camera out sideways, like a real digicam: the screen on the left, the controls on
// the right. A phone held upright gets the same unit turned a quarter (its top at the
// phone's right edge), so it reads once the phone is turned left; with rotation lock on,
// iOS keeps the page upright and the unit simply stays turned. Desktops and tablets show
// the whole camera on a dark table. The screen takes the largest scale that fits, in whole
// device pixels when that doesn't cost much, so every game pixel is the same size; the
// control cluster (designed at a fixed size) is scaled into the space that's left.
//
// The unit sits in the page (position: absolute, sized here) and the page is held at 0,0:
// on iOS 26 and later a position: fixed layer can be drawn in one place while touches are
// read in another, which made the buttons look higher than where they answered.
const bezel = document.getElementById('bezel');
const plate = document.getElementById('plate');
const print = document.getElementById('print');
const padbox = document.getElementById('padbox');
const cluster = document.getElementById('cluster');
const CLUSTER = [236, 282];
const COARSE = matchMedia('(pointer: coarse)'); // a touch screen: phones and tablets
function layout() {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  const vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const framed = Math.min(vw, vh) >= 600 && Math.max(vw, vh) >= 900; // desktop or tablet: the whole camera
  const turned = !framed && vh > vw && COARSE.matches; // an upright phone
  const fw = turned ? vh : vw, fh = turned ? vw : vh; // the unit's own width and height
  device.classList.toggle('framed', framed);
  device.classList.toggle('turned', turned);
  document.body.classList.toggle('framed', framed);
  device.style.width = framed ? '' : `${fw}px`;
  device.style.height = framed ? '' : `${fh}px`;
  device.style.transform = turned ? `translateX(${vw}px) rotate(90deg)` : '';
  input.turned = turned; // the control wheel reads touches in the unit's own frame
  camera.turn = turned; // an upright page still gets upright-phone frames: turn them level
  const px = (v) => parseFloat(v) || 0;
  const cs = getComputedStyle(device);
  const innerW = fw - (framed ? 72 : 0) - px(cs.paddingLeft) - px(cs.paddingRight);
  const innerH = fh - (framed ? 72 : 0) - px(cs.paddingTop) - px(cs.paddingBottom);
  const gapR = px(cs.rowGap), gapC = px(cs.columnGap);
  const chrome = 2 * px(getComputedStyle(bezel).paddingLeft);
  const plateH = plate.offsetHeight, printH = print.offsetHeight;
  const [cw, ch] = CLUSTER;
  const MIN = 0.8; // the controls never shrink below this to make room for the screen
  const availW = innerW - gapC - cw * MIN - chrome;
  const availH = innerH - chrome;
  let s = Math.max(0.4, Math.min(availW / W, availH / H, framed ? 2 : 4));
  const snapped = Math.floor(s * dpr) / dpr;
  if (snapped >= 0.8 * s) s = snapped;
  const lw = Math.floor(W * s), lh = Math.floor(H * s);
  canvas.style.width = `${lw}px`;
  canvas.style.height = `${lh}px`;
  const k = Math.min((innerW - gapC - lw - chrome) / cw, (innerH - plateH - printH - 2 * gapR) / ch);
  const ks = Math.max(0.55, Math.min(framed ? 1.1 : 1.25, k));
  padbox.style.width = `${Math.floor(cw * ks)}px`;
  padbox.style.height = `${Math.floor(ch * ks)}px`;
  cluster.style.transform = `scale(${ks})`;
}
layout();
addEventListener('resize', layout);
addEventListener('orientationchange', () => { setTimeout(layout, 200); setTimeout(layout, 700); });
addEventListener('pageshow', layout);
addEventListener('scroll', () => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); });
if (window.visualViewport) { visualViewport.addEventListener('resize', layout); visualViewport.addEventListener('scroll', layout); }
if (COARSE.addEventListener) COARSE.addEventListener('change', layout);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

// Android keeps an installed copy sideways from the manifest; a page in the browser can ask
// once there's a touch (most browsers only allow it in full screen; iOS never does).
function lockSideways() {
  try { const p = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch { /* not allowed here */ }
}

const params = new URLSearchParams(location.search);
// William's edits from the controller (content/edits.json) go in before anything is drawn.
// ?try=N is the controller's TRY IT: its unsaved draft, a fresh Recorder on shift N, in a save
// of its own (the real game is untouched), never sharing with the index.
const trial = params.has('try') ? { shift: Number(params.get('try')) || 1 } : null;
const content = await loadContent({ draft: !!trial });
const game = new Game({ screen, input, camera, sfx, trial });
game.touchTest = new TouchTest(device); // Settings ▸ DEV: TOUCH TEST
if (params.has('touchtest')) game.touchTest.toggle(true);
if (trial) {
  const tag = document.createElement('div');
  tag.id = 'trytag';
  tag.textContent = `TRYING THE CONTROLLER'S ${content.from === 'draft' ? 'DRAFT' : 'SAVED EDITS'} · SHIFT ${game.day} · NOT YOUR REAL GAME`;
  tag.style.cssText = 'position:fixed;left:50%;top:4px;transform:translateX(-50%);z-index:9;padding:3px 8px;font:11px/1.2 Silkscreen,monospace;color:#fff;background:rgba(198,58,44,.88);border-radius:3px;pointer-events:none;white-space:nowrap';
  document.body.appendChild(tag);
}

// The first touch or key wakes the sound and asks for the camera.
input.onFirstGesture = () => {
  sfx.unlock();
  lockSideways();
  if (!camera.image && camera.state === 'off') camera.start(game.save.settings.facing);
};
input.listeners.push(() => sfx.unlock());

// ?image=URL uses a still picture as the camera (tests, or a look without a camera).
if (params.get('image')) camera.useImage(params.get('image')).catch((e) => console.error('image', e));

// The body colour (Settings ▸ BODY) and the megapixels printed under the screen, which
// follow the sensor the unit has now.
const themeMeta = document.querySelector('meta[name="theme-color"]');
const mpEl = document.querySelector('#mp b');
let shownBody = '', shownMp = '';
function dressBody() {
  const body = game.save.settings.body === 'graphite' ? 'graphite' : 'silver';
  if (body !== shownBody) {
    shownBody = body;
    device.dataset.body = body;
    if (themeMeta) themeMeta.content = body === 'graphite' ? '#3a3b3f' : '#cfd2d6';
  }
  const s = game.sensor, mp = ((s.w * s.h) / 1e6).toPrecision(2);
  if (mp !== shownMp) { shownMp = mp; mpEl.textContent = mp; }
}

let last = performance.now();
let fault = null;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(dt);
  try {
    game.update(dt);
    game.draw();
  } catch (e) {
    console.error(e);
    if (!fault) { fault = document.createElement('div'); fault.id = 'fault'; document.body.appendChild(fault); }
    fault.textContent = `UNIT FAULT: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e}`;
  }
  screen.present();
  input.endFrame();
  dressBody();
  led.classList.toggle('on', game.track.faces.length > 0 || game.stateName === 'develop');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Hooks for tests and for driving the unit from hardware (see README).
window.__clearance = {
  game, camera, input, screen, content,
  press(b) { input.press(b); setTimeout(() => input.release(b), 80); },
  tap() { input.tapped = true; },
};
