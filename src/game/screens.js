// Every screen of the unit. Each has enter(arg, prev), update(dt) and draw().
import { W, H, hex } from '../engine/screen.js';
import { THEMES } from '../engine/palette.js';
import { fitText } from '../engine/font.js';
import { desk, paper, rule, seal, header, stamp, list, notice, bar, dim, hints, drawText, textWidth, wrapText, LINE_H } from './ui.js';
import { SENSORS, TONES, LENSES, FILMS } from './tiers.js';
import { LAST_DAY, shiftLine } from './days.js';
import { REQUESTS, requestText, requestShort, lookFor, liveNeed, LEARNED_LABEL } from './requests.js';
import { t } from './text.js';
import { heading, printColors, dayText, indexNo, PRINT_W, PRINT_H } from './shared-index.js';
import { SHOP } from './game.js';
import { MODULES, MODULE_ORDER, RUNTIME_MB } from '../vision/modules.js';
import { analyzeCV, FOCUS } from '../vision/cv.js';

function halve(rgba, w, h) {
  const sw = w >> 1, sh = h >> 1, out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const o = (y * sw + x) * 4, a = (2 * y * w + 2 * x) * 4, b = a + 4, c = a + w * 4, d = c + 4;
    for (let k = 0; k < 3; k++) out[o + k] = (rgba[a + k] + rgba[b + k] + rgba[c + k] + rgba[d + k]) >> 2;
    out[o + 3] = 255;
  }
  return out;
}

const MARK_RGB = { red: '#c63a2c', orange: '#d9822b', yellow: '#e2c23a', green: '#3f9a4f', blue: '#3b6fd1', purple: '#7d4fb3', pink: '#d46a9b', white: '#f2f2ee', gray: '#8a8a8a', black: '#111111' };
const pad3 = (n) => String(n).padStart(3, '0');
const blink = (t, rate = 2) => Math.floor(t * rate) % 2 === 0;
const box = (b) => [Math.round(b[0] * W), Math.round(b[1] * H), Math.round(b[2] * W), Math.round(b[3] * H)];

// A label tag above a box.
function tag(scr, text, x, y, fg, bg) {
  const w = textWidth(text) + 4;
  x = Math.max(0, Math.min(W - w, x));
  const ty = y - 10 < 12 ? y + 1 : y - 10;
  scr.rect(x, ty, w, 10, bg);
  drawText(scr, text, x + 2, ty + 2, fg);
}

// Paper line with an ink shadow, so it reads on light and dark.
function shadowRect(scr, x, y, w, h, P, dash) {
  if (dash) {
    scr.poly([[x + 1, y + 1], [x + w + 1, y + 1], [x + w + 1, y + h + 1], [x + 1, y + h + 1]], P.ink, [3, 2]);
    scr.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], P.paper, [3, 2]);
  } else { scr.frame(x + 1, y + 1, w, h, P.ink); scr.frame(x, y, w, h, P.paper); }
}
function shadowBrackets(scr, x, y, w, h, P, len = 5) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]) scr.brackets(x + dx, y + dy, w, h, P.ink, len);
  scr.brackets(x, y, w, h, P.paper, len);
}

// =========================================================================== TITLE
export class Title {
  constructor(g) { this.g = g; this.sel = 0; this.t = 0; }
  enter() { this.t = 0; this.sel = 0; this.items = this.makeItems(); }
  makeItems() {
    const s = this.g.save, items = [];
    if (s.phase === 'ended') items.push({ id: 'again', label: t('title.again') });
    else items.push({ id: 'go', label: s.phase === 'new' ? t('title.report') : t('title.resume', { SHIFT: s.day }) });
    if (s.phase !== 'new' && s.phase !== 'ended') items.push({ id: 'again', label: t('title.newRecorder') });
    items.push({ id: 'lab', label: t('menu.lab') });
    if (this.g.index.connected) items.push({ id: 'index', label: t('menu.index') }); // once the shared index exists
    items.push({ id: 'settings', label: t('menu.settings') });
    return items;
  }
  update(dt) {
    const g = this.g, i = g.input;
    this.t += dt;
    if (i.hit('UP')) { this.sel = (this.sel + this.items.length - 1) % this.items.length; g.sfx.move(); }
    if (i.hit('DOWN')) { this.sel = (this.sel + 1) % this.items.length; g.sfx.move(); }
    if (i.hit('OK') || i.hit('SHUTTER') || i.tapped) {
      if (this.t < 1.2) { this.t = 1.6; return; }
      this.choose(this.items[this.sel].id);
    }
  }
  choose(id) {
    const g = this.g;
    g.sfx.confirm();
    if (id === 'lab') return g.go('lab');
    if (id === 'index') return g.go('index', 'title');
    if (id === 'settings') return g.go('settings');
    if (id === 'again' && g.save.phase !== 'ended' && g.save.phase !== 'new') {
      return g.go('confirm', { text: t('title.startOver'), yes: t('title.startOverYes'), no: t('title.startOverNo'), onYes: () => { g.newGame(); g.go('title'); }, onNo: () => g.go('title') });
    }
    if (id === 'again') g.newGame();
    g.resume();
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    if (g.camera.ready) g.renderLive(1, SENSORS[0], TONES[0]); else g.noSignal();
    dim(scr, P);
    seal(scr, W / 2, 26, 17, P.ink, P.paper);
    const word = t('title.word'), scale = 4, tw = textWidth(word, scale), x0 = (W - tw) / 2;
    scr.rect(x0 - 6, 48, tw + 12, 36, P.paper);
    drawText(scr, word, x0, 52, P.ink, { scale });
    // The title starts redacted; the bars lift one letter at a time.
    let cx = x0;
    for (let k = 0; k < word.length; k++) {
      const w = textWidth(word[k], scale);
      if (this.t < 0.35 + k * 0.11) scr.rect(cx - 1, 50, w + 2, 32, P.ink);
      cx += w + scale;
    }
    drawText(scr, t('title.subtitle'), W / 2, 89, P.paper, { align: 'center', bg: P.ink, pad: 2 });
    const mw = 150, mh = this.items.length * 12 + 10, mx = (W - mw) / 2, my = 112;
    paper(scr, mx, my, mw, mh, P);
    list(scr, this.items, this.sel, mx + 2, my + 7, mw - 4, P, 12);
    const cam = g.camera.state;
    const status = cam === 'live' ? '' : cam === 'asking' ? t('title.camWaiting') : cam === 'off' ? t('title.camOff') : g.camera.error;
    if (status) drawText(scr, status, W / 2, 200, P.paper, { align: 'center', bg: P.ink });
    hints(scr, t('title.hints'), P, 228, P.paper);
    drawText(scr, t('global.unit'), W - 4, 228, P.mid, { align: 'right' });
  }
}

// =========================================================================== NO CAMERA
export class NoCamera {
  constructor(g) { this.g = g; }
  update() {
    const i = this.g.input;
    if (i.hit('OK') || i.hit('SHUTTER') || i.tapped) this.g.camera.start(this.g.save.settings.facing).then((ok) => ok && this.g.resume());
    if (i.hit('SELECT')) this.g.go('title');
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    desk(scr, P);
    paper(scr, 20, 30, 280, 170, P);
    header(scr, 28, 36, 264, t('nocam.title'), P);
    const lines = wrapText(`${g.camera.error || t('nocam.failed')} ${t('nocam.text')}`, 256);
    lines.forEach((l, k) => drawText(scr, l, 32, 66 + k * LINE_H, P.ink));
    hints(scr, t('nocam.hints'), P, 186);
  }
}

// =========================================================================== WORK ORDER
export class Order {
  constructor(g) { this.g = g; this.t = 0; }
  enter(arg) { this.t = 0; this.view = arg === 'view'; this.g.installModules(); }
  update(dt) {
    const g = this.g, i = g.input;
    const before = this.chars();
    this.t += dt;
    if (this.chars() > before && Math.floor(this.t * 40) % 2 === 0) g.sfx.type();
    const done = this.view || this.t > this.memoTime() + 0.6;
    if (!done && (i.hit('OK') || i.tapped || i.hit('SHUTTER'))) { this.t = this.memoTime() + 0.6; g.sfx.stamp(); return; }
    if (done && (i.hit('OK') || i.tapped || i.hit('SHUTTER'))) {
      g.sfx.confirm();
      g.save.phase = 'field'; g.persist();
      g.go('field');
    }
    if (this.view && i.hit('SELECT')) g.go('field');
  }
  memoTime() { return shiftLine(this.g.dayDef, 'memo').length / 70; }
  chars() { return this.view ? 1e9 : Math.floor(this.t * 70); }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, d = g.dayDef, o = g.order;
    desk(scr, P);
    paper(scr, 10, 6, 300, 228, P);
    const full = shiftLine(d, 'memo'), note = shiftLine(d, 'issueNote');
    header(scr, 16, 10, 288, t('order.title', { SHIFT: d.n, SHIFTS: LAST_DAY, NAME: shiftLine(d, 'code') }), P);
    let y = 36;
    const memo = full.slice(0, this.chars());
    for (const l of wrapText(memo, 284)) { drawText(scr, l, 18, y, P.ink); y += LINE_H; }
    y = Math.max(y, 36 + wrapText(full, 284).length * LINE_H) + 3;
    const show = this.view || this.t > this.memoTime();
    if (show && note) { drawText(scr, '▸ ' + note, 18, y, P.paper, { bg: P.ink, pad: 2 }); y += 13; }
    if (show) {
      const mods = d.modules.map((id) => {
        const s = g.modules.st[id];
        return MODULES[id].name + (s.state === 'loading' ? ` ${Math.round(s.progress * 100)}%` : s.state === 'error' ? ' FAULT' : '');
      });
      for (const l of wrapText(t('order.modules', { LIST: mods.join(' · ') }), 284)) { drawText(scr, l, 18, y, P.ink); y += LINE_H; }
      y += 2; rule(scr, 16, 304, y, P); y += 5;
      drawText(scr, t('order.requests', { QUOTA: o.quota, N: o.requests.length }), 18, y, P.ink); y += 12;
      for (const r of o.requests) {
        const def = REQUESTS[r.key];
        drawText(scr, r.done ? '■' : r.withdrawn ? '×' : '□', 20, y, P.ink);
        const tw = drawText(scr, fitText(requestText(r), 200), 30, y, r.withdrawn ? P.mid : P.ink);
        if (r.withdrawn) scr.hline(29, 30 + tw, y + 3, P.mid);
        drawText(scr, r.done ? t('order.filed', { MERIT: r.merit }) : r.withdrawn ? t('order.withdrawn') : def && def.merit ? String(def.merit) : '—', 300, y, P.ink, { align: 'right' });
        y += 11;
      }
      y += 2; rule(scr, 16, 304, y, P); y += 5;
      drawText(scr, t('order.film', { FILM: o.film, MERIT: g.save.merit }), 18, y, P.ink);
      if (blink(g.t, 1.5)) drawText(scr, this.view ? t('order.back') : t('order.accept'), 18, 222, P.ink);
    }
    if (show && !this.view) stamp(scr, [[t('order.stamp'), 2]], 266, 216, P.stamp, { angle: -0.14, seed: d.n, pad: 3, reveal: Math.min(1, (this.t - this.memoTime()) * 5) });
  }
}

// =========================================================================== VIEWFINDER
// The work order is a list in the top left corner. ▴ ▾ moves the marker to the request
// you're aiming at (it wins if a photo matches more than one), ◂ ▸ zooms out and in like a
// W/T lever, OK hides the overlays, SELECT opens the menu. Once the quota is met the Office
// pops up a bubble offering to end the shift.
const ZOOMS = [1, 1.5, 2, 3, 4];
export class Viewfinder {
  constructor(g) { this.g = g; this.focus = 0; this.zoom = 1; this.hintT = 0; this.zoomT = 0; this.bubble = null; this.live = null; this.liveT = 0; this.filmFlash = 0; }
  enter(arg, prev) {
    const g = this.g;
    this.zoom = Math.min(this.zoom, g.maxZoom);
    this.fixFocus(0);
    this.bubble = null;
    this.live = null; this.liveT = 0.15;
    // Back from a photo, so one less frame: the FILM box flashes white, or red once fewer are
    // left than the open requests + 2.
    const o = g.order, used = prev === 'develop' && o && o.film > 0;
    this.filmRed = !!(used && o.film < this.open().length + 2);
    this.filmFlash = used ? (this.filmRed ? 1.5 : 1.0) : 0;
    if (arg === 'quota' && g.order && !g.order.closed) this.popBubble('quota');
    this.hintT = prev === 'order' && g.day === 1 && !g.order.shots ? 7 : 0; // first shift only
    if (g.day === LAST_DAY && g.save.selfMisses >= 2) g.toast(g.save.selfMisses >= 4 ? t('field.selfHint2') : t('field.selfHint'), 4);
    g.installModules();
    g.wake();
  }
  open() { return this.g.order ? this.g.order.requests.map((r, i) => (r.done || r.withdrawn ? -1 : i)).filter((i) => i >= 0) : []; }
  fixFocus(dir) {
    const open = this.open();
    if (!open.length) { this.focus = 0; return; }
    let k = open.indexOf(this.focus);
    if (k < 0) k = 0; else k = (k + dir + open.length) % open.length;
    this.focus = open[k];
  }
  popBubble(kind) {
    this.bubble = { kind, t: 0, sel: 0 };
    this.hintT = 0;
    this.g.sfx.alarm();
    this.g.buzz([20, 60, 20]);
  }
  update(dt) {
    const g = this.g, i = g.input;
    this.hintT = Math.max(0, this.hintT - dt);
    this.zoomT = Math.max(0, this.zoomT - dt);
    this.filmFlash = Math.max(0, (this.filmFlash || 0) - dt);
    g.updateTracking();
    if (this.bubble) return this.updateBubble(dt);
    this.scan(dt);
    if (i.hit('UP')) { this.fixFocus(-1); this.live = null; this.liveT = 0.05; g.sfx.move(); }
    if (i.hit('DOWN')) { this.fixFocus(1); this.live = null; this.liveT = 0.05; g.sfx.move(); }
    if (i.hit('LEFT') || i.hit('RIGHT')) {
      if (g.maxZoom <= 1) { g.toast(t('field.noZoom')); g.sfx.deny(); }
      else {
        const zs = ZOOMS.filter((z) => z <= g.maxZoom);
        const k = Math.max(0, Math.min(zs.length - 1, zs.indexOf(this.zoom) + (i.hit('RIGHT') ? 1 : -1)));
        this.zoom = zs[k];
        this.zoomT = 1.4;
        g.sfx.move();
      }
    }
    // OK hides and shows the bottom bar; the request list always stays.
    if (i.hit('OK')) { g.save.settings.hud = (g.save.settings.hud + 1) % 2; g.persist(); g.sfx.blip(); }
    if (i.hit('SELECT')) { g.scr.snapshot(); g.sfx.blip(); return g.go('menu'); }
    if (i.hit('SHUTTER') || (i.tapped && g.save.settings.tapShoot)) this.shoot();
  }
  // The selected request: what to look for, and (for the plain-code checks) its own judge run
  // on the live picture a few times a second, so the Recorder sees what the unit sees.
  selected() { const o = this.g.order, r = o && o.requests[this.focus]; return r && !r.done && !r.withdrawn ? r : null; }
  scan(dt) {
    const g = this.g, r = this.selected();
    this.liveT -= dt;
    if (this.liveT > 0) return;
    this.liveT = 0.25;
    const need = r && liveNeed(r.key);
    if (!need || !g.lastFrame || !g.camera.ready) { this.live = null; return; }
    try {
      const big = g.lastFrame, small = halve(big, W, H);
      const cv = analyzeCV(small, W / 2, H / 2, { rgba: big, w: W, h: H }, need);
      const v = REQUESTS[r.key].judge({ cv }, {});
      this.live = { key: r.key, ok: v.ok, why: v.why, marks: v.marks || [], score: v.score, cv };
    } catch (e) { console.warn('live check', e); this.live = null; }
  }
  // The bubble: END SHIFT or KEEP SHOOTING. SELECT or the shutter also keeps shooting.
  updateBubble(dt) {
    const g = this.g, i = g.input, b = this.bubble;
    b.t += dt;
    if (b.t < 0.3) return; // let it land before it takes presses
    const choices = b.kind === 'quota' ? 2 : 1;
    if (choices > 1 && (i.hit('LEFT') || i.hit('RIGHT') || i.hit('UP') || i.hit('DOWN'))) { b.sel = 1 - b.sel; g.sfx.move(); }
    if (i.hit('SELECT') || i.hit('SHUTTER')) {
      if (choices > 1) { this.bubble = null; g.sfx.blip(); }
      else if (i.hit('SELECT')) { g.scr.snapshot(); g.sfx.blip(); g.go('menu'); }
      return;
    }
    if (i.hit('OK') || i.tapped) {
      if (b.sel === 0) { g.sfx.confirm(); g.closeShift(); return g.go('report'); }
      this.bubble = null; g.sfx.blip();
    }
  }
  shoot() {
    const g = this.g, o = g.order;
    if (!o) return;
    if (o.film <= 0) { g.sfx.deny(); this.popBubble('film'); return; }
    if (!g.camera.ready) { g.sfx.deny(); g.toast(t('field.noPicture')); return; }
    const photo = g.capture(this.zoom);
    if (!photo) return;
    g.go('develop', photo);
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    g.renderLive(this.zoom);
    // Live tracking, only for what the selected request is about.
    const sel = this.selected(), look = sel ? lookFor(sel.key) : { labels: null, faces: true };
    if (look.labels) g.track.objects.filter((ob) => look.labels.includes(ob.label)).slice(0, 8).forEach((ob) => { if (ob.score < 0.4) return; const [x, y, w, h] = box(ob.box); shadowRect(scr, x, y, w, h, P, true); tag(scr, ob.label.toUpperCase(), x, y, P.ink, P.paper); });
    if (look.faces) g.track.faces.slice(0, 6).forEach((f, k) => { const [x, y, w, h] = box(f.box); shadowBrackets(scr, x, y, w, h, P, 6); tag(scr, t('verdict.subjectN', { N: String(k + 1).padStart(2, '0') }), x, y, P.paper, P.ink); });
    if (this.live && sel && this.live.key === sel.key) this.drawLiveMarks();
    // Focus brackets.
    const fx = FOCUS.x0 * W, fy = FOCUS.y0 * H, fw = (FOCUS.x1 - FOCUS.x0) * W, fh = (FOCUS.y1 - FOCUS.y0) * H;
    shadowBrackets(scr, fx, fy, fw, fh, P, 10);
    scr.rect(W / 2 - 4, H / 2 - 1, 9, 3, P.ink); scr.rect(W / 2 - 1, H / 2 - 4, 3, 9, P.ink);
    scr.hline(W / 2 - 3, W / 2 + 3, H / 2, P.paper); scr.vline(W / 2, H / 2 - 3, H / 2 + 3, P.paper);
    this.tasks(); // always on screen
    if (g.save.settings.hud === 0) this.hud();
    else if (this.filmFlash > 0) this.filmBox(true); // the bar is hidden, but a flash still shows
    if (this.zoomT > 0 && g.maxZoom > 1) this.zoomBar();
    if (this.bubble) return this.drawBubble();
    if (this.hintT > 0) notice(scr, t('field.firstHint'), P, 150);
    for (const x of g.toasts) notice(scr, x.text, P, 104);
  }
  // FILM left/max, bottom left. After a photo it flashes a few times: white, or the Office's
  // red when film is short (see enter); at 2 or less the number blinks red. Returns its width.
  filmBox(alone = false) {
    const g = this.g, scr = g.scr, P = g.P, o = g.order;
    const film = o ? o.film : 0, max = o ? o.filmMax || Math.max(o.film, g.filmSize || 0) : g.filmSize || 0;
    const text = t('field.film', { N: String(film).padStart(2, '0'), MAX: String(max).padStart(2, '0') }), w = textWidth(text);
    const flash = this.filmFlash > 0 && Math.floor(this.filmFlash * 6) % 2 === 0;
    if (alone && !flash) return w;
    scr.rect(1, H - 11, w + 6, 11, flash ? (this.filmRed ? P.stamp : P.paper) : P.ink);
    drawText(scr, text, 4, H - 9, flash ? (this.filmRed ? P.paper : P.ink) : film <= 2 && blink(g.t, 3) ? P.stamp : P.paper);
    return w;
  }
  hud() {
    const g = this.g, scr = g.scr, P = g.P;
    scr.rect(0, H - 11, W, 11, P.ink);
    const fw = this.filmBox();
    drawText(scr, t('field.merit', { MERIT: g.save.merit }), 4 + fw + 10, H - 9, P.paper);
    let x = W - 4;
    const mods = g.enabledModules();
    for (let k = mods.length - 1; k >= 0; k--) {
      const s = g.modules.st[mods[k]], code = MODULES[mods[k]].code;
      const txt = s.state === 'loading' ? `${code}${Math.round(s.progress * 100)}%` : s.state === 'error' ? `${code}!` : code;
      x -= drawText(scr, txt, x, H - 9, s.state === 'ready' ? P.paper : P.mid, { align: 'right' }) + 4;
    }
    if (this.zoom > 1) drawText(scr, `${this.zoom}×`, x - 2, H - 9, P.paper, { align: 'right' });
    if (!this.bubble && g.track.faces.length && blink(g.t, 1.2)) scr.disc(W - 6, 6, 2, P.stamp);
  }
  // What the live check found, drawn thin in the Office's red: the shape outline or the
  // symmetry axis. (The colour count and the verdict are on the line under the task list.)
  drawLiveMarks() {
    const scr = this.g.scr, red = this.g.P.stamp;
    for (const m of this.live.marks) {
      if (m.t === 'shape') {
        const pts = m.shape.hull.map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);
        scr.poly(pts, red, this.live.ok ? undefined : [3, 2]);
        if (this.live.ok) scr.poly(pts.map(([x, y]) => [x + 1, y]), red);
      } else if (m.t === 'axis' && this.live.cv.sym.score > 0.5) {
        const x = Math.round(m.x * W);
        scr.line(x, 14, x, H - 14, red, [4, 3]);
      }
    }
  }
  // Every request of the work order, top left: □ open, ▸ the one you're aiming at, ✓ filed.
  // Under it, the live reading for the selected one.
  tasks() {
    const g = this.g, scr = g.scr, P = g.P, o = g.order;
    if (!o) { drawText(scr, t('field.noOrder'), 4, 3, P.paper, { bg: P.ink, pad: 2 }); return; }
    const rs = o.requests, filed = g.filed(), met = filed >= o.quota;
    const head = met ? t('field.quotaMet', { FILED: filed }) : t('field.toFile', { LEFT: o.quota - filed, FILED: filed, QUOTA: o.quota });
    const labels = rs.map((r) => fitText(requestShort(r), 170));
    const w = Math.max(textWidth(head) + 9, ...labels.map((l) => textWidth(l) + 19));
    const x = 2, y = 2, h = 14 + rs.length * 9;
    scr.rect(x, y, w, h, P.ink);
    drawText(scr, head, x + 4, y + 3, met ? P.stamp : P.paper);
    for (let k = x + 3; k < x + w - 3; k += 2) scr.pset(k, y + 11, P.mid);
    rs.forEach((r, k) => {
      const ry = y + 14 + k * 9, shut = r.done || r.withdrawn, on = !shut && k === this.focus;
      if (on) scr.rect(x + 1, ry - 1, w - 2, 9, P.paper);
      const fg = on ? P.ink : shut ? P.mid : P.paper;
      drawText(scr, r.done ? '✓' : r.withdrawn ? '×' : on ? '▸' : '□', x + 4, ry, fg);
      const tw = drawText(scr, labels[k], x + 14, ry, fg);
      if (shut) scr.hline(x + 13, x + 14 + tw, ry + 3, P.mid);
    });
    const sel = this.selected(), lv = this.live;
    if (sel && lv && lv.key === sel.key) {
      const text = fitText(lv.ok ? t('field.shoot', { WHAT: lv.why.split(' · ')[0] }) : lv.why, W - 8);
      drawText(scr, text, x + 2, y + h + 3, lv.ok ? P.paper : P.paper, { bg: lv.ok ? P.stamp : P.ink, pad: 2 });
    }
  }
  // W ──●── T, while zooming.
  zoomBar() {
    const g = this.g, scr = g.scr, P = g.P;
    const zs = ZOOMS.filter((z) => z <= g.maxZoom), k = Math.max(0, zs.indexOf(this.zoom));
    const x0 = 124, x1 = 196, y = H - 22, at = (j) => Math.round(x0 + (j / (zs.length - 1)) * (x1 - x0));
    scr.rect(x0 - 17, y - 6, x1 - x0 + 34, 13, P.ink);
    drawText(scr, 'W', x0 - 13, y - 3, P.paper);
    drawText(scr, 'T', x1 + 7, y - 3, P.paper);
    scr.hline(x0, x1, y, P.mid);
    zs.forEach((z, j) => scr.vline(at(j), y - 1, y + 1, P.paper));
    scr.hline(x0, at(k), y, P.paper);
    scr.rect(at(k) - 2, y - 3, 5, 7, P.paper);
    drawText(scr, `${this.zoom}×`, W / 2, y - 16, P.paper, { align: 'center', bg: P.ink, pad: 2 });
  }
  // The Office pipes up from the top right corner: a speech bubble with its seal.
  drawBubble() {
    const g = this.g, scr = g.scr, P = g.P, b = this.bubble, o = g.order;
    const quota = b.kind === 'quota';
    const title = quota ? t('field.quotaTitle') : t('field.filmTitle');
    const body = quota
      ? t('field.quotaBody', { FILED: g.filed(), N: o.requests.length, BONUS: Math.round(o.earned * 0.2) })
      : t('field.filmBody');
    const lines = wrapText(body, 172);
    const w = 190, h = 31 + lines.length * LINE_H + 19;
    const x = W - w - 5, y = 31, sx = W - 15, sy = 13;
    // Pop: the bubble grows out of the seal with a little overshoot.
    const k = Math.min(1, b.t / 0.16), e = 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
    seal(scr, sx, sy, 9, P.ink, P.paper);
    if (k < 1) {
      const bw = Math.max(6, Math.round(w * e)), bh = Math.max(6, Math.round(h * e));
      bubbleBox(scr, x + w - bw, y, bw, bh, P);
      return;
    }
    bubbleBox(scr, x, y, w, h, P);
    // The tail, up to the seal.
    for (let j = 0; j <= 8; j++) {
      const ty = y - j, half = Math.round((8 - j) * 0.6);
      const cx = sx - 2 + Math.round(j * 0.25);
      scr.hline(cx - half, cx + half, ty, P.paper);
      scr.pset(cx - half - 1, ty, P.ink); scr.pset(cx + half + 1, ty, P.ink);
    }
    drawText(scr, t('field.from'), x + 8, y + 5, P.ink);
    drawText(scr, title, x + 8, y + 14, P.stamp, { scale: 1 });
    scr.hline(x + 8, x + 8 + textWidth(title), y + 22, P.stamp);
    lines.forEach((l, j) => drawText(scr, l, x + 8, y + 28 + j * LINE_H, P.ink));
    const by = y + h - 15;
    const labels = quota ? [t('field.endShift'), t('field.keepShooting')] : [t('field.endShift')];
    const bw = quota ? 83 : w - 16;
    labels.forEach((label, j) => {
      const bx = x + 8 + j * (bw + 8);
      if (b.sel === j) scr.rect(bx, by - 3, bw, 13, P.ink); else scr.frame(bx, by - 3, bw, 13, P.ink);
      drawText(scr, label, bx + bw / 2, by, b.sel === j ? P.paper : P.ink, { align: 'center' });
    });
  }
}

// Shift 5: before filing, the unit asks ARE YOU SURE ...? (its own voice, not the Office's).
// YES files the photo, NO lets the Recorder take another.
export function askBubble(scr, P, question, reveal, sel = 0) {
  const lines = wrapText(question, 172);
  const w = 190, h = 12 + lines.length * LINE_H + 25;
  const x = W - w - 5, y = 41, sx = W - 15, sy = 23; // below ● CONTINUE
  const k = Math.min(1, reveal), e = 1 + 2.7 * (k - 1) ** 3 + 1.7 * (k - 1) ** 2;
  seal(scr, sx, sy, 9, P.ink, P.paper);
  if (k < 1) { bubbleBox(scr, x + w - Math.max(6, Math.round(w * e)), y, Math.max(6, Math.round(w * e)), Math.max(6, Math.round(h * e)), P); return; }
  bubbleBox(scr, x, y, w, h, P);
  for (let j = 0; j <= 8; j++) {
    const ty = y - j, half = Math.round((8 - j) * 0.6), cx = sx - 2 + Math.round(j * 0.25);
    scr.hline(cx - half, cx + half, ty, P.paper);
    scr.pset(cx - half - 1, ty, P.ink); scr.pset(cx + half + 1, ty, P.ink);
  }
  lines.forEach((l, j) => drawText(scr, l, x + 8, y + 8 + j * LINE_H, P.ink));
  const by = y + h - 15, bw = 83;
  [t('ask.yes'), t('ask.no')].forEach((label, j) => {
    const bx = x + 8 + j * (bw + 8);
    if (sel === j) scr.rect(bx, by - 3, bw, 13, P.ink); else scr.frame(bx, by - 3, bw, 13, P.ink);
    drawText(scr, label, bx + bw / 2, by, sel === j ? P.paper : P.ink, { align: 'center' });
  });
}

// The develop screen's verdict stamps (and the controller's previews of them), half again as
// big as the other stamps (zoom 1.5); long lines wrap so they stay on screen.
const stampLines = (s, w) => wrapText(s, w).map((l) => [l, 1]);
export function filedStamp(scr, P, text, merit, seed, reveal = 1) {
  stamp(scr, [[t('develop.filed'), 3], ...stampLines(text, 180), ...(merit ? [[t('develop.merit', { MERIT: merit }), 2]] : [])], 160, 66, P.stamp, { seed, reveal, angle: -0.07, zoom: 1.5 });
}
export function notFiledStamp(scr, P, why, seed, reveal = 1) {
  stamp(scr, [[t('develop.notFiled'), 2], ...stampLines(why, 180)], 160, 58, P.stamp, { seed, reveal, angle: 0.04, zoom: 1.5 });
}

// A paper bubble with rounded corners and a drop shadow.
function bubbleBox(scr, x, y, w, h, P) {
  scr.checker(x + 3, y + 3, w, h, P.ink);
  scr.rect(x + 1, y, w - 2, h, P.paper);
  scr.rect(x, y + 1, w, h - 2, P.paper);
  scr.hline(x + 2, x + w - 3, y, P.ink); scr.hline(x + 2, x + w - 3, y + h - 1, P.ink);
  scr.vline(x, y + 2, y + h - 3, P.ink); scr.vline(x + w - 1, y + 2, y + h - 3, P.ink);
  scr.pset(x + 1, y + 1, P.ink); scr.pset(x + w - 2, y + 1, P.ink); scr.pset(x + 1, y + h - 2, P.ink); scr.pset(x + w - 2, y + h - 2, P.ink);
}

// =========================================================================== DEVELOP
export class Develop {
  constructor(g) { this.g = g; }
  enter(photo) {
    const g = this.g;
    this.photo = photo; this.t = 0; this.A = null; this.readyAt = null; this.stamped = false; this.marksShown = 0; this.linesShown = 0; this.shake = 0;
    this.askSel = 0; // shift 5's ARE YOU SURE?: 0 YES, 1 NO
    this.answered = false; this.stampAt = null; // YES: the FILED stamp comes down from then
    g.sfx.shutter(); g.buzz(25);
    g.analyze(photo).then((A) => { this.A = A; this.readyAt = Math.max(1.0, this.t); }).catch((e) => { console.error(e); this.A = { cv: null }; this.readyAt = this.t; });
  }
  // Timeline: flash, print, evidence, readout, stamp.
  get tMarks() { return this.readyAt === null ? Infinity : this.readyAt; }
  get tLines() { return this.tMarks + this.marks().length * 0.16 + 0.1; }
  get tStamp() { return this.tLines + (this.photo.lines || []).length * 0.12 + 0.2; }
  get tShown() { return this.stampAt === null ? this.tStamp : this.stampAt; } // when the stamp or the bubble came
  marks() {
    const v = this.photo.verdict;
    return v ? v.marks || [] : [];
  }
  update(dt) {
    const g = this.g, i = g.input;
    const prev = this.t;
    this.t += dt;
    if (this.t < 1.0 && Math.floor(this.t * 30) !== Math.floor(prev * 30)) g.sfx.printLine();
    if (this.t >= this.tMarks) {
      const n = Math.min(this.marks().length, Math.floor((this.t - this.tMarks) / 0.16) + 1);
      if (n > this.marksShown) { this.marksShown = n; g.sfx.scan(); }
    }
    if (this.t >= this.tLines) {
      const n = Math.min((this.photo.lines || []).length, Math.floor((this.t - this.tLines) / 0.12) + 1);
      if (n > this.linesShown) { this.linesShown = n; g.sfx.type(); }
    }
    if (!this.stamped && this.t >= this.tStamp) {
      this.stamped = true; this.shake = 0.18;
      g.sfx.stamp(); g.buzz(this.photo.verdict && this.photo.verdict.ok ? [20, 40, 30] : 40);
      if (this.photo.verdict && this.photo.verdict.ok) setTimeout(() => g.sfx.confirm(), 180);
    }
    this.shake = Math.max(0, this.shake - dt);
    // The unit asks ARE YOU SURE ...?: YES files this photo (its FILED stamp comes down), NO
    // files nothing and it's back to the field for another.
    const v = this.photo.verdict;
    if (this.stamped && v && v.soft && !v.ok) {
      if (this.t - this.tStamp < 0.3) return; // let the bubble land before it takes presses
      if (i.hit('LEFT') || i.hit('RIGHT') || i.hit('UP') || i.hit('DOWN')) { this.askSel = 1 - this.askSel; g.sfx.move(); }
      if (!(i.hit('OK') || i.tapped || i.hit('SHUTTER'))) return;
      if (this.askSel === 1) { g.decline(this.photo); g.sfx.deny(); g.buzz(40); return this.leave(); }
      if (g.confirm(this.photo)) {
        this.answered = true; this.stampAt = this.t; this.shake = 0.18;
        g.sfx.stamp(); g.buzz([20, 40, 30]); setTimeout(() => g.sfx.confirm(), 180);
      }
      return;
    }
    if (i.hit('OK') || i.hit('SHUTTER') || i.tapped || i.hit('SELECT')) {
      if (this.readyAt === null) return;
      if (!this.stamped) { this.t = this.tStamp; return; }
      if (this.answered && this.t - this.stampAt < 0.4) return; // the same press that said YES
      this.leave();
    }
  }
  leave() {
    const g = this.g, o = g.order, v = this.photo.verdict;
    if (v && v.ok && v.key === 'self') return g.go('ending', 'filed');
    if (o && (g.allDone() || o.film <= 0)) { g.closeShift(); return g.go('report'); }
    // Quota met (or more filed after it): the Office offers to end the shift.
    if (v && v.ok && o && g.quotaMet()) return g.go('field', 'quota');
    g.go('field');
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, ph = this.photo;
    const sx = this.shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0, sy = this.shake > 0 ? Math.round((Math.random() - 0.5) * 4) : 0;
    if (this.t < 0.1) { scr.clear(P.paper); return; }
    scr.blit(ph.px, ph.w, ph.h, sx, sy, W / ph.w);
    if (this.t < 1.0) {
      const y = Math.floor(((this.t - 0.1) / 0.9) * H);
      scr.rect(0, y, W, H - y, P.paper);
      scr.hline(0, W, y, P.ink);
      return;
    }
    const A = this.A;
    if (!A) { if (blink(g.t, 3)) notice(scr, t('develop.analysing'), P, 110); return; }
    drawFound(scr, P, ph, A);
    drawMarks(scr, P, ph, A, this.marks().slice(0, this.marksShown), g);
    // Readout.
    const lines = (ph.lines || []).slice(0, this.linesShown);
    if (lines.length) {
      const h = ph.lines.length * LINE_H + 5;
      scr.rect(0, H - h, W, h, P.ink);
      lines.forEach((l, k) => drawText(scr, fitText(l, W - 8), 4, H - h + 3 + k * LINE_H, P.paper));
    }
    if (this.stamped) {
      const v = ph.verdict, r = Math.min(1, (this.t - this.tShown) * 6);
      if (v && v.ok) filedStamp(scr, P, v.text, v.merit, ph.id, r);
      else if (v && v.soft) askBubble(scr, P, v.why, r, this.askSel);
      else notFiledStamp(scr, P, v && v.why ? v.why : t('develop.noRequest'), ph.id, r);
      if (blink(g.t, 1.5)) drawText(scr, t('develop.continue'), W - 4, 3, P.paper, { align: 'right', bg: P.ink });
      // Shift 5 with SHARE WITH THE INDEX on: where its 40x30 copy is.
      const st = v && v.ok ? g.index.statusOf(ph.id) : null;
      if (st) drawText(scr, st.state === 'shared' ? t('develop.shared', { NO: indexNo(st.entry.id) }) : st.state === 'sending' ? t('develop.sending') : t('develop.queued'), W - 4, 14, P.paper, { align: 'right', bg: P.ink });
    }
  }
}

// Everything the modules found, in plain ink and paper.
function drawFound(scr, P, ph, A) {
  (A.objects || []).filter((o) => o.score >= 0.35).slice(0, 6).forEach((o) => { const [x, y, w, h] = box(o.box); shadowRect(scr, x, y, w, h, P, true); tag(scr, `${o.label.toUpperCase()} ${o.score.toFixed(2).slice(1)}`, x, y, P.ink, P.paper); });
  const faces = A.affect && A.affect.length ? A.affect : A.faces || [];
  faces.slice(0, 6).forEach((f) => { const [x, y, w, h] = box(f.box); shadowBrackets(scr, x, y, w, h, P, 6); });
  (A.affect || []).slice(0, 3).forEach((f) => {
    const [x, y, w, h] = box(f.box);
    const top = Object.entries(f.read).sort((a, b) => b[1] - a[1])[0];
    tag(scr, `${top[0]} ${Math.round(top[1] * 100)}%`, x, y + h + 11, P.paper, P.ink);
  });
}

// The evidence for the verdict, in the Office's red ink.
function drawMarks(scr, P, ph, A, marks, g) {
  const red = P.stamp;
  for (const m of marks) {
    if (m.t === 'mask' && A.cv) {
      const c = hex(MARK_RGB[m.color] || '#c63a2c'), id = A.cv.color.id[m.color], mk = A.cv.color.mask, mw = A.cv.color.w;
      for (let y = 0; y < A.cv.color.h; y++) for (let x = 0; x < mw; x++) if (mk[y * mw + x] === id) { scr.pset(x * 2, y * 2, c); scr.pset(x * 2 + 1, y * 2 + 1, c); }
      tag(scr, `${m.color.toUpperCase()} ${Math.round(A.cv.color.frac[m.color] * 100)}%`, FOCUS.x0 * W, FOCUS.y0 * H, P.paper, red);
      scr.brackets(FOCUS.x0 * W, FOCUS.y0 * H, (FOCUS.x1 - FOCUS.x0) * W, (FOCUS.y1 - FOCUS.y0) * H, red, 10);
    } else if (m.t === 'light' && A.cv) {
      const mk = A.cv.light.mask;
      for (let y = 0; y < 120; y++) for (let x = 0; x < 160; x++) if (mk[y * 160 + x] && (x + y) % 2 === 0) scr.rect(x * 2, y * 2, 2, 2, red);
    } else if (m.t === 'shape') {
      const pts = m.shape.hull.map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);
      scr.poly(pts, red);
      scr.poly(pts.map(([x, y]) => [x + 1, y]), red);
      const [x, y] = box(m.shape.box);
      tag(scr, `${({ rect: 'RECTANGLE', circle: 'CIRCLE', triangle: 'TRIANGLE' })[m.shape.kind]} ${m.shape.score.toFixed(2).slice(1)}`, x, y, P.paper, red);
    } else if (m.t === 'axis') {
      const x = Math.round(m.x * W);
      scr.line(x, 12, x, H - 12, red, [4, 3]);
      scr.line(x + 1, 12, x + 1, H - 12, red, [4, 3]);
    } else if (m.t === 'box' || m.t === 'face') {
      const [x, y, w, h] = box(m.box);
      if (m.t === 'box') { scr.frame(x, y, w, h, red); scr.frame(x + 1, y + 1, w - 2, h - 2, red); }
      else { scr.brackets(x, y, w, h, red, 7); scr.brackets(x + 1, y + 1, w - 2, h - 2, red, 6); }
      tag(scr, m.label, x, y, P.paper, red);
    } else if (m.t === 'intent') {
      scr.frame(FOCUS.x0 * W, FOCUS.y0 * H, (FOCUS.x1 - FOCUS.x0) * W, (FOCUS.y1 - FOCUS.y0) * H, red);
      tag(scr, fitText(`INTENT: ${m.text.toUpperCase()} ${Math.round(m.p * 100)}%`, 240), FOCUS.x0 * W, FOCUS.y1 * H + 11, P.paper, red);
    } else if (m.t === 'match') {
      const other = g.store.list.find((p) => p.id === m.photo);
      if (other) {
        scr.rect(3, 14, 84, 64, red);
        scr.blitTo(other.px, other.w, other.h, 5, 16, 80, 60);
        drawText(scr, `EXP ${pad3(other.id)} · ${Math.round(m.sim * 100)}%`, 5, 81, P.paper, { bg: red, pad: 1 });
      }
    }
  }
}

// =========================================================================== MENU
export class Menu {
  constructor(g) { this.g = g; this.sel = 0; }
  enter(arg, prev) {
    const g = this.g;
    this.items = [
      { id: 'resume', label: t('menu.resume') }, { id: 'order', label: t('menu.order') }, { id: 'archive', label: t('menu.archive'), value: String(g.store.list.length) },
      ...(g.index.connected ? [{ id: 'index', label: t('menu.index') }] : []),
      { id: 'lab', label: t('menu.lab') }, { id: 'settings', label: t('menu.settings') }, { id: 'end', label: t('menu.end'), value: `${g.filed()}/${g.order ? g.order.quota : 0}` },
    ];
    if (g.day >= 5 && g.day < LAST_DAY) this.items.push({ id: 'expose', label: t('menu.expose') });
    this.items.push({ id: 'title', label: t('menu.title') });
    if (prev === 'field' || prev === 'develop' || this.sel >= this.items.length) this.sel = 0;
  }
  update() {
    const g = this.g, i = g.input;
    if (i.hit('UP')) { this.sel = (this.sel + this.items.length - 1) % this.items.length; g.sfx.move(); }
    if (i.hit('DOWN')) { this.sel = (this.sel + 1) % this.items.length; g.sfx.move(); }
    if (i.hit('SELECT')) { g.sfx.blip(); return g.go('field'); }
    if (!(i.hit('OK') || i.tapped)) return;
    g.sfx.confirm();
    const id = this.items[this.sel].id;
    if (id === 'resume') g.go('field');
    else if (id === 'order') g.go('order', 'view');
    else if (id === 'archive') g.go('archive', 'menu');
    else if (id === 'index') g.go('index', 'menu');
    else if (id === 'lab') g.go('lab', 'menu');
    else if (id === 'settings') g.go('settings', 'menu');
    else if (id === 'title') g.go('title');
    else if (id === 'end') {
      const met = g.quotaMet();
      g.go('confirm', {
        text: met ? t('menu.endQuestion') : t('menu.endEarly', { FILED: g.filed(), QUOTA: g.order.quota }),
        yes: t('menu.endYes'), no: t('menu.endNo'), onYes: () => { g.closeShift(); g.go('report'); }, onNo: () => g.go('field'),
      });
    } else if (id === 'expose') {
      g.go('confirm', {
        text: t('menu.exposeQuestion', { N: g.store.list.length }),
        yes: t('menu.exposeYes'), no: t('menu.exposeNo'), danger: true, onYes: () => g.go('ending', 'exposed'), onNo: () => g.go('field'),
      });
    }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    scr.restore(); dim(scr, P);
    const w = 200, h = this.items.length * 12 + 26, x = (W - w) / 2, y = (H - h) / 2;
    paper(scr, x, y, w, h, P);
    drawText(scr, t('menu.header', { SHIFT: g.day, NAME: shiftLine(g.dayDef, 'code') }), x + 8, y + 6, P.ink);
    rule(scr, x + 4, x + w - 4, y + 16, P);
    list(scr, this.items, this.sel, x + 2, y + 22, w - 4, P, 12);
  }
}

// =========================================================================== CONFIRM
export class Confirm {
  constructor(g) { this.g = g; }
  enter(arg) { this.a = arg; this.sel = 1; if (this.g.stateName !== 'confirm') this.g.scr.snapshot(); }
  update() {
    const g = this.g, i = g.input;
    if (i.hit('LEFT') || i.hit('RIGHT') || i.hit('UP') || i.hit('DOWN')) { this.sel = 1 - this.sel; g.sfx.move(); }
    if (i.hit('SELECT')) { g.sfx.blip(); return this.a.onNo(); }
    if (i.hit('OK') || i.tapped) { if (this.sel === 0) { g.sfx.confirm(); this.a.onYes(); } else { g.sfx.blip(); this.a.onNo(); } }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    scr.restore(); dim(scr, P);
    const lines = wrapText(this.a.text, 236);
    const w = 260, h = lines.length * LINE_H + 40, x = (W - w) / 2, y = (H - h) / 2;
    paper(scr, x, y, w, h, P);
    lines.forEach((l, k) => drawText(scr, l, x + 12, y + 10 + k * LINE_H, P.ink));
    const by = y + h - 18;
    [this.a.yes, this.a.no].forEach((label, k) => {
      const bx = x + (k === 0 ? 14 : w / 2 + 6), bw = w / 2 - 20;
      if (this.sel === k) scr.rect(bx, by - 3, bw, 13, k === 0 && this.a.danger ? P.stamp : P.ink);
      else scr.frame(bx, by - 3, bw, 13, P.ink);
      drawText(scr, label, bx + bw / 2, by, this.sel === k ? P.paper : P.ink, { align: 'center' });
    });
  }
}

// =========================================================================== ARCHIVE
export class Archive {
  constructor(g) { this.g = g; this.sel = 0; this.view = false; }
  enter(from) {
    if (from === 'back') { this.sel = Math.min(this.sel, Math.max(0, this.g.store.list.length - 1)); return; } // after a confirm
    this.from = from || this.from || 'menu'; this.view = false; this.sel = Math.max(0, this.g.store.list.length - 1);
  }
  update() {
    const g = this.g, i = g.input, n = g.store.list.length;
    if (i.hit('SELECT')) { g.sfx.blip(); if (this.view) this.view = false; else g.go(this.from === 'menu' ? 'menu' : this.from); return; }
    if (!n) return;
    if (this.view) {
      if (i.hit('LEFT')) { this.sel = (this.sel + n - 1) % n; g.sfx.move(); }
      if (i.hit('RIGHT')) { this.sel = (this.sel + 1) % n; g.sfx.move(); }
      if (i.hit('OK') || i.tapped) { this.view = false; g.sfx.blip(); }
      const st = g.index.statusOf(g.store.list[this.sel].id);
      if (i.hit('DOWN') && st && st.state === 'shared') { g.sfx.blip(); withdrawConfirm(g, st.entry, 'archive'); }
      return;
    }
    if (i.hit('LEFT')) { this.sel = Math.max(0, this.sel - 1); g.sfx.move(); }
    if (i.hit('RIGHT')) { this.sel = Math.min(n - 1, this.sel + 1); g.sfx.move(); }
    if (i.hit('UP')) { this.sel = Math.max(0, this.sel - 4); g.sfx.move(); }
    if (i.hit('DOWN')) { this.sel = Math.min(n - 1, this.sel + 4); g.sfx.move(); }
    if (i.hit('OK') || i.tapped) { this.view = true; g.sfx.blip(); }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, list = g.store.list;
    if (this.view && list[this.sel]) {
      drawPhoto(g, list[this.sel], t('archive.browse', { I: this.sel + 1, N: list.length }));
      const st = g.index.statusOf(list[this.sel].id);
      if (st && st.state === 'shared') drawText(scr, t('archive.inIndex', { NO: indexNo(st.entry.id) }), W - 4, 3, P.paper, { align: 'right', bg: P.ink });
      for (const x of g.toasts) notice(scr, x.text, P, 104);
      return;
    }
    desk(scr, P);
    drawText(scr, t('archive.title', { N: list.length, S: list.length === 1 ? '' : 'S' }), 8, 4, P.paper);
    if (!list.length) { notice(scr, t('archive.empty'), P, 100, true); }
    const cols = 4, tw = 72, th = 54, gap = 6, x0 = (W - (cols * tw + (cols - 1) * gap)) / 2, y0 = 16;
    const rowOf = (k) => Math.floor(k / cols);
    const first = Math.max(0, rowOf(this.sel) - 2) * cols;
    for (let k = first; k < Math.min(list.length, first + 12); k++) {
      const p = list[k], c = k - first;
      const x = x0 + (c % cols) * (tw + gap), y = y0 + Math.floor(c / cols) * (th + 13);
      scr.blitTo(p.px, p.w, p.h, x, y, tw, th);
      if (k === this.sel) { scr.frame(x - 2, y - 2, tw + 4, th + 4, P.paper); scr.frame(x - 3, y - 3, tw + 6, th + 6, P.paper); }
      drawText(scr, pad3(p.id), x, y + th + 3, P.paper);
      const v = p.verdict;
      if (v) drawText(scr, v.ok ? t('archive.filed') : '—', x + tw, y + th + 3, v.ok ? P.stamp : P.mid, { align: 'right' });
    }
    hints(scr, t('archive.hints'), P, H - 10, P.paper);
  }
}

// A filed exposure, full screen, with its notes.
function drawPhoto(g, p, foot) {
  const scr = g.scr, P = g.P;
  scr.blit(p.px, p.w, p.h, 0, 0, W / p.w);
  const f = p.found || {};
  (f.objects || []).forEach((o) => { const [x, y, w, h] = box(o.box); shadowRect(scr, x, y, w, h, P, true); tag(scr, o.label.toUpperCase(), x, y, P.ink, P.paper); });
  (f.faces || []).forEach((o) => { const [x, y, w, h] = box(o.box); shadowBrackets(scr, x, y, w, h, P, 6); });
  const lines = p.lines || [];
  const h = lines.length * LINE_H + 5;
  scr.rect(0, H - h, W, h, P.ink);
  lines.forEach((l, k) => drawText(scr, fitText(l, W - 8), 4, H - h + 3 + k * LINE_H, P.paper));
  const v = p.verdict;
  if (v && v.ok) stamp(scr, [[t('develop.filed'), 2], [fitText(v.text, 200), 1]], 250, 40, P.stamp, { seed: p.id, angle: 0.1 });
  drawText(scr, foot, 4, 3, P.paper, { bg: P.ink });
}

// =========================================================================== REPORT
export class Report {
  constructor(g) { this.g = g; this.t = 0; }
  enter() { this.t = 0; this.o = this.g.closeShift(); }
  update(dt) {
    const g = this.g, i = g.input;
    this.t += dt;
    if (this.t > 0.9 && !this.stamped) { this.stamped = true; g.sfx.stamp(); g.buzz(30); }
    if (this.t < 0.9) return;
    if (i.hit('OK') || i.tapped || i.hit('SHUTTER')) { g.sfx.confirm(); g.save.phase = 'shop'; g.persist(); g.go('shop'); }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, o = this.o, d = g.dayDef;
    desk(scr, P);
    paper(scr, 10, 6, 300, 228, P);
    header(scr, 16, 10, 288, t('report.title', { SHIFT: d.n, NAME: shiftLine(d, 'code') }), P, t('global.recorderLine'));
    let y = 38;
    for (const r of o.requests) {
      drawText(scr, r.done ? '✓' : '×', 20, y, r.done ? P.ink : P.mid);
      drawText(scr, fitText(requestText(r), 200), 30, y, r.done ? P.ink : P.mid);
      drawText(scr, r.done ? `+${r.merit}` : r.withdrawn ? t('order.withdrawn') : '—', 300, y, P.ink, { align: 'right' });
      y += 11;
    }
    y += 2; rule(scr, 16, 304, y, P); y += 6;
    const met = g.filed() >= o.quota;
    const rows = [
      [t('report.filed', { FILED: g.filed(), N: o.requests.length, QUOTA: o.quota }), met ? t('report.met') : t('report.notMet')],
      [t('report.used'), `${o.shots}`],
      ...(g.withdrawn() ? [[t('report.withdrawn'), `${g.withdrawn()}`]] : []),
      [t('report.meritFor'), `${o.earned}`],
      met ? [t('report.bonus'), `+${o.bonus}`] : [t('report.citation'), `−${o.citation}`],
      [t('report.onHand'), `${g.save.merit}`],
    ];
    for (const [a, b] of rows) { drawText(scr, a, 20, y, P.ink); drawText(scr, b, 300, y, P.ink, { align: 'right' }); y += 11; }
    if (this.stamped) stamp(scr, met ? [[t('report.approved'), 2]] : [[t('report.cited'), 2], [t('report.citedWhy'), 1]], 236, g.withdrawn() ? 206 : 196, P.stamp, { seed: 40 + d.n, angle: -0.16, reveal: Math.min(1, (this.t - 0.9) * 6) });
    if (this.t > 0.9 && blink(g.t, 1.5)) drawText(scr, t('report.next'), 20, 222, P.ink);
  }
}

// =========================================================================== SHOP
export class Shop {
  constructor(g) { this.g = g; this.sel = 0; this.t = 0; }
  enter() { this.sel = 0; this.t = 0; this.flash = 0; }
  rows() { return [...SHOP.map((s) => ({ ...s })), { begin: true }]; }
  update(dt) {
    const g = this.g, i = g.input, rows = this.rows();
    this.t += dt; this.flash = Math.max(0, this.flash - dt);
    if (i.hit('UP')) { this.sel = (this.sel + rows.length - 1) % rows.length; g.sfx.move(); }
    if (i.hit('DOWN')) { this.sel = (this.sel + 1) % rows.length; g.sfx.move(); }
    if (!(i.hit('OK') || i.tapped)) return;
    const r = rows[this.sel];
    if (r.begin) {
      g.sfx.confirm();
      if (g.day >= LAST_DAY) { g.go('title'); return; }
      g.nextShift(); g.go('order'); return;
    }
    const res = g.buy(r.track);
    if (res === 'ok' || res === 'issued') { g.sfx.stamp(); g.buzz(30); this.flash = 0.9; this.flashRow = this.sel; }
    else if (res === 'poor') { g.sfx.deny(); g.toast(t('shop.poor')); }
    else { g.sfx.deny(); g.toast(t('shop.maxed')); }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, rows = this.rows();
    desk(scr, P);
    paper(scr, 6, 6, 308, 228, P);
    header(scr, 12, 10, 296, t('shop.title'), P, t('shop.merit', { MERIT: g.save.merit }));
    let y = 38;
    rows.forEach((r, k) => {
      const on = k === this.sel;
      if (r.begin) {
        const label = g.day >= LAST_DAY ? t('shop.done') : t('shop.begin', { NEXT: g.day + 1 });
        y += 4;
        if (on) scr.rect(12, y - 3, 164, 13, P.ink);
        drawText(scr, label, 18, y, on ? P.paper : P.ink);
        return;
      }
      const tiers = g.trackDef(r.track), cur = g.tier(r.track), next = cur + 1;
      if (on) scr.rect(12, y - 3, 164, 23, P.ink);
      const fg = on ? P.paper : P.ink;
      if (next >= tiers.length) {
        drawText(scr, tiers[cur].name, 18, y, fg); drawText(scr, t('shop.max'), 172, y, fg, { align: 'right' });
        drawText(scr, tiers[cur].spec || '', 18, y + 10, on ? P.paper : P.mid);
      } else {
        drawText(scr, tiers[next].name, 18, y, fg);
        drawText(scr, String(r.costs[next]), 172, y, fg, { align: 'right' });
        drawText(scr, fitText(t('shop.now', { SPEC: tiers[next].spec, CURRENT: tiers[cur].spec || t('shop.off') }), 152), 18, y + 10, on ? P.paper : P.mid);
      }
      if (this.flash > 0 && this.flashRow === k) stamp(scr, [[t('shop.approved'), 1]], 140, y + 6, P.stamp, { seed: k + 3, angle: -0.2 });
      y += 26;
    });
    // Live preview of the highlighted grade.
    const r = rows[this.sel];
    let s = g.sensor, tn = g.tone, cap = t('shop.preview', { WHAT: t('shop.current') });
    if (r && !r.begin) {
      const next = Math.min(g.tier(r.track) + 1, g.trackDef(r.track).length - 1);
      if (r.track === 'sensor') { s = SENSORS[next]; cap = t('shop.preview', { WHAT: SENSORS[next].name }); }
      if (r.track === 'tone') { tn = TONES[next]; cap = t('shop.preview', { WHAT: TONES[next].name }); }
    }
    scr.rect(183, 37, 124, 94, P.ink);
    if (g.camera.ready) g.renderLive(1, s, tn, [185, 39, 120, 90]); else g.noSignal([185, 39, 120, 90]);
    drawText(scr, cap, 245, 136, P.ink, { align: 'center' });
    const lines = wrapText(shopNote(r), 120);
    lines.forEach((l, k) => drawText(scr, l, 185, 150 + k * LINE_H, P.mid));
    for (const x of g.toasts) notice(scr, x.text, P, 104);
  }
}
function shopNote(r) {
  if (!r || r.begin) return t('shop.beginNote');
  return t(`shop.${r.track}Note`);
}

// =========================================================================== SETTINGS
export class Settings {
  constructor(g) { this.g = g; this.sel = 0; this.jump = 1; }
  enter(from, prev) {
    if (prev === 'confirm') return; // back from a question: same row
    this.from = from === 'menu' ? 'menu' : 'title'; this.sel = 0; this.jump = this.g.day;
  }
  items() {
    const s = this.g.save.settings, g = this.g;
    const st = (id) => g.modules.st[id].state;
    const models = ['objects', 'faces', 'affect', 'intent'];
    const nReady = models.filter((id) => st(id) === 'ready').length;
    const loading = models.filter((id) => st(id) === 'loading');
    const onOff = (v) => (v ? t('settings.on') : t('settings.off'));
    return [
      { id: 'theme', label: t('settings.palette'), value: `◂ ${(THEMES.find((x) => x.id === s.theme) || THEMES[0]).name} ▸` },
      { id: 'body', label: t('settings.body'), value: `◂ ${s.body === 'graphite' ? t('settings.graphite') : t('settings.silver')} ▸` },
      { id: 'sound', label: t('settings.sound'), value: onOff(s.sound) },
      { id: 'haptics', label: t('settings.vibration'), value: onOff(s.haptics) },
      { id: 'facing', label: t('settings.camera'), value: s.facing === 'user' ? t('settings.front') : t('settings.rear') },
      { id: 'tap', label: t('settings.tap'), value: onOff(s.tapShoot) },
      ...(g.index.connected ? [{ id: 'share', label: t('settings.share'), value: onOff(s.share) }] : []),
      { id: 'jump', label: 'DEV: JUMP TO SHIFT', value: `◂ ${this.jump} ▸`, dim: true },
      { id: 'unlock', label: 'DEV: UNLOCK EVERYTHING', value: g.save.dev.unlockAll ? 'ON' : 'OFF', dim: true },
      { id: 'models', label: 'DEV: DOWNLOAD ALL MODELS', value: loading.length ? `${MODULES[loading[0]].name} ${Math.round(g.modules.st[loading[0]].progress * 100)}%` : `${nReady}/4 READY`, dim: true },
      ...(g.touchTest ? [{ id: 'touch', label: 'DEV: TOUCH TEST', value: g.touchTest.on ? 'ON' : 'OFF', dim: true }] : []),
      { id: 'erase', label: t('settings.erase'), dim: true },
      { id: 'back', label: t('settings.back') },
    ];
  }
  update() {
    const g = this.g, i = g.input, items = this.items(), s = g.save.settings;
    if (i.hit('UP')) { this.sel = (this.sel + items.length - 1) % items.length; g.sfx.move(); }
    if (i.hit('DOWN')) { this.sel = (this.sel + 1) % items.length; g.sfx.move(); }
    if (i.hit('SELECT')) { g.sfx.blip(); return g.go(this.from); }
    const id = items[this.sel].id, dir = i.hit('LEFT') ? -1 : i.hit('RIGHT') ? 1 : 0, ok = i.hit('OK') || i.tapped;
    if (!dir && !ok) return;
    g.sfx.blip();
    if (id === 'theme') { const k = THEMES.findIndex((x) => x.id === s.theme); s.theme = THEMES[(k + (dir || 1) + THEMES.length) % THEMES.length].id; g.dev.ramps.clear(); }
    else if (id === 'body') s.body = s.body === 'graphite' ? 'silver' : 'graphite';
    else if (id === 'sound') { s.sound = !s.sound; g.sfx.on = s.sound; }
    else if (id === 'haptics') { s.haptics = !s.haptics; g.buzz(30); }
    else if (id === 'facing') { s.facing = s.facing === 'user' ? 'environment' : 'user'; g.camera.start(s.facing); }
    else if (id === 'tap') s.tapShoot = !s.tapShoot;
    else if (id === 'share') {
      if (s.share) { s.share = false; g.index.stop(); g.toast(t('settings.sharingOff')); }
      else return g.go('confirm', {
        text: t('settings.shareQuestion'),
        yes: t('settings.shareYes'), no: t('settings.shareNo'), onYes: () => { s.share = true; g.persist(); g.go('settings', this.from); }, onNo: () => g.go('settings', this.from),
      });
    }
    else if (id === 'jump') {
      if (dir) this.jump = Math.max(1, Math.min(LAST_DAY, this.jump + dir));
      else { g.jumpTo(this.jump); g.toast(`NOW ON SHIFT ${this.jump}`); return g.go('order'); }
    } else if (id === 'unlock') g.save.dev.unlockAll = !g.save.dev.unlockAll;
    else if (id === 'models') ['objects', 'faces', 'affect', 'intent'].forEach((m) => g.modules.ensure(m));
    else if (id === 'touch') g.touchTest.toggle();
    else if (id === 'erase') return g.go('confirm', { text: t('settings.eraseQuestion'), yes: t('settings.eraseYes'), no: t('settings.eraseNo'), danger: true, onYes: () => { g.newGame(); g.go('title'); }, onNo: () => g.go('settings', this.from) });
    else if (id === 'back') return g.go(this.from);
    g.persist();
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, items = this.items();
    desk(scr, P);
    paper(scr, 20, 8, 280, 224, P);
    header(scr, 26, 12, 268, t('settings.title'), P);
    list(scr, items, this.sel, 24, 42, 272, P, items.length > 12 ? 12 : 13); // 13 rows still clear the hints
    if (items[this.sel].id === 'share') hints(scr, t('settings.shareHint'), P, 203, P.stamp);
    hints(scr, t('settings.hints'), P, 218);
    for (const x of g.toasts) notice(scr, x.text, P, 104);
  }
}

// =========================================================================== THE INDEX
// What Recorders have filed on shift 5, pooled from every unit that shares (shared-index.js,
// server/). Three levels: every label with its newest prints, one label's contact sheet, one
// print. Each print is the 40x30 two-tone copy its unit sent, drawn in this unit's palette.
const IX = { rows: 6, rowH: 35, y0: 16, strip: 5, px0: 104, pitch: 43, cols: 7, sheetRows: 6, sx0: 11, sy0: 16, spx: 43, spy: 34 };
export class IndexScreen {
  constructor(g) { this.g = g; this.level = 0; this.row = 0; this.top = 0; this.cur = 0; this.scroll = 0; this.from = 'menu'; }
  enter(arg) {
    const g = this.g;
    if (arg !== 'back') { this.from = arg === 'title' ? 'title' : 'menu'; this.level = 0; this.row = 0; this.top = 0; }
    g.index.load();
    g.index.flush().then(() => g.index.load());
  }
  labels() { const d = this.g.index.data; return d ? d.labels : []; }
  colors(e) {
    const g = this.g, k = g.theme.id;
    if (e.pal !== k) { e.colors = printColors(e.px, g.P.ink, g.P.paper, e.colors); e.pal = k; }
    return e.colors;
  }
  update() {
    const g = this.g, i = g.input, ix = g.index, ls = this.labels();
    const ok = i.hit('OK') || i.tapped;
    if (this.level === 0) {
      if (i.hit('SELECT')) { g.sfx.blip(); return g.go(this.from); }
      if (!ls.length) { if (ok && ix.connected && !ix.loading) { g.sfx.blip(); ix.load(true); } return; }
      if (i.hit('UP')) { this.row = (this.row + ls.length - 1) % ls.length; g.sfx.move(); }
      if (i.hit('DOWN')) { this.row = (this.row + 1) % ls.length; g.sfx.move(); }
      this.row = Math.min(this.row, ls.length - 1);
      this.top = Math.max(0, Math.min(Math.max(this.top, this.row - IX.rows + 1), this.row, ls.length - IX.rows));
      if (ok || i.hit('RIGHT')) {
        if (!ls[this.row].entries.length) { g.sfx.deny(); return; }
        this.level = 1; this.cur = 0; this.scroll = 0; g.sfx.blip();
      }
      return;
    }
    const l = ls[this.row];
    if (!l || !l.entries.length) { this.level = 0; return; }
    const n = l.entries.length;
    this.cur = Math.min(this.cur, n - 1);
    if (this.level === 1) {
      if (i.hit('SELECT')) { this.level = 0; g.sfx.blip(); return; }
      let c = this.cur;
      if (i.hit('LEFT')) c--;
      if (i.hit('RIGHT')) c++;
      if (i.hit('UP')) c -= IX.cols;
      if (i.hit('DOWN')) c += IX.cols;
      c = Math.max(0, Math.min(n - 1, c));
      if (c !== this.cur) { this.cur = c; g.sfx.move(); }
      const r = Math.floor(this.cur / IX.cols);
      this.scroll = Math.min(Math.max(this.scroll, r - IX.sheetRows + 1), r);
      if (l.more && this.cur >= n - IX.cols * 2) ix.more(l.label);
      if (ok) { this.level = 2; g.sfx.blip(); }
      return;
    }
    // One print: ◂ ▸ through the label, ▾ withdraws it if this unit sent it.
    if (i.hit('SELECT') || ok) { this.level = 1; g.sfx.blip(); return; }
    if (i.hit('LEFT') && this.cur > 0) { this.cur--; g.sfx.move(); }
    if (i.hit('RIGHT') && this.cur < n - 1) { this.cur++; g.sfx.move(); }
    if (l.more && this.cur >= n - 3) ix.more(l.label);
    const mine = ix.mine(l.entries[this.cur].id);
    if (i.hit('DOWN') && mine) { g.sfx.blip(); withdrawConfirm(g, mine, 'index'); }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, ls = this.labels(), l = ls[this.row];
    if (this.level === 2 && l && l.entries[this.cur]) this.drawPrint(l, l.entries[this.cur]);
    else { desk(scr, P); if (this.level === 1 && l) this.drawSheet(l); else this.drawLabels(ls); }
    for (const x of g.toasts) notice(scr, x.text, P, 104);
  }
  drawLabels(ls) {
    const g = this.g, scr = g.scr, P = g.P, ix = g.index;
    drawText(scr, t('index.title'), 6, 4, P.paper);
    if (ix.data) drawText(scr, t('index.total', { N: ix.data.total, S: ix.data.total === 1 ? '' : 'S' }), W - 6, 4, P.mid, { align: 'right' });
    if (!ls.length) {
      const msg = !ix.connected ? t('index.notConnected') : ix.loading ? (blink(g.t, 2) ? t('index.contacting') : '') : t('index.noAnswer');
      if (msg) notice(scr, msg, P, 100, true);
      drawText(scr, t('index.back'), 6, H - 10, P.paper);
      return;
    }
    for (let k = this.top; k < Math.min(ls.length, this.top + IX.rows); k++) {
      const lb = ls[k], y = IX.y0 + (k - this.top) * IX.rowH, on = k === this.row;
      if (on) scr.rect(2, y - 2, W - 4, IX.rowH - 1, P.paper);
      drawText(scr, LEARNED_LABEL[lb.label], 8, y + 6, on ? P.ink : P.paper);
      drawText(scr, lb.n ? t('index.filedN', { N: lb.n }) : t('index.none'), 8, y + 17, P.mid);
      for (let j = 0; j < IX.strip; j++) {
        const x = IX.px0 + j * IX.pitch, e = lb.entries[j];
        if (e) { scr.blitTo(this.colors(e), PRINT_W, PRINT_H, x, y, PRINT_W, PRINT_H); scr.frame(x - 1, y - 1, PRINT_W + 2, PRINT_H + 2, on ? P.ink : P.mid); }
        else scr.dots(x, y, PRINT_W, PRINT_H, on ? P.mid : P.dark);
      }
    }
    drawText(scr, t('index.hints'), 6, H - 10, P.paper);
    drawText(scr, `${this.row + 1}/${ls.length} · ${g.save.settings.share ? t('index.sharingOn') : t('index.sharingOff')}`, W - 6, H - 10, P.mid, { align: 'right' });
  }
  drawSheet(l) {
    const g = this.g, scr = g.scr, P = g.P;
    drawText(scr, fitText(heading(l.label), 236), 6, 4, P.paper);
    drawText(scr, t('index.filedN', { N: l.n }), W - 6, 4, P.mid, { align: 'right' });
    const first = this.scroll * IX.cols;
    for (let k = first; k < Math.min(l.entries.length, first + IX.cols * IX.sheetRows); k++) {
      const c = k - first, e = l.entries[k];
      const x = IX.sx0 + (c % IX.cols) * IX.spx, y = IX.sy0 + Math.floor(c / IX.cols) * IX.spy;
      scr.blitTo(this.colors(e), PRINT_W, PRINT_H, x, y, PRINT_W, PRINT_H);
      if (k === this.cur) { scr.frame(x - 2, y - 2, PRINT_W + 4, PRINT_H + 4, P.paper); scr.frame(x - 3, y - 3, PRINT_W + 6, PRINT_H + 6, P.paper); }
      else scr.frame(x - 1, y - 1, PRINT_W + 2, PRINT_H + 2, P.mid);
      if (g.index.mine(e.id)) scr.rect(x + PRINT_W - 5, y + 2, 3, 3, P.stamp); // this unit sent it
    }
    drawText(scr, t('index.sheetHints'), 6, H - 10, P.paper);
    drawText(scr, l.fetching ? t('index.loading') : `${this.cur + 1}/${l.n}`, W - 6, H - 10, P.mid, { align: 'right' });
  }
  drawPrint(l, e) {
    const g = this.g, scr = g.scr, P = g.P, word = LEARNED_LABEL[l.label];
    scr.blit(this.colors(e), PRINT_W, PRINT_H, 0, 0, W / PRINT_W);
    stamp(scr, [[t('index.filedAs'), 1], [word, 2]], Math.min(236, W - textWidth(word, 2) / 2 - 16), 46, P.stamp, { seed: e.id, angle: -0.08 });
    drawText(scr, t('index.printNo', { NO: indexNo(e.id), DATE: dayText(e.day) }), 4, 3, P.paper, { bg: P.ink });
    drawText(scr, t('index.browse', { I: this.cur + 1, N: l.n }), 4, H - 10, P.paper, { bg: P.ink });
    if (g.index.mine(e.id)) drawText(scr, t('index.yours'), W - 4, H - 10, P.paper, { align: 'right', bg: P.stamp });
  }
}

// Take one of this unit's prints back out of the index (from the archive or the INDEX screen).
function withdrawConfirm(g, entry, back) {
  g.go('confirm', {
    text: t('index.withdrawQuestion', { NO: indexNo(entry.id) }),
    yes: t('index.withdrawYes'), no: t('index.withdrawNo'), danger: true,
    onYes: () => {
      g.go(back, 'back');
      g.index.withdraw(entry).then((ok) => g.toast(ok ? t('index.withdrawn') : t('index.refused')), () => g.toast(t('index.noAnswerToast')));
    },
    onNo: () => g.go(back, 'back'),
  });
}

// =========================================================================== LAB
// The feasibility bench: every module live on the camera, with timings.
const LAB_PAGES = ['SUMMARY', 'INVENTORY', 'CENSUS', 'SENTIMENT', 'INTENT', 'CHROMA + FORM'];
export class Lab {
  constructor(g) { this.g = g; this.page = 0; this.ms = {}; this.res = {}; this.bench = null; this.busy = false; this.clipBusy = false; }
  enter(from) {
    const g = this.g;
    this.from = from === 'menu' ? 'menu' : 'title';
    g.labTier = { sensor: Math.max(3, g.tier('sensor')), tone: g.tier('tone') };
    ['objects', 'faces', 'affect', 'intent'].forEach((m) => g.modules.ensure(m));
  }
  exit() { this.g.labTier = null; }
  ema(k, v) { this.ms[k] = this.ms[k] === undefined ? v : this.ms[k] * 0.85 + v * 0.15; }
  update() {
    const g = this.g, i = g.input;
    if (i.hit('SELECT')) { g.sfx.blip(); return g.go(this.from); }
    if (i.hit('LEFT')) { this.page = (this.page + LAB_PAGES.length - 1) % LAB_PAGES.length; g.sfx.move(); }
    if (i.hit('RIGHT')) { this.page = (this.page + 1) % LAB_PAGES.length; g.sfx.move(); }
    if (i.hit('UP')) { g.labTier.sensor = Math.min(SENSORS.length - 1, g.labTier.sensor + 1); g.sfx.move(); }
    if (i.hit('DOWN')) { g.labTier.sensor = Math.max(0, g.labTier.sensor - 1); g.sfx.move(); }
    if (i.hit('OK') || i.tapped) { g.labTier.tone = (g.labTier.tone + 1) % TONES.length; g.sfx.move(); }
    if (i.hit('SHUTTER') && !this.busy) this.runBench();
    if (!g.camera.ready) return;
    const m = g.modules, mp = m.mp, page = LAB_PAGES[this.page];
    const time = (k, f) => { const t = performance.now(); const r = f(); this.ema(k, performance.now() - t); return r; };
    try {
      if (page === 'INVENTORY' && m.ready('objects')) this.res.objects = time('objects', () => mp.detectObjects(g.grab, W, H));
      if (page === 'CENSUS' && m.ready('faces')) this.res.faces = time('faces', () => mp.detectFaces(g.grab, W, H));
      if (page === 'SENTIMENT' && m.ready('affect')) this.res.affect = time('affect', () => mp.detectAffect(g.grab));
      if (page === 'CHROMA + FORM' && g.lastFrame && (!this.cvT || g.t - this.cvT > 0.15)) {
        this.cvT = g.t;
        const small = shrinkRGBA(g.lastFrame, W, H, 2);
        this.res.cv = time('cv', () => analyzeCV(small, 160, 120, { rgba: g.lastFrame, w: W, h: H }));
      }
      if (page === 'INTENT' && m.ready('intent') && !this.clipBusy) {
        this.clipBusy = true;
        const t = performance.now();
        m.clip.embed(g.grab, W, H).then((e) => { this.ema('intent', performance.now() - t); this.res.labels = m.clip.labels(e, 5); this.res.profile = m.clip.profile(e, 3); })
          .catch((e) => console.error(e)).finally(() => { this.clipBusy = false; });
      }
    } catch (e) { console.error(e); }
  }
  // SHUTTER: time every module on one 640x480 still, ten runs each, median.
  async runBench() {
    const g = this.g, m = g.modules;
    if (!g.freeze(1)) return;
    this.busy = true; this.bench = { running: true, rows: [] }; g.sfx.shutter();
    const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
    const runs = async (k, f) => { const ts = []; for (let r = 0; r < 10; r++) { const t = performance.now(); await f(); ts.push(performance.now() - t); } this.bench.rows.push([k, med(ts)]); };
    const c = g.cap;
    const small = document.createElement('canvas'); small.width = 160; small.height = 120;
    const sctx = small.getContext('2d', { willReadFrequently: true });
    const big = document.createElement('canvas'); big.width = 320; big.height = 240;
    const bctx = big.getContext('2d', { willReadFrequently: true });
    await runs('CHROMA+FORM', () => {
      sctx.drawImage(c, 0, 0, 160, 120); bctx.drawImage(c, 0, 0, 320, 240);
      analyzeCV(sctx.getImageData(0, 0, 160, 120).data, 160, 120, { rgba: bctx.getImageData(0, 0, 320, 240).data, w: 320, h: 240 });
    });
    if (m.ready('objects')) await runs('INVENTORY', () => m.mp.detectObjects(c, 640, 480));
    if (m.ready('faces')) await runs('CENSUS', () => m.mp.detectFaces(c, 640, 480));
    if (m.ready('affect')) await runs('SENTIMENT', () => m.mp.detectAffect(c));
    if (m.ready('intent')) await runs('INTENT', () => m.clip.embed(c, 640, 480));
    this.bench.running = false; this.busy = false;
    console.log('[clearance] bench (ms, median of 10, 640x480):', JSON.stringify(Object.fromEntries(this.bench.rows.map(([k, v]) => [k, +v.toFixed(1)]))));
    g.sfx.confirm();
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, page = LAB_PAGES[this.page];
    g.renderLive(1);
    const ink = P.ink, pap = P.paper;
    if (page === 'INVENTORY') (this.res.objects || []).forEach((o) => { const [x, y, w, h] = box(o.box); shadowRect(scr, x, y, w, h, P); tag(scr, `${o.label.toUpperCase()} ${o.score.toFixed(2).slice(1)}`, x, y, ink, pap); });
    if (page === 'CENSUS') (this.res.faces || []).forEach((f, k) => { const [x, y, w, h] = box(f.box); shadowBrackets(scr, x, y, w, h, P, 6); tag(scr, `SUBJ ${k + 1} ${f.score.toFixed(2).slice(1)}`, x, y, pap, ink); });
    if (page === 'SENTIMENT') {
      const fs = this.res.affect || [];
      fs.forEach((f) => { const [x, y, w, h] = box(f.box); shadowBrackets(scr, x, y, w, h, P, 6); });
      const f = fs[0];
      if (f) {
        const rows = [['JOY', f.read.JOY], ['SURPRISE', f.read.SURPRISE], ['DISTRESS', f.read.DISTRESS], ['FATIGUE', f.read.FATIGUE], ['EYES SHUT', f.eyesClosed], ['JAW OPEN', f.jaw]];
        scr.rect(4, 14, 112, rows.length * 10 + 14, ink);
        rows.forEach(([k, v], j) => { drawText(scr, k, 8, 17 + j * 10, pap); bar(scr, 66, 18 + j * 10, 46, v, P, ink, pap); });
        drawText(scr, `YAW ${f.yawDeg}°`, 8, 17 + rows.length * 10, pap);
      }
    }
    if (page === 'INTENT' && (this.res.labels || this.res.profile)) {
      const rows = (this.res.labels || []).map((l) => [l.label.toUpperCase(), l.p]).concat([['-- PROFILE --', null]], (this.res.profile || []).map((p) => [p.name, p.p]));
      scr.rect(4, 14, 150, rows.length * 10 + 6, ink);
      rows.forEach(([k, v], j) => { drawText(scr, fitText(k, 100), 8, 17 + j * 10, pap); if (v !== null) drawText(scr, `${Math.round(v * 100)}%`, 150, 17 + j * 10, pap, { align: 'right' }); });
    }
    if (page === 'CHROMA + FORM' && this.res.cv) {
      const cv = this.res.cv;
      cv.shapes.forEach((s) => { scr.poly(s.hull.map(([x, y]) => [Math.round(x * W), Math.round(y * H)]), P.stamp); const [x, y] = box(s.box); tag(scr, `${s.kind.toUpperCase()} ${s.score.toFixed(2).slice(1)}`, x, y, pap, P.stamp); });
      const cs = Object.entries(cv.color.frac).sort((a, b) => b[1] - a[1]).slice(0, 5);
      scr.rect(4, 14, 112, 72, ink);
      cs.forEach(([k, v], j) => { drawText(scr, k.toUpperCase(), 8, 17 + j * 10, pap); bar(scr, 60, 18 + j * 10, 52, v, P, ink, pap); });
      drawText(scr, `SYMMETRY ${Math.max(0, cv.sym.score).toFixed(2)}`, 8, 67, pap);
      drawText(scr, `BLANK ${cv.blank.score.toFixed(2)} LIGHT ${cv.light.ok ? 'Y' : 'N'}`, 8, 77, pap);
    }
    if (page === 'SUMMARY') this.summary();
    // Header and footer.
    scr.rect(0, 0, W, 11, ink);
    drawText(scr, `LAB ◂ ${page} ▸`, 4, 2, pap);
    const key = { INVENTORY: 'objects', CENSUS: 'faces', SENTIMENT: 'affect', INTENT: 'intent', 'CHROMA + FORM': 'cv' }[page];
    if (key) {
      const st = key === 'cv' ? null : g.modules.st[key];
      const txt = st && st.state !== 'ready' ? (st.state === 'loading' ? `LOADING ${Math.round(st.progress * 100)}%` : st.state.toUpperCase()) : this.ms[key] !== undefined ? `${this.ms[key].toFixed(1)} MS${g.modules.mp.delegate[key] ? ' ' + g.modules.mp.delegate[key] : ''}` : '';
      drawText(scr, txt, W - 4, 2, pap, { align: 'right' });
    }
    scr.rect(0, H - 11, W, 11, ink);
    drawText(scr, `▴▾ ${g.sensor.spec} · ● ${g.tone.name} · SHUTTER: BENCH`, 4, H - 9, pap);
  }
  summary() {
    const g = this.g, scr = g.scr, P = g.P, ink = P.ink, pap = P.paper;
    scr.rect(4, 14, 312, 210, ink);
    let y = 18;
    const line = (t, c = pap) => { drawText(scr, fitText(t, 304), 8, y, c); y += 10; };
    const v = g.camera.video;
    line(`SCREEN ${innerWidth}×${innerHeight} @${devicePixelRatio}X · CAMERA ${g.camera.width || 0}×${g.camera.height || 0}`);
    line(`PICTURE ${g.perf.render.toFixed(1)} MS/FRAME · ${g.perf.fps.toFixed(0)} FPS · ${g.sensor.spec} ${g.tone.name}`);
    y += 3; line('MODULE        MODEL    STATE        LOAD    RUN', P.mid);
    for (const id of MODULE_ORDER) {
      const M = MODULES[id], s = g.modules.st[id];
      const run = id === 'chroma' || id === 'form' ? this.ms.cv : this.ms[{ objects: 'objects', faces: 'faces', affect: 'affect', intent: 'intent' }[id]];
      const state = s.state === 'loading' ? `${Math.round(s.progress * 100)}%` : s.state === 'error' ? 'FAULT' : s.state.toUpperCase();
      const cols = [M.name, M.mb ? `${M.mb}MB` : '—', state, s.ms ? `${(s.ms / 1000).toFixed(1)}S` : '—', run !== undefined ? `${run.toFixed(0)}MS` : '—'];
      [8, 86, 136, 196, 240].forEach((x, k) => drawText(scr, cols[k], x, y, pap));
      y += 10;
      if (s.state === 'error') line('  ' + s.error.toUpperCase(), P.stamp);
    }
    line(`RUNTIMES (ONCE): MEDIAPIPE ${RUNTIME_MB.mediapipe}MB · ONNX ${RUNTIME_MB.ort}MB`, P.mid);
    y += 3;
    if (this.bench) {
      line(this.bench.running ? 'BENCH RUNNING… (640×480, 10 RUNS EACH)' : 'BENCH: MEDIAN OF 10 RUNS ON ONE 640×480 STILL');
      for (const [k, ms] of this.bench.rows) line(`  ${k.padEnd(12)} ${ms.toFixed(1)} MS`);
    } else line('PRESS THE SHUTTER TO BENCHMARK EVERY MODULE.');
    line('◂ ▸ PAGES SHOW EACH MODULE LIVE.', P.mid);
  }
}

function shrinkRGBA(src, w, h, f) {
  const sw = w / f, sh = h / f, out = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let r = 0, gg = 0, b = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) { const p = ((y * f + yy) * w + x * f + xx) * 4; r += src[p]; gg += src[p + 1]; b += src[p + 2]; }
    const o = (y * sw + x) * 4, n = f * f;
    out[o] = r / n; out[o + 1] = gg / n; out[o + 2] = b / n; out[o + 3] = 255;
  }
  return out;
}

// =========================================================================== ENDINGS
export class Ending {
  constructor(g) { this.g = g; }
  enter(kind) {
    const g = this.g;
    this.kind = kind; this.step = 0; this.t = 0; this.since = performance.now();
    this.count = g.store.list.length;
    this.subjects = g.store.list.filter((p) => p.person).length;
    this.filedN = g.store.list.filter((p) => p.verdict && p.verdict.ok).length;
    this.photos = g.store.list.slice();
    if (kind === 'exposed') { g.sfx.burn(); g.store.clear(); }
    g.save.ending = kind; g.save.phase = 'ended'; g.persist();
  }
  update(dt) {
    const g = this.g, i = g.input;
    this.t += dt;
    // Wall-clock guard so a slow frame can't swallow the press.
    if (performance.now() - this.since > 700 && (i.hit('OK') || i.tapped || i.hit('SHUTTER'))) {
      this.step++; this.t = 0; this.since = performance.now(); g.sfx.confirm();
      if (this.step === 2) { g.sfx.stamp(); g.buzz(40); }
      if (this.step > 3) g.go('title');
    }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    if (this.kind === 'filed') {
      if (this.step === 0) return this.contactSheet();
      if (this.step === 1 || this.step === 2) {
        this.doc(t('ending.filedTitle'), t('ending.filedText', { COUNT: this.count, SUBJECTS: this.subjects, FILED: this.filedN }).split('\n'));
        if (this.step === 2) stamp(scr, [[t('ending.filedStamp'), 3], [t('global.recorderLine'), 1]], 230, 186, P.stamp, { seed: 99, angle: -0.18 });
        return;
      }
      // Clearance revoked: the picture falls back to the first, crudest grade.
      if (g.camera.ready) g.renderLive(1, SENSORS[0], TONES[0]); else g.noSignal();
      notice(scr, t('ending.revoked'), P, 104);
      if (this.t > 1.5) drawText(scr, t('ending.end'), W / 2, 220, P.paper, { align: 'center', bg: P.ink });
      return;
    }
    // Exposed: light floods the film.
    if (this.step === 0) {
      const k = Math.min(1, this.t / 2.2);
      if (this.photos.length && k < 0.4) { const p = this.photos[this.photos.length - 1]; scr.blit(p.px, p.w, p.h, 0, 0, W / p.w); } else scr.clear(P.ink);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - 230, y - 70) / 300 + ((x * 7 + y * 13) % 17) / 60;
        if (d < k * 1.4) scr.pset(x, y, P.paper);
      }
      if (this.t > 2.4) drawText(scr, t('develop.continue'), W - 4, H - 10, P.ink, { align: 'right' });
      return;
    }
    if (this.step === 1 || this.step === 2) {
      this.doc(t('ending.exposedTitle'), t('ending.exposedText', { COUNT: this.count }).split('\n'));
      if (this.step === 2) stamp(scr, [[t('ending.exposedStamp'), 2]], 220, 186, P.stamp, { seed: 98, angle: -0.14 });
      return;
    }
    scr.clear(P.paper);
    drawText(scr, t('title.word'), W / 2, 90, P.ink, { scale: 3, align: 'center' });
    drawText(scr, t('ending.noFile'), W / 2, 124, P.ink, { align: 'center' });
    if (this.t > 1.5) drawText(scr, t('ending.end'), W / 2, 220, P.ink, { align: 'center' });
  }
  doc(title, lines) {
    const g = this.g, scr = g.scr, P = g.P;
    desk(scr, P);
    paper(scr, 14, 10, 292, 220, P);
    header(scr, 20, 14, 280, title, P, t('global.recorderLine'));
    let y = 44;
    for (const l of lines) { for (const w of wrapText(l, 272)) { drawText(scr, w, 24, y, P.ink); y += LINE_H; } if (!l) y += 3; }
    if (this.t > 1 && blink(g.t, 1.5)) drawText(scr, t('develop.continue'), 296, 218, P.ink, { align: 'right' });
  }
  contactSheet() {
    const g = this.g, scr = g.scr, P = g.P, ps = this.photos;
    scr.clear(P.ink);
    drawText(scr, t('ending.sheet', { N: ps.length }), 4, 3, P.paper);
    const n = Math.max(1, ps.length), cols = n > 30 ? 8 : n > 12 ? 6 : 4, tw = Math.floor((W - 8) / cols) - 2, th = Math.floor((tw * 3) / 4);
    const shown = Math.min(ps.length, Math.floor(this.t * 8));
    for (let k = 0; k < shown; k++) {
      const p = ps[k], x = 4 + (k % cols) * (tw + 2), y = 14 + Math.floor(k / cols) * (th + 2);
      if (y + th > H - 12) break;
      scr.blitTo(p.px, p.w, p.h, x, y, tw, th);
    }
    if (this.t > 1) drawText(scr, t('develop.continue'), W - 4, H - 10, P.paper, { align: 'right' });
  }
}
