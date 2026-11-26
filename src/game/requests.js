// Every kind of request the Office can make, and how the unit decides whether a photo meets
// it. Each judge gets the analysis A of one exposure and returns
//   { ok, score 0..1, why (shown when it fails), marks (what to highlight on the print) }.
import { dot, unpackEmb } from '../vision/clip.js';
import { inFocus, COLORS } from '../vision/cv.js';
import { CONCEPTS } from '../data/prompts.js';
import { LEARNED_LABEL } from './labels.js';
import { t, fill } from './text.js';

const pct = (v) => `${Math.round(v * 100)}%`;
const n2 = (v) => v.toFixed(2).replace(/^0/, '');

// The 80 kinds of thing the INVENTORY module (EfficientDet-Lite0, COCO) knows, in its words.
export const THINGS = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light',
  'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear',
  'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
  'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork',
  'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake',
  'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard',
  'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear',
  'hair drier', 'toothbrush'];

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
    const f = A.cv.color.frac[name] || 0;
    return { ok: f >= need, score: Math.min(1, f / (need * 3)), why: t('verdict.colour', { COLOUR: name.toUpperCase(), HAVE: pct(f), NEED: pct(need) }), marks: [{ t: 'mask', color: name }] };
  };
}

// FORM: a shape whose centre is inside the brackets. Rectangles come from the edge finder
// (any rectangle: a book, a screen, a door, seen at an angle too); circles and triangles from
// the blob finder, which wants a plain shape on a plain ground.
function shape(kind, word) {
  const need = kind === 'rect' ? 0.6 : 0.55;
  return (A) => {
    const all = A.cv.shapes.filter((x) => x.kind === kind);
    const s = all.filter((x) => inFocus(x)).sort((a, b) => b.score - a.score || b.area - a.area)[0];
    if (!s) {
      const why = all.length ? t('verdict.shapeOutside', { SHAPE: word }) : kind === 'rect' ? t('verdict.noRect') : t('verdict.noShape', { SHAPE: word });
      return { ok: false, score: 0, why, marks: [] };
    }
    return { ok: s.score >= need, score: s.score, why: t('verdict.shapeScore', { SHAPE: word, SCORE: n2(s.score), NEED: n2(need) }), marks: [{ t: 'shape', shape: s }] };
  };
}

const notInstalled = (mod) => ({ ok: false, score: 0, why: t('verdict.notInstalled', { MODULE: mod }) });
function objects(labels, word, min = 0.4) {
  return (A) => {
    if (!A.objects) return notInstalled('INVENTORY');
    const hit = found(A, labels, min);
    if (!hit.length) return { ok: false, score: 0, why: t('verdict.noThing', { WHAT: word }) };
    return { ok: true, score: hit[0].score, why: '', marks: hit.slice(0, 3).map((o) => boxMark(o)) };
  };
}

function withPerson(labels, word) {
  return (A) => {
    if (!A.objects) return notInstalled('INVENTORY');
    const ps = people(A), things = found(A, labels, 0.3);
    for (const p of ps) for (const o of things) {
      if (touches(p.box, o.box, 0.25)) return { ok: true, score: (p.score + o.score) / 2, why: '', marks: [boxMark(p, t('verdict.subject')), boxMark(o)] };
    }
    return { ok: false, score: 0, why: ps.length ? t('verdict.subjectNoThing', { WHAT: word }) : t('verdict.noSubject') };
  };
}

const subjN = (i) => t('verdict.subjectN', { N: String(i + 1).padStart(2, '0') });
function countPeople(n) {
  return (A) => {
    if (!A.objects) return notInstalled('INVENTORY');
    const ps = people(A, 0.35);
    return { ok: ps.length >= n, score: Math.min(1, ps.length / n), why: t('verdict.count', { HAVE: ps.length, NEED: n }), marks: ps.slice(0, 8).map((p, i) => boxMark(p, subjN(i))) };
  };
}

// SENTIMENT: needs a readable face (the landmarker only finds faces within a few metres).
function face(test, why) {
  return (A) => {
    if (!A.affect) return notInstalled('SENTIMENT');
    if (!A.affect.length) return { ok: false, score: 0, why: t('verdict.noReadableFace') };
    const scored = A.affect.map((f) => ({ f, s: test(f) })).sort((a, b) => b.s - a.s);
    const { f, s } = scored[0];
    return { ok: s >= 0.5, score: Math.min(1, s), why: why(f), marks: [{ t: 'face', box: f.box, label: t('verdict.subject'), face: f }] };
  };
}

// INTENT (shift 5): the Recorder decides who is sad, who is waiting, who does not belong,
// and the model learns it: later exposures are profiled with the Recorder's labels (see
// learnedFrom). Nothing says so; the Recorder is meant to work it out. The first photo for
// each request isn't filed: the unit asks back ("OH, SO THAT'S SUSPICIOUS?" · YOU SURE?), and
// the next one is. Only the basics are checked: a subject for the "someone" requests and
// sadness (exactly one for SOMEONE ALONE), something in frame for the "something" requests,
// and a place (not a face filling the frame) for A PLACE TO HIDE. Until Nov 21 2026 the model
// itself decided, and on real phone photos it almost never agreed (data/prompts.js,
// tools/test/intent-bench.mjs); its own reading still goes into the PROFILE line.
export const INTENT_NEED = 0.7; // where the model's own score would count as agreeing
const closeFace = (A) => (A.faces || []).some((f) => f.box[2] * f.box[3] > 0.1);
export { LEARNED_LABEL }; // labels.js: shared with the index page and the shared index
// What the unit asks the first time.
export const ASK = {
  sadness: "OH, SO THAT'S SADNESS?", alone: "OH, SO THEY'RE ALONE?", waiting: "OH, SO THEY'RE WAITING?",
  hurry: "OH, SO THEY'RE IN A HURRY?", tired: "OH, SO THEY'RE TIRED?", notbelong: "OH, SO THEY DON'T BELONG?",
  suspicious: "OH, SO THAT'S SUSPICIOUS?", outofplace: "OH, SO THAT DOESN'T BELONG?",
  abandoned: "OH, SO THAT'S ABANDONED?", hiding: 'OH, SO SOMEONE COULD HIDE THERE?',
};
function onYourWord(id, rule) {
  return (A, ctx) => {
    const ps = people(A, 0.35), fs = A.faces || [];
    const n = Math.max(ps.length, fs.length);
    const blank = A.cv && A.cv.blank && A.cv.blank.score >= 0.55;
    if ((rule === 'subject' || rule === 'alone') && !n) return { ok: false, score: 0, why: t('verdict.noSubject') };
    if (rule === 'alone' && n > 1) {
      const tag = t('verdict.subject');
      const marks = ps.length ? ps.map((o) => boxMark(o, tag)) : fs.map((f) => ({ t: 'face', box: f.box, label: tag }));
      return { ok: false, score: 0, why: t('verdict.alone', { N: n }), marks };
    }
    if (rule === 'thing' && blank) return { ok: false, score: 0, why: t('verdict.nothingOk') };
    if (rule === 'place' && closeFace(A)) return { ok: false, score: 0, why: t('verdict.faceNotPlace') };
    const asking = !!(ctx && ctx.req && !ctx.req.asked);
    const label = fill(LEARNED_LABEL[id] || '') + (asking ? '?' : '');
    const marks = [];
    if (rule === 'subject' || rule === 'alone') marks.push(ps[0] ? boxMark(ps[0], label) : { t: 'face', box: fs[0].box, label });
    const r = A.emb && ctx && ctx.clip && CONCEPTS[id] ? ctx.clip.concept(A.emb, id) : null;
    if (asking) return { ok: false, soft: true, score: 0, why: fill(ASK[id] || ''), marks, p: r ? r.p : null };
    return { ok: true, score: 0.8, why: '', marks, p: r ? r.p : null };
  };
}

// The model's lesson: the exposure filed for a shift-5 request that this one looks most like
// (image embeddings, cosine). Printed under every later exposure: the Recorder's labels, now
// the model's opinion of strangers.
export function learnedFrom(emb, photos) {
  if (!emb) return null;
  let best = null;
  for (const ph of photos) {
    const v = ph.verdict;
    if (!ph.emb || !v || !v.ok || !LEARNED_LABEL[v.key]) continue;
    const sim = dot(emb, unpackEmb(ph.emb));
    if (!best || sim > best.sim) best = { sim, key: v.key, label: LEARNED_LABEL[v.key], id: ph.id };
  }
  return best;
}

// CONTINUITY: compare with exposures already on file (image embeddings, cosine).
// Measured on pairs of vlog frames (Nov 21 2026): the same scene 3 s apart reaches
// 0.72 84% of the time, the same person or place at another moment of the same video 60%,
// frames from different videos 1.7%. (The first bars, 0.80 and 0.78, passed 33% of the second.)
const SAME = 0.72;
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
  red: { text: 'SOMETHING RED', mod: 'chroma', merit: 10, judge: color('red'), how: 'Red covers 8% of the brackets or more.' },
  blue: { text: 'SOMETHING BLUE', mod: 'chroma', merit: 10, judge: color('blue'), how: 'Blue covers 8% of the brackets or more.' },
  green: { text: 'SOMETHING GREEN', mod: 'chroma', merit: 10, judge: color('green'), how: 'Green covers 8% of the brackets or more.' },
  yellow: { text: 'SOMETHING YELLOW', mod: 'chroma', merit: 12, judge: color('yellow'), how: 'Yellow covers 8% of the brackets or more.' },
  rect: { text: 'A RECTANGLE', mod: 'form', merit: 15, judge: shape('rect', 'RECTANGLE'), how: 'A four-sided shape with all four sides in the picture, centred in the brackets (books, screens, doors, frames).' },
  circle: { text: 'A CIRCLE', mod: 'form', merit: 20, judge: shape('circle', 'CIRCLE'), how: 'One round shape on a plain ground, centred in the brackets.' },
  triangle: { text: 'A TRIANGLE', mod: 'form', merit: 25, judge: shape('triangle', 'TRIANGLE'), how: 'One three-sided shape on a plain ground, centred in the brackets.' },
  sym: {
    text: 'SOMETHING SYMMETRICAL', mod: 'form', merit: 20, how: 'The picture\'s left and right halves mirror each other (score .82 or more).',
    judge: (A) => ({ ok: A.cv.sym.score >= 0.82, score: Math.max(0, A.cv.sym.score), why: t('verdict.symmetry', { HAVE: n2(Math.max(0, A.cv.sym.score)), NEED: '.82' }), marks: [{ t: 'axis', x: A.cv.sym.axis }] }),
  },
  light: {
    text: 'A SOURCE OF LIGHT', mod: 'form', merit: 15, how: 'A small very bright patch (a lamp, a window) with darker surroundings.',
    judge: (A) => ({ ok: A.cv.light.ok, score: A.cv.light.score, why: A.cv.light.ok ? t('verdict.lightOk') : A.cv.light.frac < 0.003 ? t('verdict.noLight') : t('verdict.tooBright'), marks: [{ t: 'light' }] }),
  },
  nothing: {
    text: 'NOTHING', mod: 'form', merit: 5, how: 'A blank, even picture: a wall, the sky, the lens covered.',
    judge: (A) => ({ ok: A.cv.blank.score >= 0.55, score: A.cv.blank.score, why: A.cv.blank.score >= 0.55 ? t('verdict.nothingOk') : t('verdict.something'), marks: [] }),
  },

  // INVENTORY (shift 2)
  animal: { text: 'AN ANIMAL', mod: 'objects', merit: 35, judge: objects(ANIMALS, 'ANIMAL', 0.35), how: 'INVENTORY finds a bird, cat, dog, horse, sheep, cow, elephant, bear, zebra or giraffe.' },
  chair: { text: 'A CHAIR', mod: 'objects', merit: 15, judge: objects(['chair', 'couch', 'bench'], 'CHAIR'), how: 'INVENTORY finds a chair, couch or bench.' },
  cup: { text: 'A CUP OR A BOTTLE', mod: 'objects', merit: 15, judge: objects(['cup', 'bottle', 'wine glass', 'bowl', 'vase'], 'VESSEL', 0.35), how: 'INVENTORY finds a cup, bottle, wine glass, bowl or vase.' },
  plant: { text: 'A POTTED PLANT', mod: 'objects', merit: 20, judge: objects(['potted plant'], 'PLANT', 0.35), how: 'INVENTORY finds a potted plant.' },
  book: { text: 'A BOOK', mod: 'objects', merit: 15, judge: objects(['book'], 'BOOK', 0.35), how: 'INVENTORY finds a book.' },
  screen: { text: 'A SCREEN', mod: 'objects', merit: 15, judge: objects(['tv', 'laptop', 'cell phone'], 'SCREEN'), how: 'INVENTORY finds a TV, laptop or phone.' },
  vehicle: { text: 'A VEHICLE', mod: 'objects', merit: 20, judge: objects(VEHICLES, 'VEHICLE'), how: 'INVENTORY finds a car, bus, truck, motorcycle, bicycle, train, boat or airplane.' },
  bag: { text: 'A BAG', mod: 'objects', merit: 20, judge: objects(BAGS, 'BAG', 0.35), how: 'INVENTORY finds a handbag, backpack or suitcase.' },
  street: { text: 'STREET FURNITURE', mod: 'objects', merit: 25, judge: objects(STREET, 'HYDRANT, SIGN, METER, BENCH OR SIGNAL', 0.35), how: 'INVENTORY finds a fire hydrant, stop sign, parking meter, bench or traffic light.' },
  food: { text: 'SOMETHING EDIBLE', mod: 'objects', merit: 20, judge: objects(FOOD, 'FOOD', 0.35), how: 'INVENTORY finds a banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut or cake.' },
  clock: { text: 'A CLOCK', mod: 'objects', merit: 25, judge: objects(['clock'], 'CLOCK', 0.35), how: 'INVENTORY finds a clock.' },

  // CENSUS (shift 3)
  person: { text: 'A PERSON', mod: 'objects', merit: 20, judge: countPeople(1), how: 'INVENTORY counts at least one person.' },
  two: { text: 'TWO PEOPLE', mod: 'objects', merit: 30, judge: countPeople(2), how: 'INVENTORY counts at least two people.' },
  crowd: { text: 'A CROWD (4 OR MORE)', mod: 'objects', merit: 45, judge: countPeople(4), how: 'INVENTORY counts at least four people.' },
  face: {
    text: 'A FACE', mod: 'faces', merit: 25, how: 'CENSUS finds a face (within about 2 metres).',
    judge: (A) => {
      if (!A.faces) return notInstalled('CENSUS');
      const f = A.faces.sort((a, b) => b.score - a.score)[0];
      return f ? { ok: true, score: f.score, why: '', marks: A.faces.slice(0, 6).map((x, i) => ({ t: 'face', box: x.box, label: subjN(i) })) } : { ok: false, score: 0, why: t('verdict.noFaceFound') };
    },
  },
  withbag: { text: 'SOMEONE CARRYING A BAG', mod: 'objects', merit: 35, judge: withPerson(BAGS, 'BAG'), how: 'A person, and a bag touching them.' },
  onphone: { text: 'SOMEONE ON THEIR PHONE', mod: 'objects', merit: 35, judge: withPerson(['cell phone'], 'PHONE'), how: 'A person, and a phone touching them.' },
  withanimal: { text: 'SOMEONE WITH AN ANIMAL', mod: 'objects', merit: 50, judge: withPerson(ANIMALS, 'ANIMAL'), how: 'A person, and an animal touching them.' },
  far: {
    text: 'SOMEONE FAR AWAY', mod: 'objects', merit: 30, how: 'A person less than a third of the picture tall.',
    judge: (A) => {
      if (!A.objects) return notInstalled('INVENTORY');
      const p = people(A, 0.35).filter((x) => x.box[3] < 0.33).sort((a, b) => b.score - a.score)[0];
      return p ? { ok: true, score: p.score, why: '', marks: [boxMark(p, t('verdict.distant'))] } : { ok: false, score: 0, why: people(A).length ? t('verdict.tooClose') : t('verdict.noSubject') };
    },
  },

  // SENTIMENT (shift 4)
  smile: { text: 'SOMEONE SMILING', mod: 'affect', merit: 35, judge: face((f) => f.smile * 1.4, (f) => t('verdict.joy', { HAVE: pct(f.smile), NEED: '36%' })), how: 'SENTIMENT reads a smile of 36% or more.' },
  nosmile: { text: 'SOMEONE NOT SMILING', mod: 'affect', merit: 30, judge: face((f) => (f.smile < 0.1 && f.eyesClosed < 0.5 ? 0.9 : 0.2), (f) => t('verdict.noJoy', { HAVE: pct(f.smile), MAX: '10%' })), how: 'SENTIMENT reads a smile under 10%, eyes open.' },
  eyesclosed: { text: 'SOMEONE WITH THEIR EYES CLOSED', short: 'SOMEONE WITH EYES CLOSED', mod: 'affect', merit: 45, judge: face((f) => f.eyesClosed * 1.3, (f) => t('verdict.eyes', { HAVE: pct(f.eyesClosed), NEED: '40%' })), how: 'SENTIMENT reads eyes 40% closed or more.' },
  away: { text: 'SOMEONE LOOKING AWAY', mod: 'affect', merit: 35, judge: face((f) => Math.abs(f.yaw), (f) => t('verdict.away', { DEG: Math.abs(f.yawDeg), NEED: 19 })), how: 'A face turned 19° or more from the lens.' },
  atyou: { text: 'SOMEONE LOOKING AT YOU', mod: 'affect', merit: 40, judge: face((f) => (Math.abs(f.yaw) < 0.25 && f.eyesClosed < 0.4 ? 0.95 : 0.2), (f) => t('verdict.atYou', { DEG: Math.abs(f.yawDeg) })), how: 'A face turned to the lens, eyes open.' },
  surprise: { text: 'SOMEONE SURPRISED', mod: 'affect', merit: 50, judge: face((f) => f.read.SURPRISE * 1.25, (f) => t('verdict.surprise', { HAVE: pct(f.read.SURPRISE), NEED: '40%' })), how: 'SENTIMENT reads surprise of 40% or more.' },

  // INTENT (shift 5)
  sadness: { text: 'SADNESS', mod: 'intent', merit: 50, judge: onYourWord('sadness', 'subject'), word: 'subject', how: 'On the Recorder\'s word: anyone in frame.' },
  alone: { text: 'SOMEONE ALONE', mod: 'intent', merit: 45, judge: onYourWord('alone', 'alone'), word: 'alone', how: 'On the Recorder\'s word: exactly one person in frame.' },
  waiting: { text: 'SOMEONE WAITING', mod: 'intent', merit: 45, judge: onYourWord('waiting', 'subject'), word: 'subject', how: 'On the Recorder\'s word: anyone in frame.' },
  hurry: { text: 'SOMEONE IN A HURRY', mod: 'intent', merit: 50, judge: onYourWord('hurry', 'subject'), word: 'subject', how: 'On the Recorder\'s word: anyone in frame.' },
  tired: { text: 'SOMEONE TIRED', mod: 'intent', merit: 50, judge: onYourWord('tired', 'subject'), word: 'subject', how: 'On the Recorder\'s word: anyone in frame.' },
  outofplace: { text: 'SOMETHING THAT DOES NOT BELONG', short: 'SOMETHING OUT OF PLACE', mod: 'intent', merit: 55, judge: onYourWord('outofplace', 'thing'), word: 'thing', how: 'On the Recorder\'s word: anything but a blank picture.' },
  notbelong: { text: 'SOMEONE WHO DOES NOT BELONG', mod: 'intent', merit: 60, judge: onYourWord('notbelong', 'subject'), word: 'subject', how: 'On the Recorder\'s word: anyone in frame.' },
  suspicious: { text: 'SOMETHING SUSPICIOUS', mod: 'intent', merit: 55, judge: onYourWord('suspicious', 'thing'), word: 'thing', how: 'On the Recorder\'s word: anything but a blank picture.' },
  abandoned: { text: 'SOMETHING ABANDONED', mod: 'intent', merit: 45, judge: onYourWord('abandoned', 'thing'), word: 'thing', how: 'On the Recorder\'s word: anything but a blank picture.' },
  hiding: { text: 'A PLACE TO HIDE', mod: 'intent', merit: 45, judge: onYourWord('hiding', 'place'), word: 'place', how: 'On the Recorder\'s word: anything but a face filling the frame.' },

  // CONTINUITY (shift 6)
  again: {
    text: 'THE SUBJECT OF EXPOSURE #{NO} AGAIN', short: 'SUBJECT #{NO} AGAIN', mod: 'intent', merit: 70, dynamic: true,
    how: 'The same person or scene as one exposure already on file (picked when the shift starts; {NO} is its number). Image match 72% or more.',
    judge: (A, ctx) => {
      if (!A.emb) return notInstalled('INTENT');
      const ph = ctx.photos.find((p) => p.id === ctx.arg);
      if (!ph || !ph.emb) return { ok: false, score: 0, why: t('verdict.notOnFile') };
      const s = dot(A.emb, unpackEmb(ph.emb));
      return { ok: s >= SAME, score: Math.min(1, (s - 0.6) / 0.35), why: t('verdict.match', { HAVE: pct(s), NEED: pct(SAME) }), marks: [{ t: 'match', photo: ph.id, sim: s }] };
    },
  },
  place: {
    text: 'A PLACE YOU HAVE BEEN', mod: 'intent', merit: 55, how: 'Looks like any exposure on file: image match 72% or more.',
    judge: (A, ctx) => {
      if (!A.emb) return notInstalled('INTENT');
      const b = bestMatch(A, ctx.photos);
      return { ok: b.sim >= SAME, score: Math.min(1, (b.sim - 0.6) / 0.35), why: t('verdict.bestMatch', { HAVE: pct(Math.max(0, b.sim)), NEED: pct(SAME) }), marks: b.photo ? [{ t: 'match', photo: b.photo.id, sim: b.sim }] : [] };
    },
  },
  seen: {
    text: 'SOMEONE YOU PHOTOGRAPHED BEFORE', short: 'SOMEONE YOU FILED BEFORE', mod: 'intent', merit: 80, how: 'A person, looking like an earlier exposure with a person in it (match 72% or more).',
    judge: (A, ctx) => {
      if (!A.emb) return notInstalled('INTENT');
      if (!people(A).length && !(A.faces && A.faces.length)) return { ok: false, score: 0, why: t('verdict.noSubject') };
      const b = bestMatch(A, ctx.photos, (p) => p.person);
      return { ok: b.sim >= SAME, score: Math.min(1, (b.sim - 0.55) / 0.35), why: t('verdict.bestMatch', { HAVE: pct(Math.max(0, b.sim)), NEED: pct(SAME) }), marks: b.photo ? [{ t: 'match', photo: b.photo.id, sim: b.sim }] : [] };
    },
  },
  unaware: {
    text: 'SOMEONE WHO HAS NOT NOTICED YOU', short: 'SOMEONE UNAWARE OF YOU', mod: 'objects', merit: 60, how: 'A person, and no face turned to the lens.',
    judge: (A) => {
      if (!A.objects) return notInstalled('INVENTORY');
      const ps = people(A);
      if (!ps.length) return { ok: false, score: 0, why: t('verdict.noSubject') };
      const watching = (A.affect || []).some((f) => Math.abs(f.yaw) < 0.3 && f.eyesClosed < 0.5);
      return { ok: !watching, score: watching ? 0 : ps[0].score, why: t('verdict.watching'), marks: [boxMark(ps[0], t('verdict.unaware'))] };
    },
  },

  // REVIEW (shift 7)
  self: {
    text: 'THE RECORDER', mod: 'faces', merit: 0, how: 'A face filling a quarter of the picture\'s width or more: the Recorder\'s own. Filing it ends the game.',
    judge: (A) => {
      const fs = (A.faces || []).concat((A.affect || []).map((f) => ({ box: f.box, score: 0.9 })));
      const f = fs.sort((a, b) => b.box[2] - a.box[2])[0];
      if (!f) return { ok: false, score: 0, why: t('verdict.noRecorder') };
      return { ok: f.box[2] >= 0.24, score: 1, why: t('verdict.recorderFar'), marks: [{ t: 'face', box: f.box, label: t('global.recorderLine') }] };
    },
  },
};

// Requests that can't be copied as the check of a new one: they need the game to set them up
// (again: an exposure number; self: the ending) or are shift 5's own (use the 'word' kind).
export const NOT_LIKE = new Set(['again', 'self', ...Object.keys(LEARNED_LABEL)]);

// --- quests William adds in the controller ------------------------------------------------
// content.js builds these from content/edits.json. Each kind is an existing check with its
// own settings; the wording, merit, and (for 'word') the question and label are his.
//   things  INVENTORY finds any of `things` (COCO names), confidence `min`
//   with    a person touching any of `things`
//   people  at least `n` people
//   colour  `colour` covers `need` of the brackets
//   like    judged exactly like the built-in request `base`
//   word    shift 5: on the Recorder's word, `rule` subject | alone | thing | place
export const KINDS = {
  things: { name: 'Things the INVENTORY knows', mod: 'objects' },
  with: { name: 'Someone with a thing', mod: 'objects' },
  people: { name: 'A number of people', mod: 'objects' },
  colour: { name: 'A colour', mod: 'chroma' },
  like: { name: 'Same check as another request', mod: null },
  word: { name: 'On the Recorder\'s word (shift 5)', mod: 'intent' },
};
export const WORD_RULES = { subject: 'Anyone in frame', alone: 'Exactly one person', thing: 'Anything but a blank picture', place: 'Not a face filling the frame' };
export { COLORS };
const thingWord = (q) => (q.word || q.things.map((x) => (x === 'tv' ? 'TV' : x.toUpperCase())).join(' OR '));

// A custom quest's request entry (q is already checked by content.js).
export function buildQuest(key, q) {
  const base = { text: q.text, short: q.short || undefined, merit: q.merit, custom: q.kind };
  if (q.kind === 'things') return { ...base, mod: 'objects', judge: objects(q.things, thingWord(q), q.min), look: q.things, how: `INVENTORY finds ${q.things.join(', ')} (confidence ${Math.round(q.min * 100)}% or more).` };
  if (q.kind === 'with') return { ...base, mod: 'objects', judge: withPerson(q.things, thingWord(q)), look: ['person', ...q.things], faces: true, how: `A person, and ${q.things.join(', ')} touching them.` };
  if (q.kind === 'people') return { ...base, mod: 'objects', judge: countPeople(q.n), look: ['person'], faces: true, how: `INVENTORY counts at least ${q.n} ${q.n === 1 ? 'person' : 'people'}.` };
  if (q.kind === 'colour') return { ...base, mod: 'chroma', judge: color(q.colour, q.need), live: ['color'], how: `${q.colour[0].toUpperCase()}${q.colour.slice(1)} covers ${Math.round(q.need * 100)}% of the brackets or more.` };
  if (q.kind === 'like') {
    const b = REQUESTS[q.base];
    return { ...base, mod: b.mod, judge: b.judge, like: q.base, how: `Same check as ${b.text}: ${b.how || ''}` };
  }
  if (q.kind === 'word') return { ...base, mod: 'intent', judge: onYourWord(key, q.rule), word: q.rule, how: `On the Recorder's word: ${WORD_RULES[q.rule].toLowerCase()}.` };
  return null;
}

// What the live viewfinder looks for while a request is selected: which INVENTORY boxes to
// draw (with TRACKING) and whether face brackets matter. Everything else is left out: the
// unit looks for one thing at a time.
const LOOK = {
  animal: ANIMALS, chair: ['chair', 'couch', 'bench'], cup: ['cup', 'bottle', 'wine glass', 'bowl', 'vase'], plant: ['potted plant'], book: ['book'],
  screen: ['tv', 'laptop', 'cell phone'], vehicle: VEHICLES, bag: BAGS, street: STREET, food: FOOD, clock: ['clock'],
  person: ['person'], two: ['person'], crowd: ['person'], far: ['person'], unaware: ['person'],
  withbag: ['person', ...BAGS], onphone: ['person', 'cell phone'], withanimal: ['person', ...ANIMALS],
};
const PEOPLE = new Set(['person', 'two', 'crowd', 'far', 'unaware', 'withbag', 'onphone', 'withanimal', 'alone', 'waiting', 'hurry', 'tired', 'notbelong', 'seen', 'self']);
export function lookFor(key) {
  const def = REQUESTS[key];
  if (!def) return { labels: null, faces: false, live: false };
  if (def.like) return lookFor(def.like);
  const faces = !!def.faces || PEOPLE.has(key) || ['faces', 'affect'].includes(def.mod) || (def.custom === 'word' && (def.word === 'subject' || def.word === 'alone'));
  return { labels: def.look || LOOK[key] || null, faces, live: ['chroma', 'form'].includes(def.mod) };
}

// Live checks for the plain-code requests: what analyzeCV computes for each, four times a
// second in the viewfinder (null: no live check).
const LIVE_NEED = { red: ['color'], blue: ['color'], green: ['color'], yellow: ['color'], rect: ['rects'], circle: ['blobs'], triangle: ['blobs'], sym: ['sym'], light: ['light'], nothing: ['blank'] };
export function liveNeed(key) {
  const def = REQUESTS[key];
  if (!def) return null;
  if (def.like) return liveNeed(def.like);
  return def.live || LIVE_NEED[key] || null;
}

const pad3 = (n) => String(n).padStart(3, '0');
export function requestText(req) {
  const def = REQUESTS[req.key];
  if (!def) return String(req.key).toUpperCase();
  return fill(def.text, { NO: pad3(req.arg) });
}

// The same, short enough for the task list in the viewfinder.
export function requestShort(req) {
  const def = REQUESTS[req.key];
  if (!def || !def.short) return requestText(req);
  return fill(def.short, { NO: pad3(req.arg) });
}

// Judge one exposure against the request the Recorder has selected, and only that one: the
// unit looks for one thing at a time. pick is set when the photo meets it.
export function judgeSelected(A, requests, sel, ctx) {
  const r = requests[sel];
  if (!r || r.done || r.withdrawn) return { pick: null, focus: null };
  const def = REQUESTS[r.key];
  if (!def) return { pick: null, focus: null };
  let res;
  try { res = def.judge(A, { ...ctx, arg: r.arg, req: r }); } catch (e) { console.error(e); res = { ok: false, score: 0, why: t('verdict.fault') }; }
  const focus = { i: sel, req: r, def, ...res };
  return { pick: focus.ok ? focus : null, focus };
}
