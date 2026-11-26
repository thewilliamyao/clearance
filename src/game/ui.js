// Drawing helpers for the Office's paperwork: desk, paper, seal, rubber stamps, lists.
import { W, H } from '../engine/screen.js';
import { drawText, textWidth, wrapText, LINE_H, GLYPH_H } from '../engine/font.js';
import { t } from './text.js';

export { drawText, textWidth, wrapText, LINE_H, GLYPH_H };

// The desk the paperwork sits on: ink with a faint dot grain.
export function desk(scr, P) {
  scr.clear(P.ink);
  for (let y = 1; y < H; y += 4) for (let x = (y >> 2) & 1 ? 3 : 1; x < W; x += 4) scr.pset(x, y, P.dark);
}

export function paper(scr, x, y, w, h, P) {
  scr.checker(x + 3, y + 3, w, h, P.ink);
  scr.rect(x, y, w, h, P.paper);
  scr.frame(x, y, w, h, P.ink);
}

// A dashed rule across a document.
export function rule(scr, x0, x1, y, P) { for (let x = x0; x <= x1; x += 2) scr.pset(x, y, P.ink); }

// The Office seal: an eye inside a lens ring.
export function seal(scr, cx, cy, r, ink, bg) {
  scr.disc(cx, cy, r, bg);
  scr.circle(cx, cy, r, ink);
  if (r >= 9) scr.circle(cx, cy, r - 2, ink);
  if (r >= 13) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    scr.pset(cx + Math.round(Math.cos(a) * (r - 1)), cy + Math.round(Math.sin(a) * (r - 1)), ink);
  }
  const b = Math.max(3, Math.round(r * 0.62)), a = Math.max(2, Math.round(r * 0.36));
  for (let x = -b; x <= b; x++) {
    const yy = Math.round(a * (1 - (x / b) ** 2));
    scr.pset(cx + x, cy - yy, ink); scr.pset(cx + x, cy + yy, ink);
  }
  const pr = Math.max(1, Math.round(r * 0.24));
  scr.disc(cx, cy, pr, ink);
  if (pr >= 2) scr.pset(cx - 1, cy - 1, bg);
}

export function header(scr, x, y, w, title, P, right = '') {
  seal(scr, x + 9, y + 9, 8, P.ink, P.paper);
  drawText(scr, t('global.office'), x + 21, y + 2, P.ink);
  drawText(scr, title, x + 21, y + 11, P.ink);
  if (right) drawText(scr, right, x + w, y + 2, P.ink, { align: 'right' });
  rule(scr, x, x + w, y + 21, P);
}

// --- rubber stamps --------------------------------------------------------------------------
class Mask {
  constructor(w, h) { this.w = w; this.h = h; this.m = new Uint8Array(w * h); }
  pset(x, y) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.m[y * this.w + x] = 1; }
  rect(x, y, w, h) { for (let yy = y | 0; yy < (y + h) | 0; yy++) for (let xx = x | 0; xx < (x + w) | 0; xx++) this.pset(xx, yy); }
  frame(x, y, w, h, t) { this.rect(x, y, w, t); this.rect(x, y + h - t, w, t); this.rect(x, y, t, h); this.rect(x + w - t, y, t, h); }
}

const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function smooth(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

// lines: [[text, scale], ...]. Drawn rotated by `angle` with worn, uneven ink.
// reveal 0..1 lets a stamp "land" (it grows from a smaller size for a frame or two).
export function stamp(scr, lines, cx, cy, color, { angle = -0.13, seed = 7, pad = 5, reveal = 1 } = {}) {
  const sizes = lines.map(([t, s]) => ({ t, s, w: textWidth(t, s), h: GLYPH_H * s }));
  const iw = Math.max(...sizes.map((z) => z.w)) + pad * 2 + 6;
  const ih = sizes.reduce((a, z) => a + z.h, 0) + (sizes.length - 1) * 4 + pad * 2 + 6;
  const m = new Mask(iw, ih);
  m.frame(0, 0, iw, ih, 2);
  m.frame(4, 4, iw - 8, ih - 8, 1);
  let ty = pad + 3;
  for (const z of sizes) {
    drawText(m, z.t, Math.round((iw - z.w) / 2), ty, 1, { scale: z.s });
    ty += z.h + 4;
  }
  const k = 1 / Math.max(0.3, reveal);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const R = Math.ceil(Math.hypot(iw, ih) / 2 / Math.max(0.3, reveal)) + 2;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const sx = (dx * ca + dy * sa) * k + iw / 2, sy = (-dx * sa + dy * ca) * k + ih / 2;
    const ix = Math.floor(sx), iy = Math.floor(sy);
    if (ix < 0 || iy < 0 || ix >= iw || iy >= ih || !m.m[iy * iw + ix]) continue;
    const px = cx + dx, py = cy + dy;
    if (hash(px, py, seed) < 0.035 + 0.28 * Math.max(0, smooth(px / 6, py / 6, seed) - 0.5)) continue;
    scr.pset(px, py, color);
  }
}

// --- lists and notices ----------------------------------------------------------------------
// items: [{ label, value?, dim? }]. Returns the row height used.
export function list(scr, items, sel, x, y, w, P, rowH = 11) {
  items.forEach((it, i) => {
    const yy = y + i * rowH, on = i === sel;
    if (on) scr.rect(x, yy - 2, w, rowH, P.ink);
    const fg = on ? P.paper : it.dim ? P.mid : P.ink;
    if (on) drawText(scr, '▸', x + 3, yy, fg);
    drawText(scr, it.label, x + 10, yy, fg);
    if (it.value !== undefined) drawText(scr, it.value, x + w - 4, yy, fg, { align: 'right' });
  });
  return rowH;
}

export function notice(scr, text, P, y = 108, invert = false) {
  const lines = wrapText(text, 240);
  const w = Math.max(...lines.map((l) => textWidth(l))) + 14, h = lines.length * LINE_H + 9;
  const x = Math.round((W - w) / 2);
  const bg = invert ? P.paper : P.ink, fg = invert ? P.ink : P.paper;
  scr.rect(x - 1, y - 1, w + 2, h + 2, fg);
  scr.rect(x, y, w, h, bg);
  lines.forEach((l, i) => drawText(scr, l, W / 2, y + 5 + i * LINE_H, fg, { align: 'center' }));
}

export function bar(scr, x, y, w, frac, P, bg = P.paper, fg = P.ink) {
  scr.rect(x, y, w, 5, bg);
  scr.frame(x, y, w, 5, fg);
  scr.rect(x + 1, y + 1, Math.round((w - 2) * Math.max(0, Math.min(1, frac))), 3, fg);
}

// A dimmed backdrop: ink checker over whatever is on screen.
export function dim(scr, P, x = 0, y = 0, w = W, h = H) { scr.checker(x, y, w, h, P.ink); }

// Footer hints in the house style.
export function hints(scr, text, P, y = H - 10, color = P.ink) { drawText(scr, text, W / 2, y, color, { align: 'center' }); }
