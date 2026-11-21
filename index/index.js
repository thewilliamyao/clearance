// The Index, as a web page: every label's prints, as the Office's forms. It reads the same
// shared index as the camera's INDEX screen (server/ in the game's folder) and draws with the
// game's own font, seal, stamps and palettes.
//   ?index=<url>  another index (local tests: ?index=http://localhost:8787)
//   ?admin        William's view: paste the admin key once per tab to delete or approve prints
import { drawText, textWidth, GLYPH_H } from '../src/engine/font.js';
import { THEMES, STAMP, themeColors } from '../src/engine/palette.js';
import { unpack } from '../src/engine/screen.js';
import { seal, stamp } from '../src/game/ui.js';
import { LEARNED_LABEL } from '../src/game/labels.js';
import { heading, unpackBits, fromB64, dayText, indexNo, indexBase, PRINT_W, PRINT_H } from '../src/game/shared-index.js';

const API = indexBase();
const params = new URLSearchParams(location.search);
const ADMIN = params.has('admin');
const PER = 60;
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* fine */ } },
};

// --- drawing ---------------------------------------------------------------------------------
// A small framebuffer with the methods the game's font, seal and stamps draw with.
class Raster {
  constructor(w, h, canvas = document.createElement('canvas')) {
    this.w = w; this.h = h; this.canvas = canvas;
    canvas.width = w; canvas.height = h;
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }
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

const css = (c) => '#' + unpack(c).map((v) => v.toString(16).padStart(2, '0')).join('');
let theme = THEMES.find((t) => t.id === (store.get('clearance.index.theme') || savedGameTheme())) || THEMES[0];
let P = themeColors(theme);
function savedGameTheme() { try { return JSON.parse(store.get('clearance.save.v1')).settings.theme; } catch { return null; } }

// Everything drawn in the palette, so a palette change can redraw it.
const drawn = new Set();
function keep(fn) { drawn.add(fn); fn(); return fn; }

function textCanvas(canvas, text, color = () => P.paper) {
  keep(() => {
    const r = new Raster(Math.max(1, textWidth(text)), GLYPH_H, canvas);
    drawText(r, text, 0, 0, color());
    r.present();
    canvas.style.setProperty('--w', r.w);
  });
  return canvas;
}
function sealCanvas(canvas, onPaper) {
  keep(() => { const r = new Raster(19, 19, canvas); seal(r, 9, 9, 8, onPaper ? P.ink : P.paper, onPaper ? P.paper : P.ink); r.present(); });
  return canvas;
}
function drawPrint(canvas, px) {
  const r = new Raster(PRINT_W, PRINT_H, canvas);
  for (let i = 0; i < px.length; i++) r.buf[i] = px[i] ? P.paper : P.ink;
  r.present();
}
// The Office's stamp, the way the camera prints it: FILED AS / SAD.
function stampCanvas(canvas, word, seed) {
  const lines = [['FILED AS', 1], [word, 2]];
  const iw = Math.max(...lines.map(([t, s]) => textWidth(t, s))) + 16, ih = lines.reduce((a, [, s]) => a + GLYPH_H * s, 0) + 4 + 16;
  const R = Math.ceil(Math.hypot(iw, ih) / 2) + 3;
  const r = new Raster(2 * R, Math.ceil(ih * 1.25) + 6, canvas);
  stamp(r, lines, R, Math.round(r.h / 2), STAMP, { seed, angle: -0.08 });
  r.present();
  const cx = Math.min(236, 320 - textWidth(word, 2) / 2 - 16), cy = 46;
  Object.assign(canvas.style, { width: `${(r.w / 320) * 100}%`, left: `${((cx - R) / 320) * 100}%`, top: `${((cy - r.h / 2) / 240) * 100}%` });
}

function applyTheme() {
  P = themeColors(theme);
  const root = document.documentElement.style;
  root.setProperty('--ink', css(P.ink)); root.setProperty('--paper', css(P.paper));
  root.setProperty('--mid', css(P.mid)); root.setProperty('--dark', css(P.dark));
  document.querySelector('meta[name="theme-color"]').content = theme.ink;
  for (const fn of drawn) fn();
  for (const s of document.querySelectorAll('.swatch')) s.setAttribute('aria-pressed', String(s.dataset.theme === theme.id));
}

// --- the page --------------------------------------------------------------------------------
const state = { labels: [], total: 0, held: [], token: ADMIN ? session.get('clearance.index.admin') : null };
const words = (label) => LEARNED_LABEL[label] || label.toUpperCase();

// The palette buttons (once).
function swatches() {
  const sw = $('swatches');
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.className = 'swatch'; b.type = 'button'; b.dataset.theme = t.id;
    b.title = t.name; b.setAttribute('aria-label', `Palette: ${t.name}`);
    b.style.background = `linear-gradient(90deg, ${t.ink} 50%, ${t.paper} 50%)`;
    b.onclick = () => { theme = t; store.set('clearance.index.theme', t.id); applyTheme(); };
    sw.appendChild(b);
  }
}

function setStatus(text, retry) {
  const s = $('status');
  s.hidden = !text;
  s.textContent = text || '';
  if (retry) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'TRY AGAIN'; b.onclick = load; s.appendChild(b); }
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, opts);
  if (!res.ok) { const e = new Error(`${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

async function load() {
  if (!API) { setStatus('THE INDEX IS NOT CONNECTED YET.'); return; }
  setStatus('CONTACTING THE INDEX…');
  try {
    const j = await api(`/api/index?per=${PER}`);
    state.labels = j.labels.filter((l) => LEARNED_LABEL[l.label]).map((l) => ({ ...l, entries: l.entries.map(decode), more: l.n > l.entries.length }));
    state.total = j.total;
    if (state.token) await loadHeld();
    setStatus('');
    render();
  } catch (e) {
    console.warn('index', e);
    setStatus('THE INDEX DID NOT ANSWER.', true);
  }
}
const decode = (e) => ({ id: e.id, label: e.label, day: e.day, status: e.status || 'live', px: unpackBits(fromB64(e.bits)) });

function chip(href, text, n) {
  const a = document.createElement('a');
  a.className = 'chip'; a.href = href;
  a.append(text + ' ');
  const s = document.createElement('span'); s.className = 'n'; s.textContent = n; a.appendChild(s);
  return a;
}

function render() {
  const forms = $('forms'), chips = $('chips');
  forms.textContent = ''; chips.textContent = '';
  drawn.clear();
  keepHeader();
  if (state.token && state.held.length) {
    chips.appendChild(chip('#held', 'HELD', state.held.length));
    forms.appendChild(form({ label: 'held', n: state.held.length, entries: state.held, more: false }, 'HELD FOR REVIEW'));
  }
  for (const l of state.labels) {
    chips.appendChild(chip(`#${l.label}`, words(l.label), l.n));
    forms.appendChild(form(l));
  }
  applyTheme();
}
// The header's canvases are redrawn on palette changes like everything else.
function keepHeader() {
  sealCanvas($('seal'), false);
  textCanvas($('office'), 'OFFICE OF CIVIC RECORD');
  textCanvas($('title'), 'THE INDEX');
}

function form(l, title = heading(l.label)) {
  const sec = document.createElement('section');
  sec.className = 'form'; sec.id = l.label;
  const head = document.createElement('div'); head.className = 'form-head';
  head.appendChild(sealCanvas(Object.assign(document.createElement('canvas'), { className: 'seal px' }), true)).setAttribute('aria-hidden', 'true');
  const hd = document.createElement('div'); hd.style.flex = '1'; hd.style.minWidth = '0';
  const office = textCanvas(Object.assign(document.createElement('canvas'), { className: 'office bm px' }), 'OFFICE OF CIVIC RECORD', () => P.ink);
  office.setAttribute('aria-hidden', 'true');
  const h2 = document.createElement('h2');
  const sr = document.createElement('span'); sr.className = 'sr'; sr.textContent = title.toLowerCase();
  const hc = textCanvas(Object.assign(document.createElement('canvas'), { className: 'bm px' }), title, () => P.ink);
  hc.setAttribute('aria-hidden', 'true');
  h2.append(sr, hc);
  hd.append(office, h2);
  const count = document.createElement('span'); count.className = 'count'; count.textContent = `${l.n} FILED`;
  head.append(hd, count);
  sec.appendChild(head);
  const sheet = document.createElement('div'); sheet.className = 'sheet';
  sec.appendChild(sheet);
  if (!l.entries.length) {
    const p = document.createElement('p'); p.className = 'none'; p.textContent = `NOTHING FILED AS ${words(l.label)} YET.`;
    sec.appendChild(p);
  }
  for (const e of l.entries) sheet.appendChild(tile(l, e));
  if (l.more) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'more'; b.textContent = 'MORE ▾';
    b.onclick = async () => {
      b.disabled = true; b.textContent = 'LOADING…';
      try { await more(l); for (const e of l.entries) if (!sheet.querySelector(`[data-id="${e.id}"]`)) sheet.appendChild(tile(l, e)); } catch { /* try again */ }
      b.disabled = false; b.textContent = 'MORE ▾'; b.hidden = !l.more;
    };
    sec.appendChild(b);
  }
  return sec;
}

function tile(l, e) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'print' + (e.status === 'held' ? ' held' : ''); b.dataset.id = e.id;
  b.setAttribute('aria-label', `Print ${indexNo(e.id)}, filed as ${words(e.label).toLowerCase()}, ${dayText(e.day).toLowerCase()}`);
  const c = document.createElement('canvas'); c.className = 'px';
  keep(() => drawPrint(c, e.px));
  b.appendChild(c);
  b.onclick = () => open(l, e);
  return b;
}

async function more(l) {
  const last = l.entries[l.entries.length - 1];
  const j = await api(`/api/entries?label=${encodeURIComponent(l.label)}&before=${last.id}&limit=${PER}`);
  const have = new Set(l.entries.map((e) => e.id));
  l.entries.push(...j.entries.filter((e) => !have.has(e.id)).map(decode));
  l.more = j.more;
}

// --- one print -------------------------------------------------------------------------------
const dlg = $('dlg');
let cur = null; // { l, i }
function open(l, e) { cur = { l, i: l.entries.indexOf(e) }; show(); if (!dlg.open) dlg.showModal(); }
function show() {
  const { l, i } = cur, e = l.entries[i];
  drawPrint($('bigPrint'), e.px);
  stampCanvas($('bigStamp'), words(e.label), e.id);
  $('capNo').textContent = `INDEX ${indexNo(e.id)}${e.status === 'held' ? ' · HELD' : ''}`;
  $('capDay').textContent = `FILED AS ${words(e.label)} · ${dayText(e.day)}`;
  $('prev').disabled = i <= 0;
  $('next').disabled = i >= l.entries.length - 1 && !l.more;
  $('del').hidden = !state.token;
  $('approve').hidden = !(state.token && e.status === 'held');
}
$('prev').onclick = () => { if (cur.i > 0) { cur.i--; show(); } };
$('next').onclick = async () => {
  if (cur.i >= cur.l.entries.length - 1 && cur.l.more) { try { await more(cur.l); } catch { return; } }
  if (cur.i < cur.l.entries.length - 1) { cur.i++; show(); }
};
$('close').onclick = () => dlg.close();
dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
dlg.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowLeft') $('prev').click(); if (ev.key === 'ArrowRight') $('next').click(); });

// --- William's view (?admin) -------------------------------------------------------------------
const auth = () => ({ Authorization: `Bearer ${state.token}` });
async function loadHeld() {
  const j = await api('/api/admin/entries?status=held&limit=500', { headers: auth() });
  state.held = j.entries.map(decode);
}
function adminBar() {
  const bar = $('admin');
  bar.hidden = false; bar.textContent = '';
  if (!state.token) {
    const label = document.createElement('label'); label.textContent = 'ADMIN KEY ';
    const input = document.createElement('input'); input.type = 'password'; input.autocomplete = 'off'; input.id = 'adminKey';
    label.appendChild(input);
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'UNLOCK';
    b.onclick = async () => {
      state.token = input.value.trim();
      try { await loadHeld(); session.set('clearance.index.admin', state.token); adminBar(); render(); }
      catch { state.token = null; b.textContent = 'WRONG KEY · UNLOCK'; }
    };
    bar.append(label, b);
  } else {
    const s = document.createElement('span'); s.textContent = `ADMIN · ${state.held.length} HELD · OPEN A PRINT TO DELETE OR APPROVE IT`;
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'FORGET KEY';
    b.onclick = () => { state.token = null; state.held = []; session.set('clearance.index.admin', null); adminBar(); render(); };
    bar.append(s, b);
  }
}
$('del').onclick = async () => {
  const e = cur.l.entries[cur.i];
  if (!confirm(`Delete print ${indexNo(e.id)} for everyone? This can't be undone.`)) return;
  try {
    await api(`/api/entries/${e.id}`, { method: 'DELETE', headers: auth() });
    for (const l of [...state.labels, { entries: state.held }]) { const k = l.entries.findIndex((x) => x.id === e.id); if (k >= 0) { l.entries.splice(k, 1); if (l.n) l.n--; } }
    dlg.close(); render();
  } catch (err) { alert(`The index refused (${err.status || 'no answer'}).`); }
};
$('approve').onclick = async () => {
  const e = cur.l.entries[cur.i];
  try { await api(`/api/entries/${e.id}/approve`, { method: 'POST', headers: auth() }); dlg.close(); await load(); }
  catch (err) { alert(`The index refused (${err.status || 'no answer'}).`); }
};

swatches();
keepHeader();
applyTheme();
if (ADMIN) adminBar();
load();
// For tests: window.__index.state
window.__index = { state, api: API };
