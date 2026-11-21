// Boot: wire the screen, buttons, camera and sound to the game and run the frame loop.
import { Screen, W, H } from './engine/screen.js';
import { Input } from './engine/input.js';
import { Camera } from './engine/camera.js';
import { Sfx } from './engine/audio.js';
import { Game } from './game/game.js';

const canvas = document.getElementById('screen');
const device = document.getElementById('device');
const led = document.getElementById('led');
const screen = new Screen(canvas);
const input = new Input();
const camera = new Camera(document.getElementById('cam'));
const sfx = new Sfx();
input.attach(device, canvas);

const params = new URLSearchParams(location.search);
const game = new Game({ screen, input, camera, sfx });

// The first touch or key wakes the sound and asks for the camera.
input.onFirstGesture = () => {
  sfx.unlock();
  if (!camera.image && camera.state === 'off') camera.start(game.save.settings.facing);
};
input.listeners.push(() => sfx.unlock());

// ?image=URL uses a still picture as the camera (tests, or a look without a camera).
if (params.get('image')) camera.useImage(params.get('image')).catch((e) => console.error('image', e));

// Lay the camera out for the window: upright phones get the controls under the screen;
// sideways phones and desktops get the screen on the left and the controls on the right,
// like a real digicam. The screen takes the largest scale that fits, in whole device pixels
// when that doesn't cost much, so every game pixel is the same size; the control cluster
// (designed at a fixed size) is scaled into the space that's left.
const bezel = document.getElementById('bezel');
const plate = document.getElementById('plate');
const print = document.getElementById('print');
const padbox = document.getElementById('padbox');
const cluster = document.getElementById('cluster');
const CLUSTER = { port: [340, 196], land: [236, 282] };
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const land = vw > vh;
  const framed = Math.min(vw, vh) >= 600 && Math.max(vw, vh) >= 900; // desktop or tablet: the whole camera
  device.classList.toggle('land', land);
  device.classList.toggle('port', !land);
  device.classList.toggle('framed', framed);
  document.body.classList.toggle('framed', framed);
  const px = (v) => parseFloat(v) || 0;
  const cs = getComputedStyle(device);
  const innerW = vw - (framed ? 72 : 0) - px(cs.paddingLeft) - px(cs.paddingRight);
  const innerH = vh - (framed ? 72 : 0) - px(cs.paddingTop) - px(cs.paddingBottom);
  const gapR = px(cs.rowGap), gapC = px(cs.columnGap);
  const chrome = 2 * px(getComputedStyle(bezel).paddingLeft);
  const plateH = plate.offsetHeight, printH = print.offsetHeight;
  const [cw, ch] = CLUSTER[land ? 'land' : 'port'];
  const MIN = 0.8; // the controls never shrink below this to make room for the screen
  const availW = land ? innerW - gapC - cw * MIN - chrome : innerW - chrome;
  const availH = land ? innerH - chrome : innerH - plateH - printH - 3 * gapR - ch * MIN - chrome;
  let s = Math.max(0.4, Math.min(availW / W, availH / H, framed ? 2 : 4));
  const snapped = Math.floor(s * dpr) / dpr;
  if (snapped >= 0.8 * s) s = snapped;
  const lw = Math.floor(W * s), lh = Math.floor(H * s);
  canvas.style.width = `${lw}px`;
  canvas.style.height = `${lh}px`;
  const k = land
    ? Math.min((innerW - gapC - lw - chrome) / cw, (innerH - plateH - printH - 2 * gapR) / ch)
    : Math.min(innerW / cw, (innerH - plateH - printH - 3 * gapR - lh - chrome) / ch);
  const ks = Math.max(0.55, Math.min(framed ? 1.1 : 1.25, k));
  padbox.style.width = `${Math.floor(cw * ks)}px`;
  padbox.style.height = `${Math.floor(ch * ks)}px`;
  cluster.style.transform = `scale(${ks})`;
}
layout();
addEventListener('resize', layout);
addEventListener('orientationchange', () => { setTimeout(layout, 200); setTimeout(layout, 700); });
if (window.visualViewport) visualViewport.addEventListener('resize', layout);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

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
  game, camera, input, screen,
  press(b) { input.press(b); setTimeout(() => input.release(b), 80); },
  tap() { input.tapped = true; },
};
