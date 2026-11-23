// The controller's working copy of content/edits.json: what a field says now (William's edit,
// or the game as written), and how a change is recorded. Only differences from the game as
// written are kept, so the file stays a short list of what he changed. No DOM here: the
// tests run it in Node (tools/test/unit-content.mjs).
import { DEFAULTS, QUEST_KEY, checkQuest, cleanText, CONTENT_VERSION } from '../src/game/content.js';
import { LINES, GROUPS } from '../src/game/text.js';
import { LAST_DAY } from '../src/game/days.js';
import { KINDS } from '../src/game/requests.js';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (x) => JSON.parse(JSON.stringify(x));

// Every game text is in capitals (the font draws lower case as capitals anyway).
export const caps = (s) => cleanText(s).toUpperCase();

const SHIFT_FIELDS = ['code', 'memo', 'issueNote', 'quota', 'pick'];
const QUEST_FIELDS = ['kind', 'text', 'short', 'merit', 'ask', 'label', 'things', 'min', 'word', 'n', 'colour', 'need', 'base', 'rule'];
const BUILTIN_FIELDS = ['text', 'short', 'merit', 'ask', 'label'];
export const BUILTIN_KEYS = Object.keys(DEFAULTS.quests);

export class Draft {
  constructor(edits) { this.e = Draft.tidy(edits); }

  // A copy in the file's order: shifts by number, built-in requests in the game's order, then
  // William's own by key, lines in the order of text.js. Empty sections and fields that
  // match the game as written are left out.
  static tidy(src) {
    const e = isObj(src) ? src : {};
    const out = { v: CONTENT_VERSION };
    const shifts = {};
    for (let n = 1; n <= LAST_DAY; n++) {
      const s = isObj(e.shifts) && e.shifts[n];
      if (!isObj(s)) continue;
      const d = DEFAULTS.shifts[n - 1], o = {};
      for (const f of SHIFT_FIELDS) if (s[f] !== undefined && !same(s[f], f === 'issueNote' ? d[f] || '' : d[f])) o[f] = clone(s[f]);
      if (Object.keys(o).length) shifts[n] = o;
    }
    if (Object.keys(shifts).length) out.shifts = shifts;
    const quests = {};
    const src2 = isObj(e.quests) ? e.quests : {};
    for (const k of BUILTIN_KEYS) {
      const q = src2[k];
      if (!isObj(q)) continue;
      const d = DEFAULTS.quests[k], o = {};
      for (const f of BUILTIN_FIELDS) if (q[f] !== undefined && !same(q[f], d[f] === undefined ? '' : d[f])) o[f] = clone(q[f]);
      if (Object.keys(o).length) quests[k] = o;
    }
    for (const k of Object.keys(src2).filter((x) => !DEFAULTS.quests[x]).sort()) {
      const q = src2[k];
      if (!isObj(q)) continue;
      const o = {};
      for (const f of QUEST_FIELDS) if (q[f] !== undefined && q[f] !== '') o[f] = clone(q[f]);
      quests[k] = o;
    }
    if (Object.keys(quests).length) out.quests = quests;
    const lines = {};
    const src3 = isObj(e.lines) ? e.lines : {};
    for (const k of Object.keys(LINES)) if (typeof src3[k] === 'string' && src3[k] !== DEFAULTS.lines[k]) lines[k] = src3[k];
    if (Object.keys(lines).length) out.lines = lines;
    return out;
  }

  toJSON() { return Draft.tidy(this.e); }
  text() { return JSON.stringify(this.toJSON(), null, 2) + '\n'; }

  // --- reading --------------------------------------------------------------------------
  shift(n) {
    const d = DEFAULTS.shifts[n - 1], e = (this.e.shifts && this.e.shifts[n]) || {};
    const s = { ...clone(d) };
    for (const f of SHIFT_FIELDS) if (e[f] !== undefined) s[f] = clone(e[f]);
    s.quota = Math.max(1, Math.min(s.quota, s.pick.length || 1));
    return s;
  }
  shiftChanged(n, field) {
    const e = this.e.shifts && this.e.shifts[n];
    return !!e && (field ? e[field] !== undefined : Object.keys(e).length > 0);
  }

  isCustom(key) { return !DEFAULTS.quests[key]; }
  questKeys() { return [...BUILTIN_KEYS, ...this.customKeys()]; }
  customKeys() { return Object.keys((this.e.quests) || {}).filter((k) => !DEFAULTS.quests[k]); }
  quest(key) {
    const e = (this.e.quests && this.e.quests[key]) || {};
    if (this.isCustom(key)) return { key, custom: true, ...clone(e) };
    const d = DEFAULTS.quests[key], q = { key, custom: false, ...clone(d) };
    for (const f of BUILTIN_FIELDS) if (e[f] !== undefined) q[f] = clone(e[f]);
    return q;
  }
  questChanged(key, field) {
    if (this.isCustom(key)) return true;
    const e = this.e.quests && this.e.quests[key];
    return !!e && (field ? e[field] !== undefined : Object.keys(e).length > 0);
  }
  // Which shifts' work orders can draw this request.
  shiftsUsing(key) {
    const out = [];
    for (let n = 1; n <= LAST_DAY; n++) if (this.shift(n).pick.some((slot) => slot.includes(key))) out.push(n);
    return out;
  }

  line(key) { const e = this.e.lines && this.e.lines[key]; return typeof e === 'string' ? e : DEFAULTS.lines[key]; }
  lineChanged(key) { return !!(this.e.lines && typeof this.e.lines[key] === 'string'); }

  // --- changing -------------------------------------------------------------------------
  section(name) { if (!isObj(this.e[name])) this.e[name] = {}; return this.e[name]; }
  prune() { this.e = Draft.tidy(this.e); }

  setShift(n, field, value) {
    const shifts = this.section('shifts');
    const s = (shifts[n] = isObj(shifts[n]) ? shifts[n] : {});
    if (typeof value === 'string') value = caps(value);
    s[field] = clone(value);
    if (field === 'pick') {
      const quota = s.quota !== undefined ? s.quota : DEFAULTS.shifts[n - 1].quota;
      if (quota > value.length) s.quota = Math.max(1, value.length);
    }
    this.prune();
  }
  resetShift(n, field) {
    const s = this.e.shifts && this.e.shifts[n];
    if (!s) return;
    if (field) delete s[field]; else delete this.e.shifts[n];
    if (field === 'pick') delete s.quota; // the written quota goes with the written pool
    this.prune();
  }

  setQuest(key, field, value) {
    const quests = this.section('quests');
    const q = (quests[key] = isObj(quests[key]) ? quests[key] : {});
    if (typeof value === 'string' && !['kind', 'colour', 'base', 'rule'].includes(field)) value = caps(value);
    if (value === '' && !this.isCustom(key) && field === 'short' && !DEFAULTS.quests[key].short) delete q[field];
    else q[field] = clone(value);
    this.prune();
  }
  resetQuest(key, field) {
    const q = this.e.quests && this.e.quests[key];
    if (!q || this.isCustom(key)) return;
    if (field) delete q[field]; else delete this.e.quests[key];
    this.prune();
  }

  // A new request of William's. Returns its key.
  addQuest(q) {
    const key = this.newKey(q.text || q.kind);
    this.section('quests')[key] = clone({ ...q, text: caps(q.text || ''), short: q.short ? caps(q.short) : undefined });
    this.prune();
    return key;
  }
  newKey(text) {
    const base = 'q-' + (String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'request');
    let key = base, i = 2;
    while (DEFAULTS.quests[key] || (this.e.quests && this.e.quests[key])) key = `${base}-${i++}`;
    return key;
  }
  // Delete one of William's requests, and take it out of every work order.
  removeQuest(key) {
    if (!this.isCustom(key) || !this.e.quests) return;
    delete this.e.quests[key];
    for (let n = 1; n <= LAST_DAY; n++) {
      if (!this.shiftChanged(n, 'pick')) continue;
      const pick = this.shift(n).pick.map((slot) => slot.filter((k) => k !== key)).filter((slot) => slot.length);
      if (pick.length) this.setShift(n, 'pick', pick); else this.resetShift(n, 'pick');
    }
    this.prune();
  }

  setLine(key, value) {
    if (!LINES[key]) return;
    const v = caps(value);
    const lines = this.section('lines');
    if (v === DEFAULTS.lines[key]) delete lines[key]; else lines[key] = v;
    this.prune();
  }
  resetLine(key) { if (this.e.lines) delete this.e.lines[key]; this.prune(); }

  // --- what changed -----------------------------------------------------------------------
  // [{ where: 'shift' | 'quest' | 'line', id, field, label }]
  changes() {
    const out = [];
    const e = this.toJSON();
    for (const [n, s] of Object.entries(e.shifts || {})) for (const f of Object.keys(s)) out.push({ where: 'shift', id: Number(n), field: f, label: `Shift ${n} · ${FIELD_NAMES[f] || f}` });
    for (const [k, q] of Object.entries(e.quests || {})) {
      if (this.isCustom(k)) out.push({ where: 'quest', id: k, field: null, label: `New request · ${q.text || k}` });
      else for (const f of Object.keys(q)) out.push({ where: 'quest', id: k, field: f, label: `${DEFAULTS.quests[k].text} · ${FIELD_NAMES[f] || f}` });
    }
    for (const k of Object.keys(e.lines || {})) out.push({ where: 'line', id: k, field: null, label: `${groupName(k)} · ${LINES[k].where}` });
    return out;
  }

  // Problems in William's own requests (the game would skip them).
  questProblems(key) {
    if (!this.isCustom(key)) return [];
    const warn = [];
    checkQuest(key, this.e.quests[key], warn);
    return warn.map((w) => w.replace(/^quest [^:]+: /, ''));
  }
}

export const FIELD_NAMES = {
  code: 'name', memo: 'memo', issueNote: 'issue note', quota: 'quota', pick: 'work order pool',
  text: 'wording', short: 'short wording', merit: 'merit', ask: 'question', label: 'label',
};
export function groupName(key) { const g = GROUPS.find((x) => x.id === key.split('.')[0]); return g ? g.name : key; }
export { QUEST_KEY, KINDS };
