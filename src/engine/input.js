// The unit's seven buttons: SHUTTER, the D-pad (UP DOWN LEFT RIGHT), OK (the round button)
// and SELECT. They arrive from the on-screen buttons, the keyboard, a USB gamepad, or the
// hardware later (GPIO buttons can be wired as these same keys; see HARDWARE in README).

export const BUTTONS = ['UP', 'DOWN', 'LEFT', 'RIGHT', 'OK', 'SELECT', 'SHUTTER'];

const KEYS = {
  ArrowUp: 'UP', KeyW: 'UP', ArrowDown: 'DOWN', KeyS: 'DOWN',
  ArrowLeft: 'LEFT', KeyA: 'LEFT', ArrowRight: 'RIGHT', KeyD: 'RIGHT',
  Enter: 'OK', NumpadEnter: 'OK', KeyZ: 'OK', KeyK: 'OK',
  Space: 'SHUTTER', KeyC: 'SHUTTER', KeyJ: 'SHUTTER',
  Escape: 'SELECT', Backspace: 'SELECT', Tab: 'SELECT', KeyX: 'SELECT', KeyM: 'SELECT', ShiftLeft: 'SELECT', ShiftRight: 'SELECT',
};
const REPEATS = new Set(['UP', 'DOWN', 'LEFT', 'RIGHT']);

export class Input {
  constructor() {
    this.down = {};
    this.pressed = {};
    this.repeat = {};
    this.tapped = false; // a tap on the screen itself
    this.onFirstGesture = null;
    this.gamepadPrev = {};
    this.listeners = [];
  }

  attach(root, screenEl) {
    window.addEventListener('keydown', (e) => {
      const b = KEYS[e.code];
      if (!b || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      this.gesture();
      if (!e.repeat) this.press(b);
    });
    window.addEventListener('keyup', (e) => { const b = KEYS[e.code]; if (b) this.release(b); });
    window.addEventListener('blur', () => { for (const b of BUTTONS) this.down[b] = false; });

    for (const el of root.querySelectorAll('[data-btn]')) {
      const b = el.dataset.btn;
      const on = (e) => { e.preventDefault(); this.gesture(); el.classList.add('down'); this.press(b); try { el.setPointerCapture(e.pointerId); } catch {} };
      const off = () => { el.classList.remove('down'); this.release(b); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    if (screenEl) {
      screenEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.gesture(); this.tapped = true; });
      screenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  gesture() {
    if (this.onFirstGesture) { const f = this.onFirstGesture; this.onFirstGesture = null; f(); }
    for (const f of this.listeners) f();
  }

  press(b) {
    if (this.down[b]) return;
    this.down[b] = true;
    this.pressed[b] = true;
    this.repeat[b] = 0.32;
  }
  release(b) { this.down[b] = false; }

  update(dt) {
    for (const b of REPEATS) {
      if (!this.down[b]) continue;
      this.repeat[b] -= dt;
      if (this.repeat[b] <= 0) { this.pressed[b] = true; this.repeat[b] = 0.075; }
    }
    this.pollGamepad();
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && [...pads].find(Boolean);
    if (!pad) return;
    const ax = pad.axes || [];
    const st = {
      UP: btn(pad, 12) || ax[1] < -0.6, DOWN: btn(pad, 13) || ax[1] > 0.6,
      LEFT: btn(pad, 14) || ax[0] < -0.6, RIGHT: btn(pad, 15) || ax[0] > 0.6,
      OK: btn(pad, 0), SELECT: btn(pad, 8) || btn(pad, 1), SHUTTER: btn(pad, 5) || btn(pad, 7) || btn(pad, 2),
    };
    for (const b of BUTTONS) {
      if (st[b] && !this.gamepadPrev[b]) this.press(b);
      if (!st[b] && this.gamepadPrev[b]) this.release(b);
      this.gamepadPrev[b] = st[b];
    }
  }

  hit(b) { return !!this.pressed[b]; }
  // OK-like: the round button or a tap on the screen.
  confirm() { return !!this.pressed.OK || this.tapped; }
  any() { return BUTTONS.some((b) => this.pressed[b]) || this.tapped; }
  endFrame() { this.pressed = {}; this.tapped = false; }
}

const btn = (pad, i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
