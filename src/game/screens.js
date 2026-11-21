// Every screen of the unit. Each has enter(arg, prev), update(dt) and draw().
import { W, H, hex } from '../engine/screen.js';
import { THEMES } from '../engine/palette.js';
import { fitText } from '../engine/font.js';
import { desk, paper, rule, seal, header, stamp, list, notice, bar, dim, hints, drawText, textWidth, wrapText, LINE_H } from './ui.js';
import { SENSORS, TONES, LENSES, FILMS } from './tiers.js';
import { DAYS, LAST_DAY, RECORDER } from './days.js';
import { REQUESTS, requestText } from './requests.js';
import { SHOP } from './game.js';
import { MODULES, MODULE_ORDER, RUNTIME_MB } from '../vision/modules.js';
import { analyzeCV, FOCUS } from '../vision/cv.js';

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
    if (s.phase === 'ended') items.push({ id: 'again', label: 'BEGIN AGAIN' });
    else items.push({ id: 'go', label: s.phase === 'new' ? 'REPORT FOR DUTY' : `RESUME SHIFT ${s.day}` });
    if (s.phase !== 'new' && s.phase !== 'ended') items.push({ id: 'again', label: 'NEW RECORDER' });
    items.push({ id: 'lab', label: 'LAB' }, { id: 'settings', label: 'SETTINGS' });
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
    if (id === 'settings') return g.go('settings');
    if (id === 'again' && g.save.phase !== 'ended' && g.save.phase !== 'new') {
      return g.go('confirm', { text: 'START OVER AS A NEW RECORDER? YOUR SHIFTS, MERIT AND EVERY EXPOSURE WILL BE DELETED.', yes: 'START OVER', no: 'KEEP', onYes: () => { g.newGame(); g.go('title'); }, onNo: () => g.go('title') });
    }
    if (id === 'again') g.newGame();
    g.resume();
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    if (g.camera.ready) g.renderLive(1, SENSORS[0], TONES[0]); else g.noSignal();
    dim(scr, P);
    seal(scr, W / 2, 26, 17, P.ink, P.paper);
    const word = 'CLEARANCE', scale = 4, tw = textWidth(word, scale), x0 = (W - tw) / 2;
    scr.rect(x0 - 6, 48, tw + 12, 36, P.paper);
    drawText(scr, word, x0, 52, P.ink, { scale });
    // The title starts redacted; the bars lift one letter at a time.
    let cx = x0;
    for (let k = 0; k < word.length; k++) {
      const w = textWidth(word[k], scale);
      if (this.t < 0.35 + k * 0.11) scr.rect(cx - 1, 50, w + 2, 32, P.ink);
      cx += w + scale;
    }
    drawText(scr, 'A FIELD UNIT OF THE OFFICE OF CIVIC RECORD', W / 2, 89, P.paper, { align: 'center', bg: P.ink, pad: 2 });
    const mw = 150, mh = this.items.length * 12 + 10, mx = (W - mw) / 2, my = 112;
    paper(scr, mx, my, mw, mh, P);
    list(scr, this.items, this.sel, mx + 2, my + 7, mw - 4, P, 12);
    const cam = g.camera.state;
    const status = cam === 'live' ? '' : cam === 'asking' ? 'WAITING FOR CAMERA PERMISSION' : cam === 'off' ? 'TOUCH ANY BUTTON TO WAKE THE UNIT' : g.camera.error;
    if (status) drawText(scr, status, W / 2, 200, P.paper, { align: 'center', bg: P.ink });
    hints(scr, '▴▾ CHOOSE   ● OK', P, 228, P.paper);
    drawText(scr, 'OCR-7', W - 4, 228, P.mid, { align: 'right' });
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
    header(scr, 28, 36, 264, 'UNIT FAULT: NO PICTURE', P);
    const lines = wrapText(`${g.camera.error || 'THE CAMERA DID NOT START.'} THE UNIT NEEDS THE CAMERA. ALLOW CAMERA ACCESS FOR THIS PAGE IN THE BROWSER, THEN TRY AGAIN. ON A PHONE THE PAGE MUST BE OPENED WITH AN HTTPS LINK.`, 256);
    lines.forEach((l, k) => drawText(scr, l, 32, 66 + k * LINE_H, P.ink));
    hints(scr, '● TRY AGAIN   SELECT: TITLE', P, 186);
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
  memoTime() { return this.g.dayDef.memo.length / 70; }
  chars() { return this.view ? 1e9 : Math.floor(this.t * 70); }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, d = g.dayDef, o = g.order;
    desk(scr, P);
    paper(scr, 10, 6, 300, 228, P);
    header(scr, 16, 10, 288, `WORK ORDER · SHIFT ${d.n} OF ${LAST_DAY} · ${d.code}`, P);
    let y = 36;
    const memo = d.memo.slice(0, this.chars());
    for (const l of wrapText(memo, 284)) { drawText(scr, l, 18, y, P.ink); y += LINE_H; }
    y = Math.max(y, 36 + wrapText(d.memo, 284).length * LINE_H) + 3;
    const show = this.view || this.t > this.memoTime();
    if (show && d.issueNote) { drawText(scr, '▸ ' + d.issueNote, 18, y, P.paper, { bg: P.ink, pad: 2 }); y += 13; }
    if (show) {
      const mods = d.modules.map((id) => {
        const s = g.modules.st[id];
        return MODULES[id].name + (s.state === 'loading' ? ` ${Math.round(s.progress * 100)}%` : s.state === 'error' ? ' FAULT' : '');
      });
      for (const l of wrapText('MODULES: ' + mods.join(' · '), 284)) { drawText(scr, l, 18, y, P.ink); y += LINE_H; }
      y += 2; rule(scr, 16, 304, y, P); y += 5;
      drawText(scr, `REQUESTS · FILE ANY ${o.quota} OF ${o.requests.length}`, 18, y, P.ink); y += 12;
      for (const r of o.requests) {
        const def = REQUESTS[r.key];
        drawText(scr, r.done ? '■' : '□', 20, y, P.ink);
        drawText(scr, fitText(requestText(r), 200), 30, y, P.ink);
        drawText(scr, r.done ? `FILED +${r.merit}` : def.merit ? String(def.merit) : '—', 300, y, P.ink, { align: 'right' });
        y += 11;
      }
      y += 2; rule(scr, 16, 304, y, P); y += 5;
      drawText(scr, `FILM: ${o.film} EXPOSURES   MERIT ON HAND: ${g.save.merit}`, 18, y, P.ink);
      if (blink(g.t, 1.5)) drawText(scr, this.view ? '● BACK TO WORK' : '● ACCEPT ORDER', 18, 222, P.ink);
    }
    if (show && !this.view) stamp(scr, [['ISSUED', 2]], 266, 216, P.stamp, { angle: -0.14, seed: d.n, pad: 3, reveal: Math.min(1, (this.t - this.memoTime()) * 5) });
  }
}

// =========================================================================== VIEWFINDER
const ZOOMS = [1, 1.5, 2, 3, 4];
export class Viewfinder {
  constructor(g) { this.g = g; this.focus = 0; this.zoom = 1; this.hintT = 0; }
  enter(arg, prev) {
    const g = this.g;
    this.zoom = Math.min(this.zoom, g.maxZoom);
    this.fixFocus(0);
    if (prev === 'order' && g.day === 1 && !g.order.shots) this.hintT = 7;
    if (g.day === LAST_DAY && g.save.selfMisses >= 2) g.toast(g.save.selfMisses >= 4 ? 'TURN THE UNIT AROUND.' : 'HINT: THE RECORDER IS HOLDING THE UNIT.', 4);
    g.installModules();
    g.wake();
  }
  open() { return this.g.order ? this.g.order.requests.map((r, i) => (r.done ? -1 : i)).filter((i) => i >= 0) : []; }
  fixFocus(dir) {
    const open = this.open();
    if (!open.length) { this.focus = 0; return; }
    let k = open.indexOf(this.focus);
    if (k < 0) k = 0; else k = (k + dir + open.length) % open.length;
    this.focus = open[k];
  }
  update(dt) {
    const g = this.g, i = g.input;
    this.hintT = Math.max(0, this.hintT - dt);
    if (i.hit('LEFT')) { this.fixFocus(-1); g.sfx.move(); }
    if (i.hit('RIGHT')) { this.fixFocus(1); g.sfx.move(); }
    if (i.hit('UP') || i.hit('DOWN')) {
      if (g.maxZoom <= 1) { g.toast('LENS I HAS NO ZOOM · REQUISITION LENS II'); g.sfx.deny(); }
      else {
        const zs = ZOOMS.filter((z) => z <= g.maxZoom);
        const k = Math.max(0, zs.indexOf(this.zoom) + (i.hit('UP') ? 1 : -1));
        this.zoom = zs[Math.min(zs.length - 1, k)];
        g.toast(`ZOOM ${this.zoom}×`, 0.8); g.sfx.move();
      }
    }
    if (i.hit('OK')) { g.save.settings.hud = (g.save.settings.hud + 1) % 2; g.persist(); g.sfx.blip(); }
    if (i.hit('SELECT')) { g.scr.snapshot(); g.sfx.blip(); return g.go('menu'); }
    if (i.hit('SHUTTER') || (i.tapped && g.save.settings.tapShoot)) this.shoot();
    g.updateTracking();
  }
  shoot() {
    const g = this.g, o = g.order;
    if (!o) return;
    if (o.film <= 0) { g.sfx.deny(); g.toast('OUT OF FILM · SELECT ▸ END SHIFT'); return; }
    if (!g.camera.ready) { g.sfx.deny(); g.toast('NO PICTURE · CHECK THE CAMERA'); return; }
    const photo = g.capture(this.zoom);
    if (!photo) return;
    g.go('develop', photo);
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, o = g.order;
    g.renderLive(this.zoom);
    // Live tracking.
    g.track.objects.slice(0, 8).forEach((ob) => { if (ob.score < 0.4) return; const [x, y, w, h] = box(ob.box); shadowRect(scr, x, y, w, h, P, true); tag(scr, ob.label.toUpperCase(), x, y, P.ink, P.paper); });
    g.track.faces.slice(0, 6).forEach((f, k) => { const [x, y, w, h] = box(f.box); shadowBrackets(scr, x, y, w, h, P, 6); tag(scr, `SUBJ ${String(k + 1).padStart(2, '0')}`, x, y, P.paper, P.ink); });
    // Focus brackets.
    const fx = FOCUS.x0 * W, fy = FOCUS.y0 * H, fw = (FOCUS.x1 - FOCUS.x0) * W, fh = (FOCUS.y1 - FOCUS.y0) * H;
    shadowBrackets(scr, fx, fy, fw, fh, P, 10);
    scr.rect(W / 2 - 4, H / 2 - 1, 9, 3, P.ink); scr.rect(W / 2 - 1, H / 2 - 4, 3, 9, P.ink);
    scr.hline(W / 2 - 3, W / 2 + 3, H / 2, P.paper); scr.vline(W / 2, H / 2 - 3, H / 2 + 3, P.paper);
    if (g.save.settings.hud === 0) this.hud();
    if (this.hintT > 0) notice(scr, 'FRAME THE SUBJECT IN THE BRACKETS AND PRESS THE SHUTTER.\n◂ ▸ SWITCHES REQUEST · SELECT OPENS THE MENU', P, 150);
    for (const t of g.toasts) notice(scr, t.text, P, 104);
  }
  hud() {
    const g = this.g, scr = g.scr, P = g.P, o = g.order;
    scr.rect(0, 0, W, 11, P.ink);
    const open = this.open();
    if (!o || !open.length) drawText(scr, o ? 'ALL REQUESTS FILED · SELECT ▸ END SHIFT' : 'NO WORK ORDER', 4, 2, P.paper);
    else {
      const r = o.requests[this.focus], def = REQUESTS[r.key];
      const right = `${def.merit ? '+' + def.merit + '  ' : ''}${open.indexOf(this.focus) + 1}/${open.length}`;
      drawText(scr, right, W - 4, 2, P.paper, { align: 'right' });
      drawText(scr, '◂ ' + fitText(requestText(r), W - textWidth(right) - 30) + ' ▸', 4, 2, P.paper);
    }
    scr.rect(0, H - 11, W, 11, P.ink);
    const film = o ? o.film : 0;
    drawText(scr, `FILM ${String(film).padStart(2, '0')}`, 4, H - 9, film <= 2 && blink(g.t, 3) ? P.stamp : P.paper);
    drawText(scr, `MERIT ${g.save.merit}`, 62, H - 9, P.paper);
    drawText(scr, `QUOTA ${g.filed()}/${o ? o.quota : 0}`, 128, H - 9, P.paper);
    let x = W - 4;
    const mods = g.enabledModules();
    for (let k = mods.length - 1; k >= 0; k--) {
      const s = g.modules.st[mods[k]], code = MODULES[mods[k]].code;
      const txt = s.state === 'loading' ? `${code}${Math.round(s.progress * 100)}%` : s.state === 'error' ? `${code}!` : code;
      x -= drawText(scr, txt, x, H - 9, s.state === 'ready' ? P.paper : P.mid, { align: 'right' }) + 4;
    }
    if (this.zoom > 1) drawText(scr, `${this.zoom}×`, x - 2, H - 9, P.paper, { align: 'right' });
    if (g.track.faces.length && blink(g.t, 1.2)) scr.disc(W - 6, 17, 2, P.stamp);
  }
}

// =========================================================================== DEVELOP
export class Develop {
  constructor(g) { this.g = g; }
  enter(photo) {
    const g = this.g;
    this.photo = photo; this.t = 0; this.A = null; this.readyAt = null; this.stamped = false; this.marksShown = 0; this.linesShown = 0; this.shake = 0;
    g.sfx.shutter(); g.buzz(25);
    g.analyze(photo).then((A) => { this.A = A; this.readyAt = Math.max(1.0, this.t); }).catch((e) => { console.error(e); this.A = { cv: null }; this.readyAt = this.t; });
  }
  // Timeline: flash, print, evidence, readout, stamp.
  get tMarks() { return this.readyAt === null ? Infinity : this.readyAt; }
  get tLines() { return this.tMarks + this.marks().length * 0.16 + 0.1; }
  get tStamp() { return this.tLines + (this.photo.lines || []).length * 0.12 + 0.2; }
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
    if (i.hit('OK') || i.hit('SHUTTER') || i.tapped || i.hit('SELECT')) {
      if (this.readyAt === null) return;
      if (!this.stamped) { this.t = this.tStamp; return; }
      this.leave();
    }
  }
  leave() {
    const g = this.g, o = g.order, v = this.photo.verdict;
    if (v && v.ok && v.key === 'self') return g.go('ending', 'filed');
    if (o && (g.allDone() || o.film <= 0)) { g.closeShift(); return g.go('report'); }
    if (v && v.ok && o && g.filed() === o.quota) g.toast('QUOTA MET · KEEP FILING OR SELECT ▸ END SHIFT', 3.5);
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
    if (!A) { if (blink(g.t, 3)) notice(scr, 'ANALYSING EXPOSURE', P, 110); return; }
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
      const v = ph.verdict, r = Math.min(1, (this.t - this.tStamp) * 6);
      if (v && v.ok) stamp(scr, v.merit ? [['FILED', 3], [fitText(v.text, 220), 1], [`+${v.merit} MERIT`, 2]] : [['FILED', 3], [v.text, 1]], 160, 62, P.stamp, { seed: ph.id, reveal: r, angle: -0.07 });
      else stamp(scr, [['NOT FILED', 2], [fitText(v && v.why ? v.why : 'NO OPEN REQUEST', 250), 1]], 160, 52, P.stamp, { seed: ph.id, angle: 0.04, reveal: r });
      if (blink(g.t, 1.5)) drawText(scr, '● CONTINUE', W - 4, 3, P.paper, { align: 'right', bg: P.ink });
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
      { id: 'resume', label: 'RESUME' }, { id: 'order', label: 'WORK ORDER' }, { id: 'archive', label: 'ARCHIVE', value: String(g.store.list.length) },
      { id: 'lab', label: 'LAB' }, { id: 'settings', label: 'SETTINGS' }, { id: 'end', label: 'END SHIFT', value: `${g.filed()}/${g.order ? g.order.quota : 0}` },
    ];
    if (g.day >= 5 && g.day < LAST_DAY) this.items.push({ id: 'expose', label: 'OPEN THE BACK OF THE UNIT' });
    this.items.push({ id: 'title', label: 'TITLE SCREEN' });
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
    else if (id === 'lab') g.go('lab', 'menu');
    else if (id === 'settings') g.go('settings', 'menu');
    else if (id === 'title') g.go('title');
    else if (id === 'end') {
      const met = g.quotaMet();
      g.go('confirm', {
        text: met ? 'END THE SHIFT AND RETURN FOR REVIEW?' : `QUOTA NOT MET (${g.filed()} OF ${g.order.quota}). THE OFFICE WILL ISSUE A CITATION. END THE SHIFT ANYWAY?`,
        yes: 'END SHIFT', no: 'KEEP WORKING', onYes: () => { g.closeShift(); g.go('report'); }, onNo: () => g.go('field'),
      });
    } else if (id === 'expose') {
      g.go('confirm', {
        text: `OPEN THE BACK OF THE UNIT? LIGHT WILL DESTROY ALL ${g.store.list.length} EXPOSURES ON FILE. THE OFFICE WILL NOTICE.`,
        yes: 'OPEN IT', no: 'CLOSE', danger: true, onYes: () => g.go('ending', 'exposed'), onNo: () => g.go('field'),
      });
    }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P;
    scr.restore(); dim(scr, P);
    const w = 200, h = this.items.length * 12 + 26, x = (W - w) / 2, y = (H - h) / 2;
    paper(scr, x, y, w, h, P);
    drawText(scr, `SHIFT ${g.day} · ${g.dayDef.code}`, x + 8, y + 6, P.ink);
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
  enter(from) { this.from = from || this.from || 'menu'; this.view = false; this.sel = Math.max(0, this.g.store.list.length - 1); }
  update() {
    const g = this.g, i = g.input, n = g.store.list.length;
    if (i.hit('SELECT')) { g.sfx.blip(); if (this.view) this.view = false; else g.go(this.from === 'menu' ? 'menu' : this.from); return; }
    if (!n) return;
    if (this.view) {
      if (i.hit('LEFT')) { this.sel = (this.sel + n - 1) % n; g.sfx.move(); }
      if (i.hit('RIGHT')) { this.sel = (this.sel + 1) % n; g.sfx.move(); }
      if (i.hit('OK') || i.tapped) { this.view = false; g.sfx.blip(); }
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
    if (this.view && list[this.sel]) return drawPhoto(g, list[this.sel], `◂ ▸ BROWSE · ${this.sel + 1}/${list.length}`);
    desk(scr, P);
    drawText(scr, `ARCHIVE · ${list.length} EXPOSURE${list.length === 1 ? '' : 'S'} ON FILE`, 8, 4, P.paper);
    if (!list.length) { notice(scr, 'NO EXPOSURES ON FILE.', P, 100, true); }
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
      if (v) drawText(scr, v.ok ? 'FILED' : '—', x + tw, y + th + 3, v.ok ? P.stamp : P.mid, { align: 'right' });
    }
    hints(scr, '◂ ▸ ▴ ▾ CHOOSE · ● OPEN · SELECT BACK', P, H - 10, P.paper);
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
  if (v && v.ok) stamp(scr, [['FILED', 2], [fitText(v.text, 200), 1]], 250, 40, P.stamp, { seed: p.id, angle: 0.1 });
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
    header(scr, 16, 10, 288, `SHIFT REPORT · SHIFT ${d.n} · ${d.code}`, P, `RECORDER ${RECORDER}`);
    let y = 38;
    for (const r of o.requests) {
      drawText(scr, r.done ? '✓' : '×', 20, y, r.done ? P.ink : P.mid);
      drawText(scr, fitText(requestText(r), 200), 30, y, r.done ? P.ink : P.mid);
      drawText(scr, r.done ? `+${r.merit}` : '—', 300, y, P.ink, { align: 'right' });
      y += 11;
    }
    y += 2; rule(scr, 16, 304, y, P); y += 6;
    const met = g.filed() >= o.quota;
    const rows = [
      [`FILED ${g.filed()} OF ${o.requests.length} · QUOTA ${o.quota}`, met ? 'MET' : 'NOT MET'],
      ['EXPOSURES USED', `${o.shots}`],
      ['MERIT FOR REQUESTS', `${o.earned}`],
      met ? ['DILIGENCE BONUS (20%)', `+${o.bonus}`] : ['CITATION', `−${o.citation}`],
      ['MERIT ON HAND', `${g.save.merit}`],
    ];
    for (const [a, b] of rows) { drawText(scr, a, 20, y, P.ink); drawText(scr, b, 300, y, P.ink, { align: 'right' }); y += 11; }
    if (this.stamped) stamp(scr, met ? [['APPROVED', 2]] : [['CITATION', 2], ['QUOTA NOT MET', 1]], 236, 196, P.stamp, { seed: 40 + d.n, angle: -0.16, reveal: Math.min(1, (this.t - 0.9) * 6) });
    if (this.t > 0.9 && blink(g.t, 1.5)) drawText(scr, '● REQUISITIONS', 20, 222, P.ink);
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
    else if (res === 'poor') { g.sfx.deny(); g.toast('INSUFFICIENT MERIT'); }
    else { g.sfx.deny(); g.toast('ALREADY AT THE HIGHEST GRADE'); }
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, rows = this.rows();
    desk(scr, P);
    paper(scr, 6, 6, 308, 228, P);
    header(scr, 12, 10, 296, 'REQUISITION FORM 12-B', P, `MERIT ${g.save.merit}`);
    let y = 38;
    rows.forEach((r, k) => {
      const on = k === this.sel;
      if (r.begin) {
        const label = g.day >= LAST_DAY ? 'RETURN TO TITLE' : `BEGIN SHIFT ${g.day + 1} ▸`;
        y += 4;
        if (on) scr.rect(12, y - 3, 164, 13, P.ink);
        drawText(scr, label, 18, y, on ? P.paper : P.ink);
        return;
      }
      const tiers = g.trackDef(r.track), cur = g.tier(r.track), next = cur + 1;
      if (on) scr.rect(12, y - 3, 164, 23, P.ink);
      const fg = on ? P.paper : P.ink;
      if (next >= tiers.length) {
        drawText(scr, tiers[cur].name, 18, y, fg); drawText(scr, 'MAX', 172, y, fg, { align: 'right' });
        drawText(scr, tiers[cur].spec || '', 18, y + 10, on ? P.paper : P.mid);
      } else {
        drawText(scr, tiers[next].name, 18, y, fg);
        drawText(scr, String(r.costs[next]), 172, y, fg, { align: 'right' });
        drawText(scr, fitText(`${tiers[next].spec} (NOW ${tiers[cur].spec || 'OFF'})`, 152), 18, y + 10, on ? P.paper : P.mid);
      }
      if (this.flash > 0 && this.flashRow === k) stamp(scr, [['APPROVED', 1]], 140, y + 6, P.stamp, { seed: k + 3, angle: -0.2 });
      y += 26;
    });
    // Live preview of the highlighted grade.
    const r = rows[this.sel];
    let s = g.sensor, tn = g.tone, cap = 'PREVIEW: CURRENT';
    if (r && !r.begin) {
      const next = Math.min(g.tier(r.track) + 1, g.trackDef(r.track).length - 1);
      if (r.track === 'sensor') { s = SENSORS[next]; cap = `PREVIEW: ${SENSORS[next].name}`; }
      if (r.track === 'tone') { tn = TONES[next]; cap = `PREVIEW: ${TONES[next].name}`; }
    }
    scr.rect(183, 37, 124, 94, P.ink);
    if (g.camera.ready) g.renderLive(1, s, tn, [185, 39, 120, 90]); else g.noSignal([185, 39, 120, 90]);
    drawText(scr, cap, 245, 136, P.ink, { align: 'center' });
    const lines = wrapText(shopNote(r), 120);
    lines.forEach((l, k) => drawText(scr, l, 185, 150 + k * LINE_H, P.mid));
    for (const t of g.toasts) notice(scr, t.text, P, 104);
  }
}
function shopNote(r) {
  if (!r || r.begin) return 'UNSPENT MERIT CARRIES OVER.';
  return {
    sensor: 'MORE PIXELS. SHARPER EVIDENCE PAYS MORE MERIT.',
    tone: 'MORE TONES, THEN COLOUR.',
    lens: 'DIGITAL ZOOM WITH ▴ ▾. SUBJECTS NEED NOT KNOW.',
    film: 'MORE EXPOSURES PER SHIFT.',
    tracking: 'LIVE BOXES ON EVERY OBJECT THE INVENTORY KNOWS.',
  }[r.track];
}

// =========================================================================== SETTINGS
export class Settings {
  constructor(g) { this.g = g; this.sel = 0; this.jump = 1; }
  enter(from) { this.from = from === 'menu' ? 'menu' : 'title'; this.sel = 0; this.jump = this.g.day; }
  items() {
    const s = this.g.save.settings, g = this.g;
    const st = (id) => g.modules.st[id].state;
    const models = ['objects', 'faces', 'affect', 'intent'];
    const nReady = models.filter((id) => st(id) === 'ready').length;
    const loading = models.filter((id) => st(id) === 'loading');
    return [
      { id: 'theme', label: 'PALETTE', value: `◂ ${(THEMES.find((x) => x.id === s.theme) || THEMES[0]).name} ▸` },
      { id: 'sound', label: 'SOUND', value: s.sound ? 'ON' : 'OFF' },
      { id: 'haptics', label: 'VIBRATION', value: s.haptics ? 'ON' : 'OFF' },
      { id: 'facing', label: 'CAMERA', value: s.facing === 'user' ? 'FRONT' : 'BACK' },
      { id: 'tap', label: 'TAP SCREEN TO SHOOT', value: s.tapShoot ? 'ON' : 'OFF' },
      { id: 'jump', label: 'DEV: JUMP TO SHIFT', value: `◂ ${this.jump} ▸`, dim: true },
      { id: 'unlock', label: 'DEV: UNLOCK EVERYTHING', value: g.save.dev.unlockAll ? 'ON' : 'OFF', dim: true },
      { id: 'models', label: 'DEV: DOWNLOAD ALL MODELS', value: loading.length ? `${MODULES[loading[0]].name} ${Math.round(g.modules.st[loading[0]].progress * 100)}%` : `${nReady}/4 READY`, dim: true },
      { id: 'erase', label: 'ERASE EVERYTHING', dim: true },
      { id: 'back', label: 'BACK' },
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
    else if (id === 'sound') { s.sound = !s.sound; g.sfx.on = s.sound; }
    else if (id === 'haptics') { s.haptics = !s.haptics; g.buzz(30); }
    else if (id === 'facing') { s.facing = s.facing === 'user' ? 'environment' : 'user'; g.camera.start(s.facing); }
    else if (id === 'tap') s.tapShoot = !s.tapShoot;
    else if (id === 'jump') {
      if (dir) this.jump = Math.max(1, Math.min(LAST_DAY, this.jump + dir));
      else { g.jumpTo(this.jump); g.toast(`NOW ON SHIFT ${this.jump}`); return g.go('order'); }
    } else if (id === 'unlock') g.save.dev.unlockAll = !g.save.dev.unlockAll;
    else if (id === 'models') ['objects', 'faces', 'affect', 'intent'].forEach((m) => g.modules.ensure(m));
    else if (id === 'erase') return g.go('confirm', { text: 'ERASE EVERYTHING: SHIFTS, MERIT, SETTINGS AND EVERY EXPOSURE?', yes: 'ERASE', no: 'KEEP', danger: true, onYes: () => { g.newGame(); g.go('title'); }, onNo: () => g.go('settings', this.from) });
    else if (id === 'back') return g.go(this.from);
    g.persist();
  }
  draw() {
    const g = this.g, scr = g.scr, P = g.P, items = this.items();
    desk(scr, P);
    paper(scr, 20, 8, 280, 224, P);
    header(scr, 26, 12, 268, 'UNIT SETTINGS', P);
    list(scr, items, this.sel, 24, 42, 272, P, 13);
    hints(scr, '◂ ▸ CHANGE · ● OK · SELECT BACK', P, 218);
    for (const t of g.toasts) notice(scr, t.text, P, 104);
  }
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
        this.res.cv = time('cv', () => analyzeCV(small, 160, 120));
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
    await runs('CHROMA+FORM', () => { sctx.drawImage(c, 0, 0, 160, 120); analyzeCV(sctx.getImageData(0, 0, 160, 120).data, 160, 120); });
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
        this.doc('NOTICE OF COMPLETION', [
          `THE FILE ON RECORDER ${RECORDER} IS COMPLETE.`, '',
          `EXPOSURES ON FILE: ${this.count}`, `EXPOSURES WITH SUBJECTS: ${this.subjects}`, `REQUESTS FILED: ${this.filedN}`, '',
          'EVERY EXPOSURE DESCRIBES THE ONE WHO TOOK IT: WHERE YOU WENT, WHAT YOU NOTICED, WHOM YOU CHOSE TO RECORD.',
          'THE OFFICE THANKS YOU FOR YOUR SERVICE. YOUR CLEARANCE IS REVOKED.',
        ]);
        if (this.step === 2) stamp(scr, [['FILED', 3], [`RECORDER ${RECORDER}`, 1]], 230, 186, P.stamp, { seed: 99, angle: -0.18 });
        return;
      }
      // Clearance revoked: the picture falls back to the first, crudest grade.
      if (g.camera.ready) g.renderLive(1, SENSORS[0], TONES[0]); else g.noSignal();
      notice(scr, 'CLEARANCE REVOKED', P, 104);
      if (this.t > 1.5) drawText(scr, 'END · ● RETURN', W / 2, 220, P.paper, { align: 'center', bg: P.ink });
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
      if (this.t > 2.4) drawText(scr, '● CONTINUE', W - 4, H - 10, P.ink, { align: 'right' });
      return;
    }
    if (this.step === 1 || this.step === 2) {
      this.doc('INCIDENT REPORT', [
        `UNIT OCR-7, ISSUED TO RECORDER ${RECORDER}, WAS RETURNED WITH ITS BACK OPEN.`, '',
        `EXPOSURES LOST TO LIGHT: ${this.count}`, 'RECORDS RECOVERED: 0', '',
        `RECORDER ${RECORDER} COULD NOT BE REACHED FOR COMMENT.`,
      ]);
      if (this.step === 2) stamp(scr, [['INCOMPLETE', 2]], 220, 186, P.stamp, { seed: 98, angle: -0.14 });
      return;
    }
    scr.clear(P.paper);
    drawText(scr, 'CLEARANCE', W / 2, 90, P.ink, { scale: 3, align: 'center' });
    drawText(scr, 'NO FILE', W / 2, 124, P.ink, { align: 'center' });
    if (this.t > 1.5) drawText(scr, 'END · ● RETURN', W / 2, 220, P.ink, { align: 'center' });
  }
  doc(title, lines) {
    const g = this.g, scr = g.scr, P = g.P;
    desk(scr, P);
    paper(scr, 14, 10, 292, 220, P);
    header(scr, 20, 14, 280, title, P, `RECORDER ${RECORDER}`);
    let y = 44;
    for (const l of lines) { for (const w of wrapText(l, 272)) { drawText(scr, w, 24, y, P.ink); y += LINE_H; } if (!l) y += 3; }
    if (this.t > 1 && blink(g.t, 1.5)) drawText(scr, '● CONTINUE', 296, 218, P.ink, { align: 'right' });
  }
  contactSheet() {
    const g = this.g, scr = g.scr, P = g.P, ps = this.photos;
    scr.clear(P.ink);
    drawText(scr, `FILE ${RECORDER} · ${ps.length} EXPOSURES`, 4, 3, P.paper);
    const n = Math.max(1, ps.length), cols = n > 30 ? 8 : n > 12 ? 6 : 4, tw = Math.floor((W - 8) / cols) - 2, th = Math.floor((tw * 3) / 4);
    const shown = Math.min(ps.length, Math.floor(this.t * 8));
    for (let k = 0; k < shown; k++) {
      const p = ps[k], x = 4 + (k % cols) * (tw + 2), y = 14 + Math.floor(k / cols) * (th + 2);
      if (y + th > H - 12) break;
      scr.blitTo(p.px, p.w, p.h, x, y, tw, th);
    }
    if (this.t > 1) drawText(scr, '● CONTINUE', W - 4, H - 10, P.paper, { align: 'right' });
  }
}
