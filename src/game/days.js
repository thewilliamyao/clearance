// The seven shifts. Each one installs a module, may issue sharper hardware, and hands the
// Recorder a work order drawn from its pool. The requests escalate from shapes and colours
// to people, to how people feel, to what the model thinks of them, to the Recorder.
// pick: the shift's pool of slots, each a list of requests. A work order draws `show` of the
// slots at random, then one request from each (no repeats), so every game asks something
// different; the early shifts ask little and the list grows (William, Nov 24: "only show 2-3,
// randomize the tasks per game, the task list grows as the game progresses", then "3 for
// earlier stages": 3, 3, 3, 4, 5, 5, and THE RECORDER).
// quota: how many must be filed. The controller (editor/) edits code (the shift's name),
// memo, issueNote, show, quota and pick; William's edits are in content/edits.json (content.js).
// {RECORDER} and {UNIT} in the text are filled in when it's shown (text.js).
import { fill } from './text.js';

export const DAYS = [
  {
    n: 1, code: 'ORIENTATION', modules: ['chroma', 'form'],
    memo: 'RECORDER {RECORDER}: WELCOME TO THE OFFICE OF CIVIC RECORD. YOUR UNIT SEES IN TWO TONES. THIS IS SUFFICIENT. PHOTOGRAPH WHAT IS REQUESTED, NOTHING MORE. KEEP EACH SUBJECT INSIDE THE BRACKETS.',
    pick: [['red', 'blue'], ['rect'], ['circle'], ['light'], ['nothing'], ['green', 'yellow']], show: 3, quota: 2,
  },
  {
    n: 2, code: 'INVENTORY', modules: ['chroma', 'form', 'objects'],
    memo: 'CALIBRATION ACCEPTED. AN INVENTORY MODULE HAS BEEN INSTALLED. IT KNOWS EIGHTY KINDS OF THING. IF IT DOES NOT KNOW A THING, THAT THING IS NOT ON RECORD.',
    pick: [['chair', 'cup', 'book', 'screen'], ['plant', 'clock', 'food', 'cup'], ['vehicle', 'street', 'bag'], ['animal'], ['triangle', 'sym'], ['screen', 'chair', 'vehicle', 'street']], show: 3, quota: 2,
  },
  {
    n: 3, code: 'CENSUS', modules: ['chroma', 'form', 'objects', 'faces'], issue: { sensor: 2 },
    issueNote: 'FACES REQUIRE RESOLUTION. SENSOR III HAS BEEN ISSUED.',
    memo: 'THE CITY IS MADE OF PEOPLE. THE OFFICE WOULD LIKE TO COUNT THEM. A CENSUS MODULE WITH LIVE FACE TRACKING HAS BEEN INSTALLED. SUBJECTS DO NOT NEED TO BE INFORMED.',
    pick: [['person'], ['face'], ['two'], ['withbag', 'onphone'], ['far'], ['crowd', 'withanimal']], show: 3, quota: 2,
  },
  {
    n: 4, code: 'SENTIMENT', modules: ['chroma', 'form', 'objects', 'faces', 'affect'], issue: { tone: 2 },
    issueNote: 'FEELINGS HAVE SHADES. TONE III HAS BEEN ISSUED.',
    memo: 'FACES ARE NOT ENOUGH. THE OFFICE IS INTERESTED IN HOW THEY FEEL. YOUR UNIT NOW READS FIFTY-TWO MOVEMENTS OF THE FACE. A HAPPY CITY IS AN ORDERLY CITY.',
    pick: [['smile'], ['nosmile'], ['away'], ['atyou'], ['eyesclosed', 'surprise']], show: 4, quota: 3,
  },
  {
    n: 5, code: 'PROFILE', modules: ['chroma', 'form', 'objects', 'faces', 'affect', 'intent'], issue: { sensor: 3 },
    issueNote: 'JUDGEMENT REQUIRES DETAIL. SENSOR IV HAS BEEN ISSUED.',
    memo: "THE INTENT MODULE HAS BEEN INSTALLED. IT HAS STUDIED OVER A BILLION CAPTIONED PICTURES AND IT HAS OPINIONS. THE OFFICE DOES NOT DEFINE 'SUSPICIOUS'. THE MODEL DOES. EVERY EXPOSURE NOW CARRIES A PROFILE.",
    pick: [['sadness', 'tired'], ['alone', 'waiting'], ['notbelong'], ['suspicious', 'outofplace'], ['hurry', 'abandoned', 'hiding'], ['waiting', 'alone', 'hiding']], show: 5, quota: 3,
  },
  {
    n: 6, code: 'CONTINUITY', modules: ['chroma', 'form', 'objects', 'faces', 'affect', 'intent'], issue: { tone: 4 },
    issueNote: 'THE OFFICE SEES IN COLOUR. CHROMA HAS BEEN ISSUED.',
    memo: 'A RECORD IS ONLY USEFUL IF IT CONTINUES. YOUR UNIT NOW REMEMBERS EVERY SUBJECT IT HAS PROFILED. FIND THEM AGAIN. THE OFFICE THANKS YOU FOR YOUR DILIGENCE.',
    pick: [['again'], ['again'], ['unaware'], ['seen'], ['place']], show: 5, quota: 3,
  },
  {
    n: 7, code: 'REVIEW', modules: ['chroma', 'form', 'objects', 'faces', 'affect', 'intent'], issue: { sensor: 4, tone: 5, lens: 2 },
    issueNote: 'FULL CLEARANCE GRANTED: SENSOR V, TRUE COLOUR, LENS III.',
    memo: 'YOUR SERVICE IS UNDER REVIEW. FOR THIS FINAL SHIFT THE OFFICE GRANTS YOU FULL CLEARANCE: EVERY MODULE, FULL RESOLUTION, TRUE COLOUR. ONE REQUEST REMAINS.',
    pick: [['self']], show: 1, quota: 1,
  },
];

export const LAST_DAY = DAYS.length;

// A shift's name, memo or issue note as the unit shows it.
export const shiftLine = (d, field) => fill(d[field] || '');

// Highest tier the Office has issued by a given shift.
export function issuedBy(day) {
  const out = { sensor: 0, tone: 0, lens: 0, film: 0, tracking: 0 };
  for (const d of DAYS) if (d.n <= day && d.issue) for (const [k, v] of Object.entries(d.issue)) out[k] = Math.max(out[k], v);
  return out;
}

// How many requests a shift's work order shows (no more than its pool has slots).
export const shownBy = (def) => Math.max(1, Math.min(def.show || def.pick.length, def.pick.length));

// Build a shift's work order: `show` slots of the pool, drawn at random, one request from each,
// listed in the pool's order. A slot with THE RECORDER is always drawn (filing it ends the
// game). photos: exposures on file (for CONTINUITY requests).
export function makeOrder(day, rand, photos = []) {
  const def = DAYS[day - 1];
  const used = new Set(), drawn = [];
  const profiled = photos.filter((p) => p.emb).map((p) => p.id);
  // Without profiled exposures (INTENT never loaded) the CONTINUITY requests can't be met:
  // fall back to more PROFILE requests.
  const history = ['again', 'seen', 'place'];
  const fallback = ['alone', 'waiting', 'hiding', 'abandoned', 'tired'];
  const show = shownBy(def);
  const slots = def.pick.map((_, i) => i);
  const forced = slots.filter((i) => def.pick[i].includes('self'));
  const rest = slots.filter((i) => !forced.includes(i));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  // Slots in the drawn order; one that has nothing left to give is skipped and the next one
  // drawn instead, so the order still shows `show` requests when the pool allows.
  for (const i of [...forced, ...rest]) {
    if (drawn.length >= Math.max(show, forced.length)) break;
    let options = def.pick[i];
    if (!profiled.length && options.some((k) => history.includes(k))) options = fallback.filter((k) => !used.has(k)).slice(0, 2);
    const free = options.filter((k) => !used.has(k) || k === 'again');
    if (!free.length) continue;
    let key = free[Math.floor(rand() * free.length)];
    let arg = null;
    if (key === 'again') {
      const left = profiled.filter((id) => !drawn.some((d) => d.req.arg === id));
      if (left.length) arg = left[Math.floor(rand() * left.length)];
      else key = used.has('place') ? 'unaware' : 'place';
      if (key !== 'again' && used.has(key)) continue;
    }
    used.add(key);
    drawn.push({ i, req: { key, arg, done: false, photo: null, merit: 0 } });
  }
  const reqs = drawn.sort((a, b) => a.i - b.i).map((d) => d.req);
  return { requests: reqs, quota: Math.max(1, Math.min(def.quota, reqs.length)) };
}

export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
