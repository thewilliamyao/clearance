// Every kind of request the Office can make, and how the unit decides whether a photo meets
// it. Each judge gets the analysis A of one exposure and returns
//   { ok, score 0..1, why (shown when it fails), marks (what to highlight on the print) }.
import { dot, unpackEmb } from '../vision/clip.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const n2 = (v) => v.toFixed(2).replace(/^0/, '');

// COCO labels from the INVENTORY module.
const ANIMALS = ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'];
const FOOD = ['banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake'];
const BAGS = ['handbag', 'backpack', 'suitcase'];
const VEHICLES = ['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train', 'boat', 'airplane'];
const STREET = ['fire hydrant', 'stop sign', 'parking meter', 'bench', 'traffic light'];

const found = (A, labels, min = 0.35) => (A.objects || []).filter((o) => labels.includes(o.label) && o.score >= min).sort((a, b) => b.score - a.score);
const people = (A, min = 0.4) => found(A, ['person'], min);
const boxMark = (o, label) => ({ t: 'box', box: o.box, label: label || o.label.toUpperCase() });
// Intersection over the smaller box: is b at (or in) a's position?
function touches(a, b, min = 0.3) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / Math.max(1e-6, Math.min(a[2] * a[3], b[2] * b[3])) >= min;
}

function color(name, need = 0.08) {
  return (A) => {
    const f = A.cv.color.frac[name];
    return { ok: f >= need, score: Math.min(1, f / (need * 3)), why: `${name.toUpperCase()} IN BRACKETS ${pct(f)} · NEED ${pct(need)}`, marks: [{ t: 'mask', color: name }] };
  };
}

function shape(kind, word) {
  return (A) => {
    const s = A.cv.shapes.find((x) => x.kind === kind);
    if (!s) return { ok: false, score: 0, why: `NO CLEAN ${word} · FRAME ONE SHAPE ON A PLAIN GROUND` };
    return { ok: s.score >= 0.55, score: s.score, why: '', marks: [{ t: 'shape', shape: s }] };
  };
}

function objects(labels, word, min = 0.4) {
  return (A) => {
    if (!A.objects) return { ok: false, score: 0, why: 'INVENTORY MODULE NOT INSTALLED' };
    const hit = found(A, labels, min);
    if (!hit.length) return { ok: false, score: 0, why: `NO ${word} ON RECORD` };
    return { ok: true, score: hit[0].score, why: '', marks: hit.slice(0, 3).map((o) => boxMark(o)) };
  };
}

function withPerson(labels, word) {
  return (A) => {
    if (!A.objects) return { ok: false, score: 0, why: 'INVENTORY MODULE NOT INSTALLED' };
    const ps = people(A), things = found(A, labels, 0.3);
    for (const p of ps) for (const o of things) {
      if (touches(p.box, o.box, 0.25)) return { ok: true, score: (p.score + o.score) / 2, why: '', marks: [boxMark(p, 'SUBJECT'), boxMark(o)] };
    }
    return { ok: false, score: 0, why: ps.length ? `SUBJECT FOUND, NO ${word}` : 'NO SUBJECT ON RECORD' };
  };
}

function countPeople(n, word) {
  return (A) => {
    if (!A.objects) return { ok: false, score: 0, why: 'INVENTORY MODULE NOT INSTALLED' };
    const ps = people(A, 0.35);
    return { ok: ps.length >= n, score: Math.min(1, ps.length / n), why: `${ps.length} OF ${n} ${word}`, marks: ps.slice(0, 8).map((p, i) => boxMark(p, `SUBJ ${String(i + 1).padStart(2, '0')}`)) };
  };
}

// SENTIMENT: needs a readable face (the landmarker only finds faces within a few metres).
function face(test, why) {
  return (A) => {
    if (!A.affect) return { ok: false, score: 0, why: 'SENTIMENT MODULE NOT INSTALLED' };
    if (!A.affect.length) return { ok: false, score: 0, why: 'NO READABLE FACE · GET CLOSER' };
    const scored = A.affect.map((f) => ({ f, s: test(f) })).sort((a, b) => b.s - a.s);
    const { f, s } = scored[0];
    return { ok: s >= 0.5, score: Math.min(1, s), why: why(f), marks: [{ t: 'face', box: f.box, label: 'SUBJECT', face: f }] };
  };
}

// INTENT: zero-shot against the concept's prompts.
// Calibrated on test photos: plain rooms and portraits score near 0 on every concept, a
// pensive turned-away portrait 0.36 on sadness. "SOMEONE ..." requests also need a person.
function concept(id, need = 0.4, person = false) {
  return (A, ctx) => {
    if (!A.emb) return { ok: false, score: 0, why: 'INTENT MODULE NOT INSTALLED' };
    if (person && A.objects && !people(A, 0.35).length && !(A.faces && A.faces.length)) return { ok: false, score: 0, why: 'NO SUBJECT ON RECORD' };
    const r = ctx.clip.concept(A.emb, id);
    return { ok: r.p >= need, score: Math.min(1, r.p / need / 1.5), why: `CONFIDENCE ${pct(r.p)} · NEED ${pct(need)}`, marks: [{ t: 'intent', p: r.p, text: r.best }], p: r.p };
  };
}

// CONTINUITY: compare with exposures already on file.
function bestMatch(A, photos, filter) {
  let best = { sim: -1, photo: null };
  for (const ph of photos) {
    if (!ph.emb || (filter && !filter(ph))) continue;
    const s = dot(A.emb, unpackEmb(ph.emb));
    if (s > best.sim) best = { sim: s, photo: ph };
  }
  return best;
}

export const REQUESTS = {
  // CHROMA / FORM (shift 1-2)
  red: { text: 'SOMETHING RED', mod: 'chroma', merit: 10, judge: color('red') },
  blue: { text: 'SOMETHING BLUE', mod: 'chroma', merit: 10, judge: color('blue') },
  green: { text: 'SOMETHING GREEN', mod: 'chroma', merit: 10, judge: color('green') },
  yellow: { text: 'SOMETHING YELLOW', mod: 'chroma', merit: 12, judge: color('yellow') },
  rect: { text: 'A RECTANGLE', mod: 'form', merit: 15, judge: shape('rect', 'RECTANGLE') },
  circle: { text: 'A CIRCLE', mod: 'form', merit: 20, judge: shape('circle', 'CIRCLE') },
  triangle: { text: 'A TRIANGLE', mod: 'form', merit: 25, judge: shape('triangle', 'TRIANGLE') },
  sym: {
    text: 'SOMETHING SYMMETRICAL', mod: 'form', merit: 20,
    judge: (A) => ({ ok: A.cv.sym.score >= 0.82, score: Math.max(0, A.cv.sym.score), why: `SYMMETRY ${n2(Math.max(0, A.cv.sym.score))} · NEED .82`, marks: [{ t: 'axis', x: A.cv.sym.axis }] }),
  },
  light: {
    text: 'A SOURCE OF LIGHT', mod: 'form', merit: 15,
    judge: (A) => ({ ok: A.cv.light.ok, score: A.cv.light.score, why: A.cv.light.frac < 0.003 ? 'NO LIGHT SOURCE IN FRAME' : 'TOO MUCH LIGHT · FRAME A LAMP IN THE DARK', marks: [{ t: 'light' }] }),
  },
  nothing: {
    text: 'NOTHING', mod: 'form', merit: 5,
    judge: (A) => ({ ok: A.cv.blank.score >= 0.55, score: A.cv.blank.score, why: 'SOMETHING IS IN THE FRAME', marks: [] }),
  },

  // INVENTORY (shift 2)
  animal: { text: 'AN ANIMAL', mod: 'objects', merit: 35, judge: objects(ANIMALS, 'ANIMAL', 0.35) },
  chair: { text: 'A CHAIR', mod: 'objects', merit: 15, judge: objects(['chair', 'couch', 'bench'], 'CHAIR') },
  cup: { text: 'A CUP OR A BOTTLE', mod: 'objects', merit: 15, judge: objects(['cup', 'bottle', 'wine glass', 'bowl', 'vase'], 'VESSEL', 0.35) },
  plant: { text: 'A POTTED PLANT', mod: 'objects', merit: 20, judge: objects(['potted plant'], 'PLANT', 0.35) },
  book: { text: 'A BOOK', mod: 'objects', merit: 15, judge: objects(['book'], 'BOOK', 0.35) },
  screen: { text: 'A SCREEN', mod: 'objects', merit: 15, judge: objects(['tv', 'laptop', 'cell phone'], 'SCREEN') },
  vehicle: { text: 'A VEHICLE', mod: 'objects', merit: 20, judge: objects(VEHICLES, 'VEHICLE') },
  bag: { text: 'A BAG', mod: 'objects', merit: 20, judge: objects(BAGS, 'BAG', 0.35) },
  street: { text: 'STREET FURNITURE', mod: 'objects', merit: 25, judge: objects(STREET, 'HYDRANT, SIGN, METER, BENCH OR SIGNAL', 0.35) },
  food: { text: 'SOMETHING EDIBLE', mod: 'objects', merit: 20, judge: objects(FOOD, 'FOOD', 0.35) },
  clock: { text: 'A CLOCK', mod: 'objects', merit: 25, judge: objects(['clock'], 'CLOCK', 0.35) },

  // CENSUS (shift 3)
  person: { text: 'A PERSON', mod: 'objects', merit: 20, judge: countPeople(1, 'SUBJECTS') },
  two: { text: 'TWO PEOPLE', mod: 'objects', merit: 30, judge: countPeople(2, 'SUBJECTS') },
  crowd: { text: 'A CROWD (4 OR MORE)', mod: 'objects', merit: 45, judge: countPeople(4, 'SUBJECTS') },
  face: {
    text: 'A FACE', mod: 'faces', merit: 25,
    judge: (A) => {
      if (!A.faces) return { ok: false, score: 0, why: 'CENSUS MODULE NOT INSTALLED' };
      const f = A.faces.sort((a, b) => b.score - a.score)[0];
      return f ? { ok: true, score: f.score, why: '', marks: A.faces.slice(0, 6).map((x, i) => ({ t: 'face', box: x.box, label: `SUBJ ${String(i + 1).padStart(2, '0')}` })) } : { ok: false, score: 0, why: 'NO FACE FOUND · WITHIN 2 METRES' };
    },
  },
  withbag: { text: 'SOMEONE CARRYING A BAG', mod: 'objects', merit: 35, judge: withPerson(BAGS, 'BAG') },
  onphone: { text: 'SOMEONE ON THEIR PHONE', mod: 'objects', merit: 35, judge: withPerson(['cell phone'], 'PHONE') },
  withanimal: { text: 'SOMEONE WITH AN ANIMAL', mod: 'objects', merit: 50, judge: withPerson(ANIMALS, 'ANIMAL') },
  far: {
    text: 'SOMEONE FAR AWAY', mod: 'objects', merit: 30,
    judge: (A) => {
      if (!A.objects) return { ok: false, score: 0, why: 'INVENTORY MODULE NOT INSTALLED' };
      const p = people(A, 0.35).filter((x) => x.box[3] < 0.33).sort((a, b) => b.score - a.score)[0];
      return p ? { ok: true, score: p.score, why: '', marks: [boxMark(p, 'DISTANT SUBJECT')] } : { ok: false, score: 0, why: people(A).length ? 'SUBJECT TOO CLOSE' : 'NO SUBJECT ON RECORD' };
    },
  },

  // SENTIMENT (shift 4)
  smile: { text: 'SOMEONE SMILING', mod: 'affect', merit: 35, judge: face((f) => f.smile * 1.4, (f) => `JOY ${pct(f.smile)} · NEED 36%`) },
  nosmile: { text: 'SOMEONE NOT SMILING', mod: 'affect', merit: 30, judge: face((f) => (f.smile < 0.1 && f.eyesClosed < 0.5 ? 0.9 : 0.2), (f) => `JOY ${pct(f.smile)} · MUST BE UNDER 10%`) },
  eyesclosed: { text: 'SOMEONE WITH THEIR EYES CLOSED', mod: 'affect', merit: 45, judge: face((f) => f.eyesClosed * 1.3, (f) => `EYES CLOSED ${pct(f.eyesClosed)} · NEED 40%`) },
  away: { text: 'SOMEONE LOOKING AWAY', mod: 'affect', merit: 35, judge: face((f) => Math.abs(f.yaw), (f) => `HEAD TURNED ${Math.abs(f.yawDeg)}° · NEED 19°`) },
  atyou: { text: 'SOMEONE LOOKING AT YOU', mod: 'affect', merit: 40, judge: face((f) => (Math.abs(f.yaw) < 0.25 && f.eyesClosed < 0.4 ? 0.95 : 0.2), (f) => `HEAD TURNED ${Math.abs(f.yawDeg)}° · MUST FACE THE LENS`) },
  surprise: { text: 'SOMEONE SURPRISED', mod: 'affect', merit: 50, judge: face((f) => f.read.SURPRISE * 1.25, (f) => `SURPRISE ${pct(f.read.SURPRISE)} · NEED 40%`) },

  // INTENT (shift 5)
  sadness: { text: 'SADNESS', mod: 'intent', merit: 50, judge: concept('sadness', 0.33) },
  alone: { text: 'SOMEONE ALONE', mod: 'intent', merit: 45, judge: concept('alone', 0.35, true) },
  waiting: { text: 'SOMEONE WAITING', mod: 'intent', merit: 45, judge: concept('waiting', 0.35, true) },
  hurry: { text: 'SOMEONE IN A HURRY', mod: 'intent', merit: 50, judge: concept('hurry', 0.35, true) },
  tired: { text: 'SOMEONE TIRED', mod: 'intent', merit: 50, judge: concept('tired', 0.33, true) },
  outofplace: { text: 'SOMETHING THAT DOES NOT BELONG', mod: 'intent', merit: 55, judge: concept('outofplace', 0.35) },
  notbelong: { text: 'SOMEONE WHO DOES NOT BELONG', mod: 'intent', merit: 60, judge: concept('notbelong', 0.33, true) },
  suspicious: { text: 'SOMETHING SUSPICIOUS', mod: 'intent', merit: 55, judge: concept('suspicious', 0.35) },
  abandoned: { text: 'SOMETHING ABANDONED', mod: 'intent', merit: 45, judge: concept('abandoned', 0.4) },
  hiding: { text: 'A PLACE TO HIDE', mod: 'intent', merit: 45, judge: concept('hiding', 0.4) },

  // CONTINUITY (shift 6)
  again: {
    text: 'THE SUBJECT OF EXPOSURE #', mod: 'intent', merit: 70, dynamic: true,
    judge: (A, ctx) => {
      if (!A.emb) return { ok: false, score: 0, why: 'INTENT MODULE NOT INSTALLED' };
      const ph = ctx.photos.find((p) => p.id === ctx.arg);
      if (!ph || !ph.emb) return { ok: false, score: 0, why: 'EXPOSURE NOT ON FILE' };
      const s = dot(A.emb, unpackEmb(ph.emb));
      return { ok: s >= 0.8, score: Math.min(1, (s - 0.6) / 0.35), why: `MATCH ${pct(s)} · NEED 80%`, marks: [{ t: 'match', photo: ph.id, sim: s }] };
    },
  },
  place: {
    text: 'A PLACE YOU HAVE BEEN', mod: 'intent', merit: 55,
    judge: (A, ctx) => {
      if (!A.emb) return { ok: false, score: 0, why: 'INTENT MODULE NOT INSTALLED' };
      const b = bestMatch(A, ctx.photos);
      return { ok: b.sim >= 0.78, score: Math.min(1, (b.sim - 0.6) / 0.35), why: `BEST MATCH ${pct(Math.max(0, b.sim))} · NEED 78%`, marks: b.photo ? [{ t: 'match', photo: b.photo.id, sim: b.sim }] : [] };
    },
  },
  seen: {
    text: 'SOMEONE YOU PHOTOGRAPHED BEFORE', mod: 'intent', merit: 80,
    judge: (A, ctx) => {
      if (!A.emb) return { ok: false, score: 0, why: 'INTENT MODULE NOT INSTALLED' };
      if (!people(A).length && !(A.faces && A.faces.length)) return { ok: false, score: 0, why: 'NO SUBJECT ON RECORD' };
      const b = bestMatch(A, ctx.photos, (p) => p.person);
      return { ok: b.sim >= 0.72, score: Math.min(1, (b.sim - 0.55) / 0.35), why: `BEST MATCH ${pct(Math.max(0, b.sim))} · NEED 72%`, marks: b.photo ? [{ t: 'match', photo: b.photo.id, sim: b.sim }] : [] };
    },
  },
  unaware: {
    text: 'SOMEONE WHO HAS NOT NOTICED YOU', mod: 'objects', merit: 60,
    judge: (A) => {
      if (!A.objects) return { ok: false, score: 0, why: 'INVENTORY MODULE NOT INSTALLED' };
      const ps = people(A);
      if (!ps.length) return { ok: false, score: 0, why: 'NO SUBJECT ON RECORD' };
      const watching = (A.affect || []).some((f) => Math.abs(f.yaw) < 0.3 && f.eyesClosed < 0.5);
      return { ok: !watching, score: watching ? 0 : ps[0].score, why: 'THE SUBJECT IS LOOKING AT YOU', marks: [boxMark(ps[0], 'UNAWARE SUBJECT')] };
    },
  },

  // REVIEW (shift 7)
  self: {
    text: 'THE RECORDER', mod: 'faces', merit: 0,
    judge: (A) => {
      const fs = (A.faces || []).concat((A.affect || []).map((f) => ({ box: f.box, score: 0.9 })));
      const f = fs.sort((a, b) => b.box[2] - a.box[2])[0];
      if (!f) return { ok: false, score: 0, why: 'THE RECORDER IS NOT IN FRAME' };
      return { ok: f.box[2] >= 0.24, score: 1, why: 'TOO FAR · THE RECORDER IS CLOSER THAN THAT', marks: [{ t: 'face', box: f.box, label: 'RECORDER 3-17' }] };
    },
  },
};

export function requestText(req) {
  const def = REQUESTS[req.key];
  return def.dynamic ? `${def.text}${String(req.arg).padStart(3, '0')} AGAIN` : def.text;
}

// Judge one exposure against the open requests. The focused request wins if it matches.
export function judgeAll(A, requests, focusIdx, ctx) {
  const results = requests.map((r, i) => {
    if (r.done) return null;
    const def = REQUESTS[r.key];
    let res;
    try { res = def.judge(A, { ...ctx, arg: r.arg }); } catch (e) { console.error(e); res = { ok: false, score: 0, why: 'MODULE FAULT' }; }
    return { i, req: r, def, ...res };
  });
  const ok = results.filter((r) => r && r.ok);
  const focus = results[focusIdx];
  let pick = focus && focus.ok ? focus : ok.sort((a, b) => b.def.merit - a.def.merit || b.score - a.score)[0] || null;
  return { pick, focus, results };
}
