// Pixel previews for the controller, drawn by the game's own code: the real font, paper,
// stamps and the real screens (work order, viewfinder, report, endings…) on a stand-in for
// the game that only has what drawing needs. So a memo that runs into the request list here
// runs into it on the unit.
import { Screen, W, H, unpack } from '../src/engine/screen.js';
import { THEMES, themeColors, STAMP } from '../src/engine/palette.js';
import { drawText, textWidth, wrapText, fitText, LINE_H, GLYPH_H, glyphChars } from '../src/engine/font.js';
import { stamp, dim, notice } from '../src/game/ui.js';
import * as S from '../src/game/screens.js';
import { TRACKS } from '../src/game/game.js';
import { DAYS, LAST_DAY, makeOrder, seeded, issuedBy } from '../src/game/days.js';
import { SENSORS, TONES, LENSES, FILMS } from '../src/game/tiers.js';
import { REQUESTS } from '../src/game/requests.js';
import { INDEX_LABELS } from '../src/game/labels.js';
import { t, fill } from '../src/game/text.js';

export const P = { ...themeColors(THEMES[0]), stamp: STAMP };
export const css = (c) => '#' + unpack(c).map((v) => v.toString(16).padStart(2, '0')).join('');
const GLYPHS = new Set([...glyphChars(), ' ', '\n']);

// Characters the unit's font can't draw (they print as ?).
export function missingGlyphs(s) {
  const out = new Set();
  for (const ch of String(s)) if (!GLYPHS.has(ch) && !GLYPHS.has(ch.toUpperCase())) out.add(ch);
  return [...out];
}

// A small framebuffer of any size, with what the font and stamps draw with.
export class Raster {
  constructor(w, h, canvas = document.createElement('canvas')) {
    this.w = w; this.h = h; this.canvas = canvas;
    canvas.width = w; canvas.height = h;
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }
  clear(c) { this.buf.fill(c); }
  pset(x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.buf[y * this.w + x] = c; }
  rect(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) this.buf.fill(c, yy * this.w + x0, yy * this.w + x1);
  }
  hline(x0, x1, y, c) { if (x1 < x0) [x0, x1] = [x1, x0]; this.rect(x0, y, x1 - x0 + 1, 1, c); }
  circle(cx, cy, r, c) {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.pset(cx + px, cy + py, c);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }
  disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) { const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8)); this.hline(cx - w, cx + w, cy + y, c); } }
  present() { this.ctx.putImageData(this.img, 0, 0); return this.canvas; }
}

// How a line sits in its box: its rows as the unit wraps them, and whether it fits.
export function measure(text, fit) {
  const scale = fit.scale || 1;
  if (fit.doc) {
    // The endings' documents: each line is a paragraph; an empty one leaves a gap.
    const rows = [];
    for (const para of String(text).split('\n')) { const w = wrapText(para, fit.w, scale); rows.push(...w); }
    const n = rows.length;
    return { rows, wide: 0, over: n > fit.lines ? n - fit.lines : 0, n };
  }
  if (fit.lines) {
    const rows = wrapText(text, fit.w, scale);
    const wide = Math.max(0, ...rows.map((r) => textWidth(r, scale) - fit.w)); // one word longer than the box
    return { rows, wide, over: Math.max(0, rows.length - fit.lines), n: rows.length };
  }
  const rows = String(text).split('\n');
  const wide = Math.max(0, ...rows.map((r) => textWidth(r, scale) - fit.w));
  return { rows, wide, over: Math.max(0, rows.length - 1), n: rows.length };
}

// One line drawn in its box, at the unit's pixel size (the canvas is scaled up in CSS).
// The box is the paper; anything outside it is shaded.
export function lineCanvas(text, fit, canvas) {
  const scale = fit.scale || 1, m = measure(text, fit);
  const rowH = (fit.lines || fit.doc ? LINE_H : GLYPH_H + 2) * scale;
  const pad = 3;
  const boxW = fit.w, boxRows = Math.max(1, fit.lines || 1);
  const w = Math.max(boxW, ...m.rows.map((r) => textWidth(r, scale))) + pad * 2 + 1;
  const h = Math.max(boxRows, m.rows.length) * rowH + pad * 2 - (fit.lines || fit.doc ? (LINE_H - GLYPH_H) * scale : 2 * scale) + 1;
  const r = new Raster(w, h, canvas);
  r.clear(P.mid);
  r.rect(0, 0, boxW + pad * 2, boxRows * rowH + pad * 2 - (fit.lines || fit.doc ? (LINE_H - GLYPH_H) * scale : 2 * scale), P.paper);
  // A line the unit cuts with … (fitText) is drawn cut, the way it shows.
  m.rows.forEach((row, k) => drawText(r, fit.cut && !fit.lines ? fitText(row, fit.w, scale) : row, pad, pad + k * rowH, k >= boxRows ? P.stamp : P.ink, { scale }));
  if (m.wide) for (let y = 0; y < h; y += 2) r.pset(pad + boxW, y, P.stamp);
  return { canvas: r.present(), ...m };
}

// --- a stand-in for the game, for drawing whole screens ---------------------------------------
const MOD_STATE = () => Object.fromEntries(['chroma', 'form', 'objects', 'faces', 'affect', 'intent'].map((id) => [id, { state: 'ready', progress: 1, ms: 0, error: '' }]));

// A plain 40x30 scene for the viewfinder: a window, a floor, a figure.
function scene() {
  const w = 40, h = 30, px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let ink = y > 21 ? ((x + y) % 5 === 0) : false;
    if (x > 5 && x < 16 && y > 4 && y < 15) ink = !(x === 10 || y === 9);
    else if (y <= 21) ink = (x * 3 + y * 7) % 23 === 0;
    const fig = (x - 27) ** 2 / 9 + (y - 10) ** 2 / 9 < 1 || (x >= 24 && x <= 30 && y >= 13 && y <= 26);
    px[y * w + x] = fig ? P.ink : ink ? P.ink : P.paper;
  }
  return { px, w, h };
}
const SCENE = scene();

export class FakeGame {
  constructor(n = 1, order = null) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W; this.canvas.height = H;
    this.scr = new Screen(this.canvas);
    this.P = P;
    this.t = 0;
    this.toasts = [];
    this.track = { faces: [], objects: [] };
    this.modules = { st: MOD_STATE() };
    this.camera = { ready: false, state: 'live', error: '' };
    this.index = { connected: true, data: { total: 0, labels: INDEX_LABELS.map((label) => ({ label, n: 0, entries: [] })) }, loading: null, mine: () => null, statusOf: () => null };
    this.store = { list: [] };
    this.stateName = 'field';
    const own = issuedBy(n);
    this.save = { day: n, phase: 'field', merit: 120 * (n - 1) + 45, own, settings: { theme: 'ledger', body: 'silver', sound: true, haptics: true, tapShoot: true, facing: 'environment', hud: 0, share: false }, dev: { unlockAll: false }, selfMisses: 0 };
    this.order = order || this.drawOrder(1);
  }
  get day() { return this.save.day; }
  get dayDef() { return DAYS[this.save.day - 1]; }
  drawOrder(seed) {
    const { requests, quota } = makeOrder(this.day, seeded(seed * 7919 + this.day), []);
    return { requests, quota, film: FILMS[this.tier('film')].n, filmMax: FILMS[this.tier('film')].n, earned: 0, shots: 0, seed, day: this.day };
  }
  tier(track) { return Math.max(0, this.save.own[track] || 0); }
  trackDef(track) { return TRACKS[track]; }
  get sensor() { return SENSORS[this.tier('sensor')]; }
  get tone() { return TONES[this.tier('tone')]; }
  get maxZoom() { return LENSES[this.tier('lens')].zoom; }
  enabledModules() { return this.dayDef.modules; }
  filed() { return this.order ? this.order.requests.filter((r) => r.done).length : 0; }
  withdrawn() { return this.order ? this.order.requests.filter((r) => r.withdrawn).length : 0; }
  quotaMet() { return this.order && this.filed() >= this.order.quota; }
  renderLive(zoom, sensor, tone, rect = [0, 0, W, H]) {
    const [x, y, w, h] = rect;
    if (w === W && h === H) this.scr.blit(SCENE.px, SCENE.w, SCENE.h, 0, 0, W / SCENE.w);
    else this.scr.blitTo(SCENE.px, SCENE.w, SCENE.h, x, y, w, h);
    return true;
  }
  noSignal([x, y, w, h] = [0, 0, W, H]) { this.scr.rect(x, y, w, h, P.ink); }
  done() { this.scr.present(); return this.canvas; }
}

// Each screen preview returns a 320x240 canvas. n: the shift; seed re-draws the sample order.
export const SCREENS = {
  title(n) {
    const g = new FakeGame(n);
    g.save.phase = 'order';
    const s = new S.Title(g); s.items = s.makeItems(); s.t = 10; s.sel = 0;
    g.camera.ready = true; s.draw();
    return g.done();
  },
  order(n, seed = 1) {
    const g = new FakeGame(n); g.order = g.drawOrder(seed);
    const s = new S.Order(g); s.t = 999; s.view = false; s.draw();
    return g.done();
  },
  viewfinder(n, seed = 1) {
    const g = new FakeGame(n); g.order = g.drawOrder(seed);
    const s = new S.Viewfinder(g); s.focus = 0; s.zoom = 1; s.live = null; s.hintT = n === 1 ? 1 : 0;
    s.draw();
    return g.done();
  },
  quotaBubble(n, seed = 1) {
    const g = new FakeGame(n); g.order = g.drawOrder(seed);
    g.order.requests.slice(0, g.order.quota).forEach((r) => { r.done = true; r.merit = 30; });
    g.order.earned = 30 * g.order.quota;
    const s = new S.Viewfinder(g); s.focus = 0; s.zoom = 1; s.live = null; s.hintT = 0;
    s.bubble = { kind: 'quota', t: 1, sel: 0 };
    s.draw();
    return g.done();
  },
  filmBubble(n, seed = 1) {
    const g = new FakeGame(n); g.order = g.drawOrder(seed); g.order.film = 0;
    const s = new S.Viewfinder(g); s.focus = 0; s.zoom = 1; s.live = null; s.hintT = 0;
    s.bubble = { kind: 'film', t: 1, sel: 0 };
    s.draw();
    return g.done();
  },
  ask(n, seed, question) {
    const g = new FakeGame(5);
    g.renderLive(1);
    S.askBubble(g.scr, P, question || t('verdict.noSubject'), 1, 0);
    drawText(g.scr, t('develop.continue'), W - 4, 3, P.paper, { align: 'right', bg: P.ink });
    return g.done();
  },
  filed(n, seed, text = 'SOMETHING RED', merit = 33) {
    const g = new FakeGame(n);
    g.renderLive(1);
    S.filedStamp(g.scr, P, text, merit, 3);
    drawText(g.scr, t('develop.continue'), W - 4, 3, P.paper, { align: 'right', bg: P.ink });
    return g.done();
  },
  notFiled(n, seed, why) {
    const g = new FakeGame(n);
    g.renderLive(1);
    S.notFiledStamp(g.scr, P, why || t('verdict.noSubject'), 4);
    drawText(g.scr, t('develop.continue'), W - 4, 3, P.paper, { align: 'right', bg: P.ink });
    return g.done();
  },
  menu(n) {
    const g = new FakeGame(n);
    g.renderLive(1); g.scr.snapshot();
    const s = new S.Menu(g); s.enter(null, 'field'); s.draw();
    return g.done();
  },
  confirm(n, seed, a) {
    const g = new FakeGame(n);
    g.renderLive(1); g.scr.snapshot();
    const s = new S.Confirm(g); s.a = a || { text: t('menu.endEarly', { FILED: 1, QUOTA: 3 }), yes: t('menu.endYes'), no: t('menu.endNo') }; s.sel = 1;
    s.draw();
    return g.done();
  },
  report(n, seed = 1, met = true) {
    const g = new FakeGame(n); const o = g.drawOrder(seed);
    o.requests.forEach((r, i) => { if (i < (met ? o.quota : Math.max(0, o.quota - 1))) { r.done = true; r.merit = REQUESTS[r.key] ? REQUESTS[r.key].merit : 0; } });
    o.earned = o.requests.reduce((a, r) => a + (r.merit || 0), 0); o.shots = 9;
    o.bonus = met ? Math.round(o.earned * 0.2) : 0; o.citation = met ? 0 : 15; o.closed = true;
    g.order = o;
    const s = new S.Report(g); s.o = o; s.t = 2; s.stamped = true; s.draw();
    return g.done();
  },
  shop(n) {
    const g = new FakeGame(n); g.camera.ready = true;
    const s = new S.Shop(g); s.sel = 0; s.t = 0; s.flash = 0; s.draw();
    return g.done();
  },
  settings(n) {
    const g = new FakeGame(n);
    const s = new S.Settings(g); s.sel = 6; s.jump = n; s.from = 'title'; s.draw();
    return g.done();
  },
  index(n) {
    const g = new FakeGame(n);
    const s = new S.IndexScreen(g); s.level = 0; s.row = 0; s.top = 0; s.draw();
    return g.done();
  },
  nocam(n) {
    const g = new FakeGame(n);
    const s = new S.NoCamera(g); s.draw();
    return g.done();
  },
  endingFiled(n, seed, step = 1) {
    const g = new FakeGame(LAST_DAY);
    const s = new S.Ending(g); Object.assign(s, { kind: 'filed', step, t: 2, since: 0, count: 41, subjects: 23, filedN: 26, photos: [] });
    s.draw();
    return g.done();
  },
  endingRevoked() {
    const g = new FakeGame(LAST_DAY); g.camera.ready = true;
    const s = new S.Ending(g); Object.assign(s, { kind: 'filed', step: 3, t: 2, since: 0, count: 41, subjects: 23, filedN: 26, photos: [] });
    s.draw();
    return g.done();
  },
  endingExposed(n, seed, step = 2) {
    const g = new FakeGame(6);
    const s = new S.Ending(g); Object.assign(s, { kind: 'exposed', step, t: 2, since: 0, count: 41, subjects: 23, filedN: 26, photos: [] });
    s.draw();
    return g.done();
  },
  endingNoFile() {
    const g = new FakeGame(6);
    const s = new S.Ending(g); Object.assign(s, { kind: 'exposed', step: 3, t: 2, since: 0, count: 41, subjects: 23, filedN: 26, photos: [] });
    s.draw();
    return g.done();
  },
  notice(n, seed, text) {
    const g = new FakeGame(n);
    g.renderLive(1);
    notice(g.scr, text || '', P, 104);
    return g.done();
  },
};

export { fill, t, W, H };
