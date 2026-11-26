// William's edits from the controller (editor/), laid over the game's own words and work
// orders. content/edits.json holds only what he changed:
//
//   { "v": 1,
//     "shifts": { "3": { "code", "memo", "issueNote", "show", "quota", "pick": [["person"], ...] } },
//     "quests": { "red": { "text", "short", "merit", "ask", "label" },          a built-in one
//                 "q-dog": { "kind": "things", "things": ["dog"], "text": "A DOG", ... } },  his own
//     "lines": { "order.accept": "● SIGN HERE" } }                                 text.js keys
//
// main.js and the index page load it before anything is drawn. Anything that doesn't check
// out is skipped with a warning (console, and the controller shows them), never thrown: a
// bad edit can't stop the game. ?try=N (the controller's TRY IT) uses the controller's
// unsaved draft from localStorage instead.
import { DAYS, LAST_DAY, shownBy } from './days.js';
import { REQUESTS, ASK, LEARNED_LABEL, buildQuest, KINDS, NOT_LIKE, THINGS, COLORS, WORD_RULES } from './requests.js';
import { TEXT, LINES } from './text.js';

export const CONTENT_VERSION = 1;
export const CONTENT_URL = new URL('../../content/edits.json', import.meta.url).href;
export const TRY_KEY = 'clearance.content.try'; // the draft TRY IT plays (localStorage)

export const LIMITS = { text: 2000, slots: 12, perSlot: 12, merit: 999, quests: 200, things: 20 };
const MODULE_NAMES = { chroma: 'CHROMA', form: 'FORM', objects: 'INVENTORY', faces: 'CENSUS', affect: 'SENTIMENT', intent: 'INTENT' };
export const QUEST_KEY = /^q-[a-z0-9-]{1,40}$/; // keys of William's own quests

// The game as written, before any edits (taken when this module first loads).
export const DEFAULTS = snapshot();

function snapshot() {
  return {
    shifts: DAYS.map((d) => ({
      n: d.n, code: d.code, memo: d.memo, issueNote: d.issueNote || '', show: shownBy(d), quota: d.quota,
      pick: d.pick.map((o) => o.slice()), modules: d.modules.slice(), issue: { ...(d.issue || {}) },
    })),
    quests: Object.fromEntries(Object.entries(REQUESTS).map(([k, r]) => [k, {
      text: r.text, short: r.short || '', merit: r.merit, mod: r.mod, how: r.how || '', dynamic: !!r.dynamic,
      ask: ASK[k], label: LEARNED_LABEL[k], word: r.word || null,
    }])),
    lines: { ...TEXT },
  };
}

// Back to the game as written.
export function resetContent() {
  DEFAULTS.shifts.forEach((s, i) => {
    const d = DAYS[i];
    d.code = s.code; d.memo = s.memo; d.show = s.show; d.quota = s.quota; d.pick = s.pick.map((o) => o.slice());
    if (s.issueNote) d.issueNote = s.issueNote; else delete d.issueNote;
  });
  for (const k of Object.keys(REQUESTS)) {
    const q = DEFAULTS.quests[k];
    if (!q) { delete REQUESTS[k]; continue; }
    const r = REQUESTS[k];
    r.text = q.text; r.merit = q.merit;
    if (q.short) r.short = q.short; else delete r.short;
  }
  for (const k of Object.keys(ASK)) if (!DEFAULTS.quests[k]) delete ASK[k];
  for (const k of Object.keys(LEARNED_LABEL)) if (!DEFAULTS.quests[k]) delete LEARNED_LABEL[k];
  for (const [k, q] of Object.entries(DEFAULTS.quests)) {
    if (q.ask !== undefined) ASK[k] = q.ask;
    if (q.label !== undefined) LEARNED_LABEL[k] = q.label;
  }
  for (const k of Object.keys(TEXT)) TEXT[k] = DEFAULTS.lines[k];
}

// --- checks --------------------------------------------------------------------------------
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

// Text as the unit can draw it: straight quotes, no tabs or control characters, capped.
export function cleanText(s) {
  return String(s)
    .replace(/[‘’‛′]/g, "'").replace(/[“”‟″]/g, '"')
    .replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .slice(0, LIMITS.text);
}
const str = (v) => (typeof v === 'string' ? cleanText(v) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// One of William's own quests, checked. Returns the clean quest, or null (with warnings).
export function checkQuest(key, q, warn = []) {
  const bad = (why) => { warn.push(`quest ${key}: ${why}`); return null; };
  if (!QUEST_KEY.test(key)) return bad('the key must look like q-something');
  if (DEFAULTS.quests[key]) return bad('that key belongs to a built-in request');
  if (!isObj(q)) return bad('not an object');
  if (!KINDS[q.kind]) return bad(`unknown kind "${q.kind}"`);
  const text = str(q.text);
  if (!text || !text.trim()) return bad('it needs its wording (text)');
  const out = { kind: q.kind, text, short: str(q.short) || '', merit: q.merit === undefined ? 20 : int(q.merit, 0, LIMITS.merit) };
  if (out.merit === null) return bad(`merit must be a whole number from 0 to ${LIMITS.merit}`);
  if (q.kind === 'things' || q.kind === 'with') {
    const things = Array.isArray(q.things) ? [...new Set(q.things.filter((x) => THINGS.includes(x)))] : [];
    if (!things.length) return bad('pick at least one thing the INVENTORY knows');
    if (things.length > LIMITS.things) return bad(`at most ${LIMITS.things} things`);
    out.things = things;
    out.word = str(q.word) || '';
    if (q.kind === 'things') {
      out.min = q.min === undefined ? 0.4 : num(q.min, 0.2, 0.9);
      if (out.min === null) return bad('confidence (min) must be between 0.2 and 0.9');
    }
  } else if (q.kind === 'people') {
    out.n = int(q.n, 1, 20);
    if (out.n === null) return bad('the number of people must be 1 to 20');
  } else if (q.kind === 'colour') {
    if (!COLORS.includes(q.colour)) return bad(`colour must be one of ${COLORS.join(', ')}`);
    out.colour = q.colour;
    out.need = q.need === undefined ? 0.08 : num(q.need, 0.01, 0.9);
    if (out.need === null) return bad('need must be between 0.01 and 0.9');
  } else if (q.kind === 'like') {
    if (!DEFAULTS.quests[q.base] || NOT_LIKE.has(q.base)) return bad(`"${q.base}" can't be copied`);
    out.base = q.base;
  } else if (q.kind === 'word') {
    if (!WORD_RULES[q.rule]) return bad(`rule must be one of ${Object.keys(WORD_RULES).join(', ')}`);
    out.rule = q.rule;
    out.label = str(q.label);
    if (!out.label || !out.label.trim()) return bad('it needs the label the Recorder files them as');
    out.ask = str(q.ask) || `ARE YOU SURE THIS IS ${out.label}?`;
  }
  return out;
}

// A work order's pool for shift n: known requests the shift's modules can judge, no repeats
// within a slot, THE RECORDER only on the last shift (it ends the game).
export function checkPick(n, pick, warn = []) {
  const d = DAYS[n - 1];
  if (!Array.isArray(pick)) { warn.push(`shift ${n}: pick must be a list of slots`); return null; }
  const out = [];
  for (const slot of pick.slice(0, LIMITS.slots)) {
    if (!Array.isArray(slot)) { warn.push(`shift ${n}: a slot must be a list of requests`); continue; }
    const keys = [];
    for (const k of slot.slice(0, LIMITS.perSlot)) {
      const r = REQUESTS[k];
      if (!r) { warn.push(`shift ${n}: unknown request "${k}"`); continue; }
      if (!d.modules.includes(r.mod)) { warn.push(`shift ${n}: ${k} needs ${MODULE_NAMES[r.mod] || r.mod}, which this shift doesn't have`); continue; }
      if (k === 'self' && n !== LAST_DAY) { warn.push(`shift ${n}: THE RECORDER ends the game, so it stays on shift ${LAST_DAY}`); continue; }
      if (!keys.includes(k)) keys.push(k);
    }
    if (keys.length) out.push(keys);
  }
  if (!out.length) { warn.push(`shift ${n}: the work order has no requests left`); return null; }
  if (n === LAST_DAY && !out.some((s) => s.includes('self'))) {
    warn.push(`shift ${n}: THE RECORDER put back (filing it is how the game ends)`);
    out.push(['self']);
  }
  return out;
}

// --- apply ---------------------------------------------------------------------------------
// Lay edits over the game as written. Returns { warnings }.
export function applyContent(c) {
  resetContent();
  const warn = [];
  if (c == null) return { warnings: warn };
  if (!isObj(c)) return { warnings: ['content: not an object'] };
  if (c.v !== undefined && c.v !== CONTENT_VERSION) warn.push(`content: version ${c.v}, expected ${CONTENT_VERSION}`);

  // Quests first: the pools can name William's own.
  const quests = isObj(c.quests) ? Object.entries(c.quests).slice(0, LIMITS.quests) : [];
  for (const [key, q] of quests) {
    const def = DEFAULTS.quests[key];
    if (def) {
      if (!isObj(q)) { warn.push(`quest ${key}: not an object`); continue; }
      const r = REQUESTS[key];
      if (q.text !== undefined) { const v = str(q.text); if (v && v.trim()) r.text = v; else warn.push(`quest ${key}: empty wording ignored`); }
      if (q.short !== undefined) { const v = str(q.short); if (v && v.trim()) r.short = v; else if (v === '') delete r.short; }
      if (q.merit !== undefined) { const v = int(q.merit, 0, LIMITS.merit); if (v !== null) r.merit = v; else warn.push(`quest ${key}: merit must be 0 to ${LIMITS.merit}`); }
      if (q.ask !== undefined) { const v = str(q.ask); if (def.ask !== undefined && v && v.trim()) ASK[key] = v; else warn.push(`quest ${key}: ask ignored`); }
      if (q.label !== undefined) { const v = str(q.label); if (def.label !== undefined && v && v.trim()) LEARNED_LABEL[key] = v; else warn.push(`quest ${key}: label ignored`); }
      continue;
    }
    const v = checkQuest(key, q, warn);
    if (!v) continue;
    REQUESTS[key] = buildQuest(key, v);
    if (v.kind === 'word') { ASK[key] = v.ask; LEARNED_LABEL[key] = v.label; }
  }

  // Shifts.
  for (const [n, s] of Object.entries(isObj(c.shifts) ? c.shifts : {})) {
    const k = Number(n), d = DAYS[k - 1];
    if (!d || String(k) !== n) { warn.push(`shift ${n}: there is no such shift`); continue; }
    if (!isObj(s)) { warn.push(`shift ${n}: not an object`); continue; }
    if (s.code !== undefined) { const v = str(s.code); if (v && v.trim()) d.code = v; else warn.push(`shift ${n}: empty name ignored`); }
    if (s.memo !== undefined) { const v = str(s.memo); if (v !== null) d.memo = v; }
    if (s.issueNote !== undefined) { const v = str(s.issueNote); if (v !== null) { if (v.trim()) d.issueNote = v; else delete d.issueNote; } }
    if (s.pick !== undefined) { const v = checkPick(k, s.pick, warn); if (v) d.pick = v; }
    if (s.show !== undefined) {
      const v = int(s.show, 1, d.pick.length);
      if (v !== null) d.show = v; else warn.push(`shift ${n}: show must be 1 to ${d.pick.length} (the pool's slots)`);
    }
    if (s.quota !== undefined) {
      const v = int(s.quota, 1, shownBy(d));
      if (v !== null) d.quota = v; else warn.push(`shift ${n}: quota must be 1 to ${shownBy(d)} (the requests shown)`);
    }
  }
  // The pools as written may name a request the edits removed: check every shift once more,
  // and keep show within the pool and the quota within what's shown.
  DAYS.forEach((d) => {
    const ok = checkPick(d.n, d.pick, []);
    if (ok) d.pick = ok;
    d.show = shownBy(d);
    d.quota = Math.max(1, Math.min(d.quota, d.show));
  });

  // Lines.
  for (const [key, v] of Object.entries(isObj(c.lines) ? c.lines : {})) {
    if (!LINES[key]) { warn.push(`line ${key}: no such line`); continue; }
    const s = str(v);
    if (s === null) { warn.push(`line ${key}: not text`); continue; }
    TEXT[key] = s;
  }
  return { warnings: warn };
}

// Load the edits (or TRY IT's draft) and apply them. Never throws; no file, no edits.
export async function loadContent({ draft = false, url = CONTENT_URL, fetchFn = (u, o) => fetch(u, o), timeout = 4000 } = {}) {
  let c = null, from = 'none';
  if (draft) {
    try { const raw = localStorage.getItem(TRY_KEY); if (raw) { c = JSON.parse(raw); from = 'draft'; } } catch { /* no draft */ }
  }
  if (!c) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
    try {
      const res = await fetchFn(url, { cache: 'no-cache', signal: ctl ? ctl.signal : undefined });
      if (res.ok) { c = await res.json(); from = 'file'; }
    } catch { /* offline or no file: the game as written */ }
    if (timer) clearTimeout(timer);
  }
  let r = { warnings: [] };
  try { r = applyContent(c); } catch (e) { resetContent(); r = { warnings: [`content: ${e && e.message}`] }; }
  if (r.warnings.length) console.warn('[clearance] content edits skipped:', r.warnings);
  return { from, ...r };
}
