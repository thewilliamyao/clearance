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

// Size the screen to the largest scale that fits, in whole device pixels where possible
// so every game pixel is the same size.
function layout() {
  const dpr = window.devicePixelRatio || 1;
  const cs = getComputedStyle(device);
  const innerW = device.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const innerH = device.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const landscape = matchMedia('(orientation: landscape) and (max-height: 560px)').matches;
  const availW = (landscape ? innerW - 2 * 170 : innerW) - 20;
  const availH = (landscape ? innerH : innerH - 200 - 60) - 20;
  let s = Math.max(0.5, Math.min(availW / W, availH / H));
  const k = Math.floor(s * dpr);
  if (k >= 2) s = k / dpr;
  canvas.style.width = `${Math.floor(W * s)}px`;
  canvas.style.height = `${Math.floor(H * s)}px`;
}
layout();
addEventListener('resize', layout);
addEventListener('orientationchange', () => setTimeout(layout, 200));

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
