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
    this.els = {}; // on-screen buttons, to show them pressed whatever pressed them
    this.wheel = null;
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
    window.addEventListener('blur', () => { for (const b of BUTTONS) this.release(b); });

    // OK, SELECT and SHUTTER: one element each.
    for (const el of root.querySelectorAll('[data-btn]')) {
      const b = el.dataset.btn;
      this.els[b] = el;
      const on = (e) => { e.preventDefault(); e.stopPropagation(); this.gesture(); this.press(b); try { el.setPointerCapture(e.pointerId); } catch {} };
      const off = () => this.release(b);
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('lostpointercapture', off);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    const wheel = root.querySelector('#wheel');
    if (wheel) this.attachWheel(wheel);
    if (screenEl) {
      screenEl.addEventListener('pointerdown', (e) => { e.preventDefault(); this.gesture(); this.tapped = true; });
      screenEl.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  // The control wheel is one round 4-way rocker. The angle of the touch from the centre
  // picks the direction (four 90° sectors, no dead corners), and sliding the thumb round
  // the ring rolls from one direction to the next, like the real part.
  attachWheel(wheel) {
    this.wheel = wheel;
    let pid = null, dir = null;
    const pick = (e) => {
      const r = wheel.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < r.width * 0.12) return dir; // over the middle: keep what's held
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : (dy > 0 ? 'DOWN' : 'UP');
    };
    const set = (d) => {
      if (d === dir) return;
      if (dir) this.release(dir);
      dir = d;
      if (d) this.press(d);
    };
    wheel.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-btn]')) return; // OK, in the middle
      e.preventDefault();
      if (pid !== null) return; // one thumb at a time
      pid = e.pointerId;
      this.gesture();
      try { wheel.setPointerCapture(pid); } catch {}
      set(pick(e));
    });
    wheel.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(pick(e)); });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; set(null); };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);
    wheel.addEventListener('lostpointercapture', end);
    wheel.addEventListener('contextmenu', (e) => e.preventDefault());
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
    this.show(b, true);
  }
  release(b) {
    if (!this.down[b]) return;
    this.down[b] = false;
    this.show(b, false);
  }

  // Show a button pressed on screen, whether a finger, a key, a gamepad or a test pressed it.
  show(b, on) {
    if (REPEATS.has(b)) {
      const w = this.wheel;
      if (!w) return;
      if (on) w.dataset.dir = b;
      else if (w.dataset.dir === b) delete w.dataset.dir;
      return;
    }
    const el = this.els[b];
    if (el) el.classList.toggle('is-pressed', on);
  }

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
