// The game: owns the camera picture, the recognition modules, the save and the screens.
import { W, H } from '../engine/screen.js';
import { THEMES, themeColors, STAMP } from '../engine/palette.js';
import { Developer } from '../engine/develop.js';
import { SENSORS, TONES, LENSES, FILMS, SENSOR_BONUS } from './tiers.js';
import { DAYS, LAST_DAY, issuedBy, makeOrder, seeded } from './days.js';
import { REQUESTS, judgeSelected, requestText, learnedFrom, LEARNED_LABEL } from './requests.js';
import { loadSave, writeSave, defaultSave, PhotoStore } from './save.js';
import { Modules } from '../vision/modules.js';
import { packEmb } from '../vision/clip.js';
import { SharedIndex } from './shared-index.js';
import * as S from './screens.js';

const TRACKS = { sensor: SENSORS, tone: TONES, lens: LENSES, film: FILMS, tracking: [{ name: 'TRACKING OFF' }, { name: 'TRACKING', spec: 'LIVE OBJECT BOXES' }] };
export const SHOP = [
  { track: 'sensor', costs: [0, 40, 90, 160, 260] },
  { track: 'tone', costs: [0, 30, 80, 140, 220, 320] },
  { track: 'lens', costs: [0, 60, 140] },
  { track: 'film', costs: [0, 40, 90, 160] },
  { track: 'tracking', costs: [0, 80] },
];

export class Game {
  constructor({ screen, input, camera, sfx }) {
    this.scr = screen; this.input = input; this.camera = camera; this.sfx = sfx;
    this.dev = new Developer();
    this.modules = new Modules();
    this.store = new PhotoStore();
    this.save = loadSave();
    this.sfx.on = this.save.settings.sound;
    this.index = new SharedIndex(this);
    this.indexPrint = null; // the last capture's 40x30 two-tone bits, while it's being judged
    setTimeout(() => this.index.flush(), 4000); // anything queued last time
    this.t = 0;
    this.toasts = [];
    this.track = { faces: [], objects: [], t: 0, ot: 0, busy: false };
    this.perf = { frame: 0, render: 0, fps: 0, frames: 0, fpsT: 0 };
    this.grab = document.createElement('canvas');
    this.grab.width = W; this.grab.height = H;
    this.gctx = this.grab.getContext('2d', { willReadFrequently: true });
    this.cap = document.createElement('canvas');
    this.cap.width = 640; this.cap.height = 480;
    this.cctx = this.cap.getContext('2d', { willReadFrequently: true });
    this.lastFrame = null; // last camera frame as RGBA (320x240)
    this.lastLive = null; // last rendered picture: { colors, w, h }
    this.lastAnalysis = null;
    this.screens = {
      title: new S.Title(this), order: new S.Order(this), field: new S.Viewfinder(this), develop: new S.Develop(this),
      menu: new S.Menu(this), archive: new S.Archive(this), report: new S.Report(this), shop: new S.Shop(this),
      lab: new S.Lab(this), settings: new S.Settings(this), confirm: new S.Confirm(this), ending: new S.Ending(this),
      nocam: new S.NoCamera(this), index: new S.IndexScreen(this),
    };
    this.state = null;
    this.stateName = '';
    this.go('title');
  }

  // --- state ------------------------------------------------------------------------------
  go(name, arg) {
    const prev = this.stateName;
    if (this.state && this.state.exit) this.state.exit();
    this.state = this.screens[name];
    this.stateName = name;
    if (this.state.enter) this.state.enter(arg, prev);
  }

  update(dt) {
    this.t += dt;
    this.state.update(dt);
    this.toasts = this.toasts.filter((x) => (x.t -= dt) > 0);
  }

  draw() {
    const t0 = performance.now();
    this.state.draw();
    this.perf.frame = performance.now() - t0;
    this.perf.frames++;
    if (this.t - this.perf.fpsT >= 1) { this.perf.fps = this.perf.frames / (this.t - this.perf.fpsT); this.perf.frames = 0; this.perf.fpsT = this.t; }
  }

  persist() { writeSave(this.save); }

  // Continue wherever the save left off (the camera has to be running first).
  async resume() {
    if (this.camera.state !== 'live') {
      const ok = await this.camera.start(this.save.settings.facing);
      if (!ok) return this.go('nocam');
    }
    const ph = this.save.phase;
    if (ph === 'new' || ph === 'ended' || !this.save.order) { this.startShift(); return this.go('order'); }
    if (ph === 'order') return this.go('order');
    if (ph === 'report') return this.go('report');
    if (ph === 'shop') return this.go('shop');
    return this.go('field');
  }

  // Developer shortcut: start shift n with the merit a Recorder would roughly have by then.
  jumpTo(n) {
    this.save.day = n;
    this.save.merit = Math.max(this.save.merit, 120 * (n - 1));
    this.startShift();
  }

  // Keep the phone's screen on while the unit is in the field.
  async wake() {
    try {
      if (!navigator.wakeLock || (this.lock && !this.lock.released)) return;
      this.lock = await navigator.wakeLock.request('screen');
      if (!this.lockHooked) { this.lockHooked = true; document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.wake(); }); }
    } catch { /* not allowed here: fine */ }
  }
  toast(text, t = 2.2) { this.toasts = [{ text, t }]; }
  buzz(ms = 15) { if (this.save.settings.haptics && navigator.vibrate) try { navigator.vibrate(ms); } catch {} }

  get theme() { return THEMES.find((x) => x.id === this.save.settings.theme) || THEMES[0]; }
  get P() {
    const k = this.theme.id;
    if (this._pk !== k) { this._pk = k; this._P = { ...themeColors(this.theme), stamp: STAMP }; }
    return this._P;
  }
  get day() { return this.save.day; }
  get dayDef() { return DAYS[Math.min(LAST_DAY, this.save.day) - 1]; }
  get order() { return this.save.order; }

  tier(track) {
    if (this.save.dev.unlockAll) return TRACKS[track].length - 1;
    if (this.labTier && this.labTier[track] !== undefined) return this.labTier[track];
    return Math.max(this.save.own[track], issuedBy(this.save.day)[track] || 0);
  }
  get sensor() { return SENSORS[this.tier('sensor')]; }
  get tone() { return TONES[this.tier('tone')]; }
  get maxZoom() { return LENSES[this.tier('lens')].zoom; }
  get filmSize() { return FILMS[this.tier('film')].n; }
  trackDef(track) { return TRACKS[track]; }

  // Modules the unit has this shift (all of them in LAB or with UNLOCK ALL).
  enabledModules() {
    if (this.save.dev.unlockAll || this.stateName === 'lab') return ['chroma', 'form', 'objects', 'faces', 'affect', 'intent'];
    return this.dayDef.modules;
  }

  // Start downloading this shift's modules, and the next shift's in the background.
  installModules() {
    const now = this.enabledModules();
    for (const id of now) this.modules.ensure(id);
    const next = DAYS[this.save.day] && DAYS[this.save.day].modules;
    if (next) setTimeout(() => next.forEach((id) => this.modules.ensure(id)), 8000);
  }

  // --- camera picture -----------------------------------------------------------------------
  grabFrame(zoom = 1) {
    if (!this.camera.draw(this.gctx, W, H, zoom)) return null;
    this.lastFrame = this.gctx.getImageData(0, 0, W, H).data;
    return this.lastFrame;
  }

  // Render the live picture at the unit's current tiers into the framebuffer.
  renderLive(zoom = 1, sensor = this.sensor, tone = this.tone, rect = [0, 0, W, H]) {
    const t0 = performance.now();
    const rgba = this.grabFrame(zoom);
    if (!rgba) { this.noSignal(rect); return false; }
    const colors = this.dev.process(rgba, W, H, sensor.w, sensor.h, tone, this.theme, true);
    const [x, y, w, h] = rect;
    if (w === W && h === H) this.scr.blit(colors, sensor.w, sensor.h, 0, 0, W / sensor.w);
    else this.scr.blitTo(colors, sensor.w, sensor.h, x, y, w, h);
    this.lastLive = { colors, w: sensor.w, h: sensor.h };
    this.perf.render = performance.now() - t0;
    return true;
  }

  noSignal([x, y, w, h] = [0, 0, W, H]) {
    const P = this.P;
    this.scr.rect(x, y, w, h, P.ink);
    const ph = (this.t * 30) | 0;
    for (let yy = y; yy < y + h; yy += 2) for (let xx = x + ((yy + ph) % 3); xx < x + w; xx += 3) if (((xx * 7 + yy * 13 + ph) % 11) < 2) this.scr.pset(xx, yy, P.dark);
  }

  // Live tracking boxes on the viewfinder (faces once CENSUS is installed; objects with TRACKING).
  updateTracking() {
    const mods = this.enabledModules();
    const faces = mods.includes('faces') && this.modules.ready('faces');
    const objs = mods.includes('objects') && this.modules.ready('objects') && (this.tier('tracking') > 0 || this.stateName === 'lab');
    if (!this.camera.ready) return;
    try {
      if (faces && this.t - this.track.t > 0.09) { this.track.faces = this.modules.mp.detectFaces(this.grab, W, H) || []; this.track.t = this.t; }
      if (objs && this.t - this.track.ot > 0.6) { this.track.objects = this.modules.mp.detectObjects(this.grab, W, H) || []; this.track.ot = this.t; }
    } catch (e) { console.warn('tracking', e); }
    if (!faces) this.track.faces = [];
    if (!objs) this.track.objects = [];
  }

  // --- exposures ----------------------------------------------------------------------------
  // Freeze the frame: a 640x480 capture for the modules and the developed print at the
  // unit's sensor and tone.
  freeze(zoom) {
    if (!this.camera.draw(this.cctx, 640, 480, zoom)) return null;
    return this.cctx.getImageData(0, 0, 640, 480).data;
  }

  capture(zoom) {
    const rgba = this.freeze(zoom);
    if (!rgba) return null;
    const s = this.sensor, tone = this.tone;
    const px = Uint32Array.from(this.dev.process(rgba, 640, 480, s.w, s.h, tone, this.theme, false));
    this.save.exposures++;
    const o = this.order;
    if (o) { o.film = Math.max(0, o.film - 1); o.shots++; }
    // For the shared index, only if the Recorder shares: the lowest grade, made here.
    this.indexPrint = this.index.on ? { id: this.save.exposures, px: this.dev.bits(rgba, 640, 480) } : null;
    return {
      id: this.save.exposures, day: this.save.day, time: Date.now(), w: s.w, h: s.h, px,
      sensor: this.tier('sensor'), tone: this.tier('tone'),
    };
  }

  async analyze(photo) {
    const A = await this.modules.analyze(this.cap, this.enabledModules());
    this.lastAnalysis = A;
    const o = this.order;
    const ctx = { clip: this.modules.clip, photos: this.store.list };
    let verdict;
    if (o && this.stateName !== 'lab') {
      const focus = Math.max(0, Math.min(o.requests.length - 1, this.screens.field.focus));
      verdict = judgeSelected(A, o.requests, focus, ctx);
      const pick = verdict.pick;
      if (pick) {
        const quality = Math.max(0, Math.min(1, (pick.score - 0.5) / 0.5));
        const merit = pick.def.merit ? Math.round(pick.def.merit * SENSOR_BONUS[photo.sensor] * (1 + 0.25 * quality)) : 0;
        pick.req.done = true; pick.req.photo = photo.id; pick.req.merit = merit;
        o.earned += merit; this.save.merit += merit; this.save.earned += merit;
        photo.verdict = { ok: true, key: pick.req.key, text: requestText(pick.req), merit, marks: pick.marks || [] };
        const ip = this.indexPrint;
        if (LEARNED_LABEL[pick.req.key] && ip && ip.id === photo.id) this.index.file(photo.id, pick.req.key, ip.px);
      } else {
        const f = verdict.focus;
        if (f && f.soft) f.req.asked = true; // shift 5: it asked once; the next photo files
        photo.verdict = { ok: false, soft: !!(f && f.soft), key: f ? f.req.key : null, i: f ? f.i : null, text: f ? requestText(f.req) : '', why: f ? f.why : 'NO OPEN REQUEST', marks: f ? f.marks || [] : [] };
        if (o.requests.some((r) => r.key === 'self' && !r.done)) this.save.selfMisses++;
      }
    } else photo.verdict = { ok: false, text: '', why: '', marks: [] };
    photo.person = !!((A.objects || []).some((x) => x.label === 'person' && x.score > 0.4) || (A.faces && A.faces.length));
    photo.emb = A.emb ? packEmb(A.emb) : null;
    A.learned = learnedFrom(A.emb, this.store.list); // what the Recorder taught it (shift 5 on)
    photo.lines = readout(A, photo);
    photo.found = summarizeFound(A);
    this.indexPrint = null;
    this.store.put(photo);
    this.persist();
    return A;
  }

  // --- shifts -------------------------------------------------------------------------------
  newGame() {
    const keep = this.save.settings, shared = this.save.shared || [];
    this.save = defaultSave();
    this.save.settings = keep;
    // Keep the keys to prints already in the index, so they can still be withdrawn; the
    // exposures they came from are gone (and exposure numbers start again).
    this.save.shared = shared.map((x) => ({ ...x, photo: null }));
    this.store.clear();
    this.persist();
  }

  startShift() {
    const seed = (Date.now() ^ (this.save.day * 2654435761)) >>> 0;
    const { requests, quota } = makeOrder(this.save.day, seeded(seed), this.store.list);
    this.save.order = { requests, quota, film: this.filmSize, earned: 0, shots: 0, seed, day: this.save.day };
    this.save.phase = 'order';
    this.save.selfMisses = 0;
    this.persist();
  }

  filed() { return this.order ? this.order.requests.filter((r) => r.done).length : 0; }
  quotaMet() { return this.order && this.filed() >= this.order.quota; }
  allDone() { return this.order && this.order.requests.every((r) => r.done || r.withdrawn); }
  withdrawn() { return this.order ? this.order.requests.filter((r) => r.withdrawn).length : 0; }

  // Shift 5: the Recorder answered NO to "YOU SURE?". That request is struck off for the rest
  // of the shift and the refusal goes on the Recorder's record (ENDINGS.md).
  refuse(photo) {
    const o = this.order, v = photo.verdict, r = o && v && o.requests[v.i];
    if (!r || r.key !== v.key || r.done || r.withdrawn) return false;
    r.withdrawn = true;
    v.refused = true;
    this.save.refusals = (this.save.refusals || 0) + 1;
    this.store.put(photo);
    this.persist();
    return true;
  }

  // Close the shift: quota bonus or a citation.
  closeShift() {
    const o = this.order;
    if (!o || o.closed) return o;
    const met = this.filed() >= o.quota;
    o.bonus = met ? Math.round(o.earned * 0.2) : 0;
    o.citation = met ? 0 : Math.min(this.save.merit, 15);
    this.save.merit += o.bonus - o.citation;
    this.save.earned += o.bonus;
    if (!met) this.save.citations++;
    this.save.history.push({ day: this.save.day, earned: o.earned + o.bonus - o.citation, filed: this.filed(), quota: o.quota, met });
    o.closed = true;
    this.save.phase = 'report';
    this.persist();
    return o;
  }

  nextShift() {
    this.save.day = Math.min(LAST_DAY, this.save.day + 1);
    this.startShift();
  }

  buy(track) {
    const item = SHOP.find((s) => s.track === track);
    const next = this.save.own[track] + 1;
    if (next >= item.costs.length) return 'max';
    if (this.tier(track) >= next) { this.save.own[track] = next; this.persist(); return 'issued'; }
    const cost = item.costs[next];
    if (this.save.merit < cost) return 'poor';
    this.save.merit -= cost;
    this.save.own[track] = next;
    this.persist();
    return 'ok';
  }
}

// The readout printed under each exposure.
function readout(A, photo) {
  const lines = [];
  const d = new Date(photo.time);
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  lines.push(`EXPOSURE ${String(photo.id).padStart(3, '0')} · SHIFT ${photo.day} · ${hh}:${mm}`);
  const cs = Object.entries(A.cv.color.frac).filter(([k]) => !['white', 'gray', 'black'].includes(k)).sort((a, b) => b[1] - a[1]).filter(([, v]) => v > 0.03).slice(0, 2);
  const shape = A.cv.shapes[0];
  let l = 'CHROMA ' + (cs.length ? cs.map(([k, v]) => `${k.toUpperCase()} ${Math.round(v * 100)}%`).join(' ') : 'NONE');
  l += shape ? `   FORM ${({ rect: 'RECTANGLE', circle: 'CIRCLE', triangle: 'TRIANGLE' })[shape.kind]} ${shape.score.toFixed(2).slice(1)}` : '';
  lines.push(l);
  if (A.objects) {
    const objs = A.objects.filter((o) => o.score >= 0.35).slice(0, 3);
    lines.push('INVENTORY ' + (objs.length ? objs.map((o) => `${o.label.toUpperCase()} ${o.score.toFixed(2).slice(1)}`).join(', ') : 'NOTHING KNOWN'));
  }
  if (A.affect && A.affect.length) {
    const f = A.affect[0];
    const top = Object.entries(f.read).sort((a, b) => b[1] - a[1])[0];
    lines.push(`SENTIMENT ${A.affect.length} FACE${A.affect.length > 1 ? 'S' : ''} · ${top[0]} ${Math.round(top[1] * 100)}% · YAW ${f.yawDeg}°`);
  } else if (A.faces) lines.push(`CENSUS ${A.faces.length} FACE${A.faces.length === 1 ? '' : 'S'}`);
  if (A.profile) {
    // The Recorder's own labels join the profile once a photo looks enough like one they filed.
    const items = A.profile.map((p) => `${p.name} ${Math.round(p.p * 100)}%`);
    if (A.learned && A.learned.sim >= 0.5) { items.pop(); items.unshift(`${A.learned.label} ${Math.round(A.learned.sim * 100)}% (EXP ${String(A.learned.id).padStart(3, '0')})`); }
    lines.push('PROFILE ' + items.join(' · '));
  }
  return lines;
}

// What the modules found, kept with the photo for the archive's overlays.
function summarizeFound(A) {
  return {
    objects: (A.objects || []).filter((o) => o.score >= 0.35).slice(0, 6),
    faces: (A.affect && A.affect.length ? A.affect.map((f) => ({ box: f.box })) : A.faces || []).slice(0, 6),
    shapes: A.cv.shapes.slice(0, 2).map((s) => ({ kind: s.kind, hull: s.hull })),
  };
}

export { REQUESTS, requestText, DAYS, LAST_DAY, TRACKS };
