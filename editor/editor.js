// Clearance Controller: edit each shift's work order (name, memo, issue note, quota, the
// requests it can draw), every request's wording and merit, new requests, and any line the
// unit shows. The game loads the edits (content/edits.json) at start. TRY plays a shift with
// the unsaved changes in a test save. SAVE goes to one of two places:
//   local   run by serve.py on William's computer: the file on disk (/editor/api).
//   github  on the public site (GitHub Pages): a commit to the file in the game's public repo,
//           with his GitHub token (github.js); GitHub Pages then rebuilds the game.
import { Draft, caps, FIELD_NAMES, groupName, BUILTIN_KEYS } from './model.js';
import * as gh from './github.js';
import { SCREENS, lineCanvas, missingGlyphs, P, Raster, css } from './preview.js';
import { DEFAULTS, applyContent, checkQuest, TRY_KEY, CONTENT_VERSION } from '../src/game/content.js';
import { GROUPS, LINES, TEXT, placeholders, fill, t } from '../src/game/text.js';
import { DAYS, LAST_DAY, shiftLine } from '../src/game/days.js';
import { REQUESTS, KINDS, THINGS, COLORS, WORD_RULES, NOT_LIKE } from '../src/game/requests.js';
import { MODULES, MODULE_ORDER } from '../src/vision/modules.js';
import { SENSORS, TONES, LENSES, FILMS } from '../src/game/tiers.js';
import { wrapText, textWidth, fitText } from '../src/engine/font.js';
import { seal } from '../src/game/ui.js';

const DRAFT_KEY = 'clearance.controller.draft';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* fine */ } },
};

const app = {
  draft: new Draft({ v: CONTENT_VERSION }),
  saved: '',          // the edits as they are on disk (tidy JSON)
  sha: null,          // the file's hash when loaded or saved (the server refuses a stale save)
  writable: false,
  file: 'content/edits.json',
  savedAt: null,
  undo: [], redo: [], lastKey: null, lastAt: 0,
  warnings: [],
  seed: 1,
  shift: 1,           // the shift TRY plays (the last one visited)
  focusLine: null,    // the line last typed in (the NOT FILED preview shows it)
  banners: [],        // notes over the page: { cls, text, actions }
  mode: 'local',      // where SAVE goes: 'local' (serve.py) or 'github' (the public repo)
  live: null,         // github: after a save, 'pending' until the game has it, then 'live'
  loadError: null,
};

// --- small helpers ------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'title', 'hidden', 'open', 'type', 'min', 'max', 'step', 'rows', 'placeholder', 'href', 'htmlFor'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const tidyJSON = (e) => JSON.stringify(Draft.tidy(e));
const dirty = () => tidyJSON(app.draft.e) !== app.saved;
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const modName = (id) => (MODULES[id] ? MODULES[id].name : String(id || '').toUpperCase());
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// Live parts of the page (previews, messages, changed marks) re-run after every change.
let LIVE = [];
const live = (fn) => { LIVE.push(fn); return fn; };
let refreshQueued = false;
function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; refreshNow(); });
}
function refreshNow() {
  try { app.warnings = applyContent(app.draft.toJSON()).warnings; } catch (e) { app.warnings = [String(e && e.message)]; }
  for (const fn of LIVE) { try { fn(); } catch (e) { console.error(e); } }
  status(); nav();
}

// A change to the draft: undo step (typing in one field within 1.5 s is one step), local copy.
function change(key, fn, { rerender = false } = {}) {
  const before = tidyJSON(app.draft.e), now = Date.now();
  fn();
  const after = tidyJSON(app.draft.e);
  if (after === before) { if (rerender) render(); return; }
  if (!(key && key === app.lastKey && now - app.lastAt < 1500)) { app.undo.push(before); app.redo = []; if (app.undo.length > 300) app.undo.shift(); }
  app.lastKey = key; app.lastAt = now;
  keepDraft();
  if (rerender) render(); else refresh();
}
function undo() { if (!app.undo.length) return; app.redo.push(tidyJSON(app.draft.e)); app.draft = new Draft(JSON.parse(app.undo.pop())); app.lastKey = null; keepDraft(); render(); }
function redo() { if (!app.redo.length) return; app.undo.push(tidyJSON(app.draft.e)); app.draft = new Draft(JSON.parse(app.redo.pop())); app.lastKey = null; keepDraft(); render(); }
function keepDraft() {
  if (dirty()) store.set(DRAFT_KEY, JSON.stringify({ sha: app.sha, edits: app.draft.toJSON() }));
  else store.del(DRAFT_KEY);
}

// Text boxes type in capitals (every word on the unit is in capitals) and straight quotes.
function capsInput(el, onValue) {
  el.addEventListener('input', () => {
    const a = el.selectionStart, b = el.selectionEnd, v = caps(el.value);
    if (v !== el.value) { el.value = v; try { el.setSelectionRange(a, b); } catch { /* fine */ } }
    onValue(v);
  });
  return el;
}
// Keep a box in step with the draft (after undo, reset, …) unless it's being typed in.
function syncValue(el, v) { if (document.activeElement !== el && el.value !== v) el.value = v; }
function insertAtCaret(el, s) {
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, a) + s + el.value.slice(b);
  el.focus(); el.setSelectionRange(a + s.length, a + s.length);
  el.dispatchEvent(new Event('input'));
}

// --- loading and saving --------------------------------------------------------------------
async function boot() {
  drawSeal();
  let content = { v: CONTENT_VERSION }, broken = null;
  // serve.py only ever answers on this computer: anywhere else, don't ask it.
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  try {
    if (!local) throw new Error('not served by serve.py');
    const res = await fetch('api', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    content = j.content; app.sha = j.sha; app.file = j.file || app.file; app.writable = !!j.writable; broken = j.broken;
    app.mode = 'local';
  } catch {
    // Not serve.py: the public site. The edits live in the game's repo on GitHub.
    app.mode = 'github';
    app.file = gh.REPO_LABEL;
    try {
      const r = await gh.load();
      content = r.content; app.sha = r.sha; broken = r.broken;
    } catch (e) {
      app.loadError = e.message;
      try { const r = await fetch('../content/edits.json', { cache: 'no-store' }); if (r.ok) content = await r.json(); } catch { /* the game as written */ }
    }
    app.writable = !!gh.token.get() && !app.loadError;
  }
  app.draft = new Draft(content);
  app.saved = tidyJSON(content);
  if (broken) app.banners.push({ cls: 'bad', text: `${app.file} isn't valid JSON (edited by hand?). The controller starts from the game as written; saving replaces it (${app.mode === 'github' ? 'the old one stays in the repo\'s history' : 'the old one goes to content/backups/'}).` });
  // Unsaved changes from last time.
  try {
    const kept = JSON.parse(store.get(DRAFT_KEY) || 'null');
    if (kept && kept.edits && tidyJSON(kept.edits) !== app.saved) {
      if (kept.sha === app.sha) { app.draft = new Draft(kept.edits); toast('Your unsaved changes from last time are back.'); }
      else {
        const b = { cls: 'warn', text: `You left unsaved changes, and ${app.file} has changed since (another tab, or a git pull).` };
        const drop = () => { app.banners = app.banners.filter((x) => x !== b); };
        b.actions = [['Bring my changes back', () => { app.undo.push(tidyJSON(app.draft.e)); app.draft = new Draft(kept.edits); drop(); keepDraft(); render(); }], ['Drop them', () => { store.del(DRAFT_KEY); drop(); render(); }]];
        app.banners.push(b);
      }
    }
  } catch { /* nothing kept */ }
  if (app.mode === 'github' && app.loadError) app.banners.unshift({ cls: 'bad', text: `Couldn't read ${gh.REPO_LABEL} from GitHub (${app.loadError}). This shows the copy the game has; saving is off until the page is reloaded.` });
  else if (app.mode === 'github' && !app.writable) app.banners.unshift(signInBanner());
  else if (!app.writable) app.banners.unshift({ cls: 'info', text: 'Read-only here: saving needs the controller opened from python3 surveillance-cam/serve.py on this computer (http://localhost:8077/editor/). You can still edit and download edits.json.' });
  addEventListener('hashchange', () => render());
  addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ''; } });
  addEventListener('keydown', onKey);
  $('#save').addEventListener('click', save);
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#try').addEventListener('click', () => tryShift(app.shift));
  const search = $('#search');
  search.addEventListener('input', () => { const q = search.value.trim(); location.hash = q ? `#find/${encodeURIComponent(q)}` : '#shift/1'; });
  $('#navsel').addEventListener('change', (e) => { location.hash = e.target.value; });
  render();
}

function onKey(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
}

async function save() {
  const content = app.draft.toJSON();
  if (app.mode === 'github' && !app.loadError && !gh.token.get()) return signIn();
  if (!app.writable) return download();
  if (!dirty()) { toast('Nothing to save.'); return; }
  $('#save').disabled = true;
  try {
    if (app.mode === 'github') await saveToGitHub(content);
    else await saveToDisk(content);
  } finally { status(); }
}

async function saveToDisk(content) {
  try {
    const res = await fetch('api', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Clearance-Controller': '1' }, body: JSON.stringify({ content, base: app.sha }) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 409) return conflict(j);
    if (!res.ok) throw new Error(j.error || `the server said ${res.status}`);
    app.sha = j.sha; app.saved = tidyJSON(content); app.savedAt = new Date();
    keepDraft();
    toast(`Saved. The game picks it up when it's reloaded.`);
  } catch (e) {
    toast(`Not saved: ${e.message}. Is serve.py still running?`, 6000);
  }
}

// A commit to the game's public repo; GitHub Pages rebuilds the game from it.
async function saveToGitHub(content) {
  try {
    const r = await gh.save(content, app.sha, commitMessage(JSON.parse(app.saved || '{"v":1}'), content));
    app.sha = r.sha; app.saved = tidyJSON(content); app.savedAt = new Date(); app.commit = r.commit;
    keepDraft();
    toast('Saved to GitHub. The game rebuilds in about a minute.', 4500);
    watchLive(app.saved);
  } catch (e) {
    if (e.status === 409) {
      try { return conflict(await gh.load()); } catch (e2) { toast(`Not saved: ${e2.message}.`, 7000); return; }
    }
    if (e.status === 401) { gh.token.clear(); app.writable = false; return signIn(`Not saved: ${e.message}.`); }
    toast(`Not saved: ${e.message}.`, 8000);
  }
}

// "Controller: Shift 3 · memo; New request · A DOG" (what changed since the last save).
function commitMessage(before, after) {
  const a = new Draft(before), b = new Draft(after), ea = a.toJSON(), eb = b.toJSON();
  const key = (c) => `${c.where}|${c.id}|${c.field}`;
  const val = (e, c) => JSON.stringify(c.where === 'shift' ? ((e.shifts || {})[c.id] || {})[c.field]
    : c.where === 'quest' ? (c.field ? ((e.quests || {})[c.id] || {})[c.field] : (e.quests || {})[c.id]) : (e.lines || {})[c.id]);
  const was = new Map(a.changes().map((c) => [key(c), c])), now = new Map(b.changes().map((c) => [key(c), c]));
  const out = [];
  for (const [k, c] of now) if (!was.has(k) || val(ea, c) !== val(eb, c)) out.push(c.label);
  for (const [k, c] of was) if (!now.has(k)) out.push(`${c.label} back to the original`);
  const short = out.map((x) => (x.length > 70 ? `${x.slice(0, 69)}…` : x));
  return `Controller: ${short.slice(0, 3).join('; ') || 'saved'}${short.length > 3 ? `; and ${short.length - 3} more` : ''}`;
}

// After a save, watch the game's own copy until GitHub Pages has rebuilt it.
let liveTimer = null;
function watchLive(want) {
  clearTimeout(liveTimer);
  app.live = 'pending'; status();
  const started = Date.now();
  const poll = async () => {
    try {
      const r = await fetch(`../content/edits.json?t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok && tidyJSON(await r.json()) === want) { app.live = 'live'; status(); toast('✓ The game has your edits now. Reload it to play them.', 5000); return; }
    } catch { /* not yet */ }
    if (Date.now() - started > 6 * 60000) { app.live = 'slow'; status(); return; }
    liveTimer = setTimeout(poll, 10000);
  };
  liveTimer = setTimeout(poll, 12000);
}

// Sign in: a GitHub token that can write to the game's repo, kept in this browser.
function signInBanner() {
  return { cls: 'info', text: `This is the online controller: anyone can look, and saving needs your GitHub token (once on each device). SAVE commits to ${gh.REPO.owner}/${gh.REPO.repo}, and GitHub rebuilds the game in about a minute.`, actions: [['Sign in to save', () => signIn()]] };
}
function signIn(reason) {
  const input = h('input', { class: 't', type: 'password', placeholder: 'github_pat_…', autocomplete: 'off', spellcheck: 'false', style: 'text-transform:none' });
  const keep = h('input', { type: 'checkbox', checked: true, id: 'keep-token' });
  const err = h('div', { class: 'msg bad', style: 'display:block;margin-top:8px' }, reason || '');
  const steps = h('ol', { style: 'margin:6px 0 12px;padding-left:20px;line-height:1.6' },
    h('li', null, 'Open ', h('a', { href: gh.TOKEN_PAGE, target: '_blank', rel: 'noopener' }, 'GitHub ▸ new fine-grained token'), '.'),
    h('li', null, 'Name it ', h('b', null, 'Clearance controller'), '; expiration as long as you like (a year at most).'),
    h('li', null, 'Repository access: ', h('b', null, 'Only select repositories'), ' ▸ ', h('b', null, `${gh.REPO.owner}/${gh.REPO.repo}`), '.'),
    h('li', null, 'Permissions ▸ Repository permissions ▸ ', h('b', null, 'Contents: Read and write'), '.'),
    h('li', null, 'Generate the token, copy it, and paste it here.'));
  const go = async () => {
    const tok = input.value.trim();
    if (!tok) { err.textContent = 'Paste the token first.'; return; }
    err.textContent = 'Checking with GitHub…'; err.className = 'msg';
    try {
      await gh.check(tok);
      gh.token.set(tok, keep.checked);
      app.writable = !app.loadError;
      app.banners = app.banners.filter((b) => !b.actions || b.actions[0][0] !== 'Sign in to save');
      closeDialog(); render();
      toast(`Signed in. SAVE now commits to ${gh.REPO.owner}/${gh.REPO.repo}.`, 4000);
    } catch (e) { err.className = 'msg bad'; err.textContent = e.message; }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const buttons = [['Sign in', go, 'primary'], ['Cancel', closeDialog]];
  if (gh.token.get()) buttons.splice(1, 0, ['Sign out', () => { signOut(); closeDialog(); }, 'danger']);
  dialog('SIGN IN TO SAVE', [
    h('p', { style: 'margin-top:0' }, `SAVE commits your edits to the game's repository on GitHub (${gh.REPO.owner}/${gh.REPO.repo}), and GitHub rebuilds the game from them in about a minute. That needs a GitHub token that can write to that one repository. Make one once:`),
    steps,
    h('div', { class: 'field' }, h('div', { class: 'fl' }, h('label', { htmlFor: 'tok' }, 'Token')), input),
    h('label', { style: 'display:flex;gap:8px;align-items:center;margin-top:10px;font-size:13px' }, keep, 'Keep me signed in on this device'),
    h('p', { class: 'hint', style: 'margin:10px 0 0' }, `The token stays in this browser and only goes to GitHub. It can only change ${gh.REPO.owner}/${gh.REPO.repo}. Pages on thewilliamyao.github.io share this browser storage, so sign out on a computer that isn't yours.`),
    err,
  ], buttons);
  input.id = 'tok';
  setTimeout(() => input.focus(), 30);
}
function signOut() {
  gh.token.clear();
  app.writable = false;
  if (!app.banners.some((b) => b.actions && b.actions[0][0] === 'Sign in to save')) app.banners.unshift(signInBanner());
  render();
  toast('Signed out on this device.');
}

// The file changed since it was loaded (another tab or device, or a git pull or publish).
function conflict(j) {
  const where = app.mode === 'github' ? 'on GitHub' : 'on disk';
  dialog(`THE FILE CHANGED ${where.toUpperCase()}`, [
    h('p', null, app.mode === 'github'
      ? `${app.file} was changed after this page loaded it (a save from another tab or device, or a publish).`
      : `${app.file} was changed after this page loaded it (another controller tab, or a git pull brought William's edits from the other machine).`),
    h('p', null, 'Load it to see those changes (yours stay in undo, ↶), or overwrite it with what is on this page.'),
  ], [
    ['Load the file', () => { app.undo.push(tidyJSON(app.draft.e)); app.draft = new Draft(j.content || { v: 1 }); app.saved = tidyJSON(j.content || { v: 1 }); app.sha = j.sha; keepDraft(); closeDialog(); render(); toast('Loaded the file. ↶ brings your version back.'); }],
    ['Overwrite it', () => { app.sha = j.sha; closeDialog(); save(); }, 'primary'],
  ]);
}

function download() {
  const blob = new Blob([app.draft.text()], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'edits.json' });
  document.body.append(a); a.click(); a.remove();
  toast('Downloaded edits.json: put it in surveillance-cam/content/.');
}

// TRY: the game with this page's changes, a fresh Recorder on shift n, in a save of its own.
function tryShift(n) {
  store.set(TRY_KEY, JSON.stringify(app.draft.toJSON()));
  window.open(`../?try=${n}`, 'clearance-try');
}

function status() {
  const el = $('#status');
  const n = app.draft.changes().length;
  const d = dirty();
  const parts = [];
  const signInNeeded = app.mode === 'github' && !app.loadError && !gh.token.get();
  if (app.writable) {
    parts.push(h('b', null, app.file));
    if (d) parts.push(' · ', h('span', { class: 'dirty' }, '● not saved yet'));
    else if (app.live === 'pending') parts.push(' · saved · the game is rebuilding…');
    else if (app.live === 'live') parts.push(' · saved · live in the game');
    else if (app.live === 'slow') parts.push(' · saved · the game hasn\'t picked it up yet (GitHub is slow)');
    else if (app.savedAt) parts.push(` · saved ${app.savedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    else parts.push(' · saved');
  } else if (signInNeeded) parts.push(h('b', null, app.file), ' · read-only until you sign in', d ? h('span', { class: 'dirty' }, ' · ● not saved yet') : '');
  else parts.push(h('b', null, 'read-only'), d ? h('span', { class: 'dirty' }, ' · ● changes only on this page') : '');
  parts.push(` · ${plural(n, 'edit')} to the game as written`);
  if (app.warnings.length) parts.push(' · ', h('span', { class: 'dirty' }, plural(app.warnings.length, 'problem')));
  el.replaceChildren(...parts);
  const save = $('#save');
  save.textContent = signInNeeded ? 'SIGN IN' : app.writable ? 'SAVE' : 'DOWNLOAD';
  save.title = signInNeeded ? 'Sign in with your GitHub token to save' : app.mode === 'github' ? `Commit to ${app.file}; GitHub rebuilds the game (⌘S)` : `Save to ${app.file} (⌘S)`;
  save.disabled = app.writable && !d;
  $('#undo').disabled = !app.undo.length;
  $('#redo').disabled = !app.redo.length;
  $('#trywhat').textContent = ` SHIFT ${app.shift}`;
}

function drawSeal() {
  const r = new Raster(26, 26, $('#seal'));
  r.clear(0);
  seal(r, 13, 13, 12, P.ink, P.paper);
  r.present();
}

// --- dialogs -------------------------------------------------------------------------------
function dialog(title, body, buttons = [['Close', () => closeDialog()]]) {
  const dlg = $('#dlg');
  dlg.replaceChildren(
    h('div', { class: 'dh' }, title, h('button', { class: 'ib', onclick: closeDialog, 'aria-label': 'Close' }, '✕')),
    h('div', { class: 'db' }, body),
    h('div', { class: 'df' }, buttons.map(([label, fn, cls]) => h('button', { class: `btn ${cls || ''}`, onclick: fn }, label))),
  );
  if (!dlg.open) dlg.showModal();
  return dlg;
}
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }

// --- navigation ----------------------------------------------------------------------------
function route() {
  const [kind, ...rest] = location.hash.replace(/^#/, '').split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (kind === 'shift' && Number(arg) >= 1 && Number(arg) <= LAST_DAY) return { kind, id: Number(arg) };
  if (kind === 'requests') return { kind, id: arg || null };
  if (kind === 'words' && GROUPS.some((g) => g.id === arg)) return { kind, id: arg };
  if (kind === 'changes') return { kind };
  if (kind === 'find') return { kind, id: arg };
  return { kind: 'shift', id: 1 };
}

function nav() {
  const r = route(), here = location.hash || '#shift/1';
  const links = [];
  const add = (href, kids, cls = '') => links.push(h('a', { href, class: `${href === here ? 'on' : ''} ${cls}` }, kids));
  links.push(h('h4', null, 'SHIFTS'));
  for (let n = 1; n <= LAST_DAY; n++) {
    const s = app.draft.shift(n);
    const edited = app.draft.shiftChanged(n) || s.pick.flat().some((k) => app.draft.questChanged(k)) || Object.keys(LINES).some((k) => LINES[k].shift === n && app.draft.lineChanged(k));
    add(`#shift/${n}`, [h('span', { class: 'n' }, n), h('span', { class: 'nm' }, fill(s.code)), edited ? h('span', { class: 'dot', title: 'edited' }) : null]);
  }
  links.push(h('h4', null, 'REQUESTS'));
  const custom = app.draft.customKeys().length;
  add('#requests', [h('span', { class: 'nm' }, 'Every request'), custom ? h('span', { class: 'cnt' }, `${custom} NEW`) : null]);
  links.push(h('h4', null, 'WORDS ON THE UNIT'));
  for (const g of GROUPS) {
    const n = Object.keys(g.lines).filter((k) => app.draft.lineChanged(`${g.id}.${k}`)).length;
    add(`#words/${g.id}`, [h('span', { class: 'nm', style: 'font-family:var(--sans);font-size:13px' }, g.name), n ? h('span', { class: 'cnt' }, n) : null]);
  }
  links.push(h('h4', null, 'FILE'));
  const changes = app.draft.changes().length;
  add('#changes', [h('span', { class: 'nm', style: 'font-family:var(--sans);font-size:13px' }, 'All changes'), changes ? h('span', { class: 'cnt' }, changes) : null, app.warnings.length ? h('span', { class: 'dot', title: 'problems' }) : null]);
  $('#links').replaceChildren(...links);
  // Phones: the same list as a menu.
  const sel = $('#navsel');
  const opts = [];
  for (let n = 1; n <= LAST_DAY; n++) opts.push([`#shift/${n}`, `Shift ${n} · ${fill(app.draft.shift(n).code)}`]);
  opts.push(['#requests', 'Every request']);
  for (const g of GROUPS) opts.push([`#words/${g.id}`, `Words · ${g.name}`]);
  opts.push(['#changes', `All changes (${changes})`]);
  sel.replaceChildren(...opts.map(([v, l]) => h('option', { value: v }, l)));
  sel.value = r.kind === 'find' ? '' : here;
}

let lastRoute = '';
function render() {
  const r = route();
  if (r.kind === 'shift') app.shift = r.id;
  const key = location.hash;
  const scroll = key === lastRoute ? scrollY : 0;
  lastRoute = key;
  LIVE = [];
  const main = $('#main');
  const page = r.kind === 'shift' ? shiftPage(r.id)
    : r.kind === 'requests' ? questsPage(r.id)
      : r.kind === 'words' ? wordsPage(r.id)
        : r.kind === 'changes' ? changesPage()
          : searchPage(r.id);
  const banners = app.banners.map((b) => h('div', { class: `banner ${b.cls}` }, h('span', { class: 'grow' }, b.text),
    (b.actions || []).map(([l, fn]) => h('button', { class: 'btn', onclick: fn }, l)),
    b.actions ? null : h('button', { class: 'ib', onclick: () => { app.banners = app.banners.filter((x) => x !== b); render(); }, 'aria-label': 'Dismiss' }, '✕')));
  main.replaceChildren(...banners, page);
  if (document.activeElement !== $('#search')) $('#search').value = r.kind === 'find' ? r.id : '';
  refreshNow();
  scrollTo(0, scroll);
  let target = null;
  try { target = sessionStorage.getItem('clearance.controller.goto'); sessionStorage.removeItem('clearance.controller.goto'); } catch { /* fine */ }
  if (target) {
    const el = document.querySelector(target);
    if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); if (el.tagName === 'DETAILS') el.open = true; const f = el.querySelector('input,textarea'); if (f) f.focus({ preventScroll: true }); }
  }
}
// Go to a page and to one thing on it.
function goTo(hash, selector) {
  if (selector) try { sessionStorage.setItem('clearance.controller.goto', selector); } catch { /* fine */ }
  if (location.hash === hash) render(); else location.hash = hash;
}

// --- screen previews -----------------------------------------------------------------------
const sampleWording = (n) => { const o = DAYS[n - 1].pick[0]; return o && REQUESTS[o[0]] ? fill(REQUESTS[o[0]].text, { NO: '012' }) : 'SOMETHING RED'; };
// The question in the YOU SURE? preview: the one last typed in, else shift 5's first.
const sampleAsk = () => {
  const k = (app.focusAsk && REQUESTS[app.focusAsk]) ? app.focusAsk : DAYS[4].pick.flat().find((x) => REQUESTS[x] && REQUESTS[x].word) || 'sadness';
  return fill(app.draft.quest(k).ask || '');
};
const sampleWhy = () => (app.focusLine && app.focusLine.startsWith('verdict.') ? fill(TEXT[app.focusLine], LINES[app.focusLine].vars) : t('verdict.noSubject'));

const TABS = {
  title: ['Title', (n) => SCREENS.title(n)],
  order: ['Work order', (n) => SCREENS.order(n, app.seed)],
  viewfinder: ['Viewfinder', (n) => SCREENS.viewfinder(n, app.seed)],
  quota: ['Quota bubble', (n) => SCREENS.quotaBubble(n, app.seed)],
  film: ['Film bubble', (n) => SCREENS.filmBubble(n, app.seed)],
  ask: ['YOU SURE?', () => SCREENS.ask(5, 0, sampleAsk())],
  filed: ['FILED', (n) => SCREENS.filed(n, 0, sampleWording(n), 33)],
  notFiled: ['NOT FILED', (n) => SCREENS.notFiled(n, 0, sampleWhy())],
  menu: ['Menu', (n) => SCREENS.menu(n)],
  confirm: ['A question', (n) => SCREENS.confirm(n)],
  report: ['Report', (n) => SCREENS.report(n, app.seed, true)],
  cited: ['Report, cited', (n) => SCREENS.report(n, app.seed, false)],
  shop: ['Requisitions', (n) => SCREENS.shop(n)],
  settings: ['Settings', (n) => SCREENS.settings(n)],
  index: ['The index', (n) => SCREENS.index(n)],
  nocam: ['No camera', (n) => SCREENS.nocam(n)],
  endFiled: ['Notice', () => SCREENS.endingFiled(LAST_DAY, 0, 2)],
  endSheet: ['Contact sheet', () => SCREENS.endingFiled(LAST_DAY, 0, 0)],
  endRevoked: ['Revoked', () => SCREENS.endingRevoked()],
  endExposed: ['Incident report', () => SCREENS.endingExposed(6, 0, 2)],
  endNoFile: ['No file', () => SCREENS.endingNoFile()],
};
const GROUP_TABS = {
  global: ['order', 'report', 'endFiled'], title: ['title'], order: ['order'], field: ['viewfinder', 'quota', 'film'],
  ask: ['ask'], develop: ['filed', 'notFiled'], verdict: ['notFiled'], menu: ['menu', 'confirm'], archive: [],
  report: ['report', 'cited'], shop: ['shop'], settings: ['settings'], index: ['index'],
  ending: ['endFiled', 'endSheet', 'endRevoked', 'endExposed', 'endNoFile'], nocam: ['nocam'],
};

// A 320x240 preview at 2x, with tabs; notes(n) can add a line under it.
function screenPanel(tabs, n, { reroll = false, notes = null, title = 'ON THE UNIT' } = {}) {
  if (!tabs.length) return null;
  let cur = tabs[0];
  const canvas = h('canvas', { class: 'px', width: 320, height: 240 });
  const ctx = canvas.getContext('2d');
  const tabBtns = tabs.map((id) => h('button', { class: id === cur ? 'on' : '', onclick: () => { cur = id; tabBtns.forEach((b, i) => b.classList.toggle('on', tabs[i] === cur)); draw(); } }, TABS[id][0]));
  const note = h('div', { class: 'note' });
  const draw = () => {
    try { ctx.drawImage(TABS[cur][1](n), 0, 0); } catch (e) { console.error(e); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 320, 240); }
    if (notes) { const m = notes(cur); note.textContent = m ? m.text : ''; note.className = `note ${m ? m.cls || '' : ''}`; note.hidden = !m; } else note.hidden = true;
  };
  live(draw);
  const buttons = [];
  if (reroll) buttons.push(h('button', { onclick: () => { app.seed++; refresh(); }, title: 'Draw another sample work order from the pool' }, '↻ ANOTHER DRAW'));
  return h('div', { class: 'screen' },
    h('div', { class: 'cap' }, h('span', null, title), h('span', { class: 'tabs' }, tabs.length > 1 ? tabBtns : null, buttons)),
    canvas, note);
}

// --- one line of text ---------------------------------------------------------------------
function fitMessage(m, fit, text) {
  if (fit.doc && m.over) return { cls: 'bad', text: `${m.n} lines: room for about ${fit.lines} before the stamp` };
  if (m.over && fit.lines) return { cls: 'bad', text: `${m.n} lines: room for ${fit.lines}` };
  if (m.over && !fit.lines) return { cls: 'warn', text: 'One line only here: the line break shows as a gap' };
  if (m.wide && fit.cut) return { cls: 'warn', text: `${m.wide} px too long here: the unit cuts it with …` };
  if (m.wide) return { cls: 'bad', text: `${m.wide} px too wide${fit.lines ? ' (one word is longer than the box)' : ''}: it runs over` };
  const spare = fit.lines ? `${fit.lines - m.n} spare ${fit.lines - m.n === 1 ? 'line' : 'lines'}` : `${fit.w - Math.max(...m.rows.map((r) => textWidth(r, fit.scale || 1)))} px spare`;
  return { cls: 'ok', text: `✓ fits · ${spare}` };
}
function textProblems(key, raw, allowed) {
  const out = [];
  const unknown = [...String(raw).matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)].map((m) => m[1]).filter((v) => !allowed.includes(v));
  if (unknown.length) out.push({ cls: 'bad', text: `{${[...new Set(unknown)].join('}, {')}} isn't filled in here: it prints as ?${unknown[0]}?` });
  const miss = missingGlyphs(raw.replace(/\{[A-Z0-9_]+\}/g, ''));
  if (miss.length) out.push({ cls: 'bad', text: `The unit's font has no ${miss.map((c) => `“${c}”`).join(' ')}: ${miss.length === 1 ? 'it prints' : 'they print'} as ?` });
  return out;
}

// A line from text.js: its box, where it shows, the pixel preview, fit, reset.
function lineField(key) {
  const l = LINES[key];
  const value = app.draft.line(key);
  const multi = !!(l.fit.lines > 1 || l.fit.doc || value.length > 70 || value.includes('\n'));
  const input = multi
    ? h('textarea', { class: 't', rows: Math.min(10, Math.max(2, (l.fit.doc ? 8 : l.fit.lines || 2))), id: `line-${key}` })
    : h('input', { class: 't', type: 'text', id: `line-${key}`, spellcheck: 'false' });
  input.value = value;
  capsInput(input, (v) => { app.focusLine = key; change(`line:${key}`, () => app.draft.setLine(key, v)); });
  input.addEventListener('focus', () => { app.focusLine = key; refresh(); });
  const allowed = placeholders(key);
  const chips = allowed.map((v) => h('button', { class: 'chip', type: 'button', title: `Insert {${v}}`, onclick: () => insertAtCaret(input, `{${v}}`) }, `{${v}}`));
  const msg = h('span', { class: 'msg' });
  const probs = h('span', { class: 'msg bad' });
  const reset = h('button', { class: 'reset', type: 'button', onclick: () => { change(`reset:${key}`, () => app.draft.resetLine(key)); input.value = app.draft.line(key); } }, '↺ back to the original');
  const was = h('div', { class: 'was' });
  const canvas = h('canvas', { class: 'px' });
  const wrap = h('div', { class: 'field', 'data-line': key },
    h('div', { class: 'fl' }, h('label', { htmlFor: input.id, class: 'wl' }, l.where), h('span', { style: 'flex:1' }), h('span', { class: 'key', title: 'Its name in text.js and edits.json' }, key)),
    input,
    h('div', { class: 'foot' }, msg, probs, h('span', { style: 'flex:1' }), chips),
    h('div', { class: 'pxbox' }, canvas), was, h('div', { class: 'foot' }, reset));
  live(() => {
    const raw = app.draft.line(key), changed = app.draft.lineChanged(key);
    syncValue(input, raw);
    wrap.classList.toggle('changed', changed);
    const r = lineCanvas(fill(raw, l.vars), l.fit, canvas);
    canvas.style.width = `${canvas.width * 2}px`;
    const m = fitMessage(r, l.fit, raw);
    msg.className = `msg ${m.cls}`; msg.textContent = m.text;
    const p = textProblems(key, raw, allowed);
    probs.textContent = p.map((x) => x.text).join(' · ');
    reset.parentElement.hidden = !changed;
    was.hidden = !changed; was.textContent = changed ? `Was: ${DEFAULTS.lines[key]}` : '';
  });
  return wrap;
}

// --- shift pages ---------------------------------------------------------------------------
// Where the film line lands on the work order (it must stay above ● ACCEPT ORDER at y 222).
function orderRoom(n) {
  const d = DAYS[n - 1];
  const L = wrapText(shiftLine(d, 'memo'), 284).length;
  const note = shiftLine(d, 'issueNote') ? 13 : 0;
  const M = wrapText(t('order.modules', { LIST: d.modules.map((id) => MODULES[id].name).join(' · ') }), 284).length;
  const R = d.pick.length;
  const filmY = 65 + 9 * L + 9 * M + 11 * R + note;
  return { L, R, filmY, spare: 213 - filmY };
}
function issued(n) {
  const iss = DEFAULTS.shifts[n - 1].issue || {};
  const names = { sensor: SENSORS, tone: TONES, lens: LENSES, film: FILMS };
  return Object.entries(iss).map(([k, v]) => (names[k] && names[k][v] ? names[k][v].name : `${k} ${v}`));
}

function shiftPage(n) {
  const s = app.draft.shift(n), def = DEFAULTS.shifts[n - 1];
  const head = h('div', { class: 'page-h' }, h('h1', null, `SHIFT ${n} · `, h('span', { id: 'shname' }, fill(s.code))),
    h('span', { class: 'sub' }, `Modules: ${def.modules.map(modName).join(' · ')}${issued(n).length ? ` · issues ${issued(n).join(', ')}` : ''}`));
  live(() => { $('#shname').textContent = fill(app.draft.shift(n).code); });

  // The work order: name, memo, issue note.
  const field = (name, label, where, el, extra) => {
    const wrap = h('div', { class: 'field', 'data-shift-field': `${n}-${name}` },
      h('div', { class: 'fl' }, h('label', { htmlFor: el.id }, label), h('span', { class: 'where' }, where)),
      el, extra || null);
    live(() => { wrap.classList.toggle('changed', app.draft.shiftChanged(n, name)); syncValue(el, app.draft.shift(n)[name] || ''); });
    return wrap;
  };
  const resetBtn = (name) => {
    const b = h('button', { class: 'reset', type: 'button', onclick: () => change(`reset:${n}:${name}`, () => app.draft.resetShift(n, name), { rerender: true }) }, '↺ back to the original');
    live(() => { b.hidden = !app.draft.shiftChanged(n, name); });
    return b;
  };
  const code = capsInput(h('input', { class: 't', type: 'text', id: `shift-${n}-code`, value: s.code, spellcheck: 'false' }), (v) => change(`shift:${n}:code`, () => app.draft.setShift(n, 'code', v)));
  const codeMsg = h('span', { class: 'msg' });
  live(() => {
    const line = t('order.title', { SHIFT: n, SHIFTS: LAST_DAY, NAME: shiftLine(DAYS[n - 1], 'code') });
    const over = textWidth(line) - LINES['order.title'].fit.w;
    const p = textProblems('', app.draft.shift(n).code, ['RECORDER', 'UNIT']);
    codeMsg.className = `msg ${over > 0 || p.length ? 'bad' : 'ok'}`;
    codeMsg.textContent = p.length ? p[0].text : over > 0 ? `The work order's header runs ${over} px too wide` : '✓ fits in the headers';
  });
  const memo = capsInput(h('textarea', { class: 't', rows: 5, id: `shift-${n}-memo`, value: s.memo }), (v) => change(`shift:${n}:memo`, () => app.draft.setShift(n, 'memo', v)));
  const memoMsg = h('span', { class: 'msg' });
  const memoChips = ['RECORDER', 'UNIT'].map((v) => h('button', { class: 'chip', type: 'button', onclick: () => insertAtCaret(memo, `{${v}}`) }, `{${v}}`));
  live(() => {
    const r = orderRoom(n), raw = app.draft.shift(n).memo;
    const p = textProblems('', raw, ['RECORDER', 'UNIT']);
    const secs = (shiftLine(DAYS[n - 1], 'memo').length / 70).toFixed(1);
    if (p.length) { memoMsg.className = 'msg bad'; memoMsg.textContent = p.map((x) => x.text).join(' · '); return; }
    memoMsg.className = `msg ${r.spare < 0 ? 'bad' : r.spare < 9 ? 'warn' : 'ok'}`;
    memoMsg.textContent = r.spare < 0
      ? `${r.L} lines: with ${plural(r.R, 'request')} the work order runs ${-r.spare} px into ● ACCEPT ORDER. Shorten it, or take a slot out.`
      : `${r.L} lines · ${r.spare >= 9 ? `room for ${Math.floor(r.spare / 9)} more` : 'just fits'} with ${plural(r.R, 'request')} · types out in ${secs} s`;
  });
  const note = capsInput(h('input', { class: 't', type: 'text', id: `shift-${n}-issueNote`, value: s.issueNote || '', placeholder: 'none', spellcheck: 'false' }), (v) => change(`shift:${n}:issueNote`, () => app.draft.setShift(n, 'issueNote', v)));
  const noteMsg = h('span', { class: 'msg' });
  live(() => {
    // The note's dark bar starts at x 16 and must end inside the paper (x 309).
    const w = textWidth('▸ ' + shiftLine(DAYS[n - 1], 'issueNote')) - 289;
    noteMsg.className = `msg ${w > 6 ? 'bad' : w > 0 ? 'warn' : 'ok'}`;
    noteMsg.textContent = !app.draft.shift(n).issueNote ? 'Empty: no note on the work order.' : w > 0 ? `Its bar runs ${w} px past the paper's edge` : `✓ fits · ${-w} px spare`;
  });

  const order = h('div', { class: 'card' },
    h('h2', null, 'THE WORK ORDER'),
    h('p', { class: 'hint' }, 'What the Office hands the Recorder at the start of the shift.'),
    field('code', 'Name', `On the work order, the menu and the shift report.`, code, h('div', { class: 'foot' }, codeMsg, h('span', { style: 'flex:1' }), resetBtn('code'))),
    field('memo', 'Memo', 'Typed out at the top of the work order.', memo, h('div', { class: 'foot' }, memoMsg, h('span', { style: 'flex:1' }), memoChips, resetBtn('memo'))),
    field('issueNote', 'Issue note', issued(n).length ? `Under the memo, in reverse. This shift issues ${issued(n).join(', ')}.` : 'Under the memo, in reverse (this shift issues no hardware).', note, h('div', { class: 'foot' }, noteMsg, h('span', { style: 'flex:1' }), resetBtn('issueNote'))),
  );

  // Work-order requests on this shift.
  const keys = [...new Set(app.draft.shift(n).pick.flat())];
  const quests = h('div', { class: 'card' },
    h('h2', null, 'THESE REQUESTS\' WORDING'),
    h('p', { class: 'hint' }, 'A request reads the same on every shift that can draw it. Its full settings are on the Every request page.'),
    keys.map((k) => questCard(k, { shift: n })));

  const lines = Object.keys(LINES).filter((k) => LINES[k].shift === n);
  const linesCard = lines.length ? h('div', { class: 'card' },
    h('h2', null, 'LINES THAT ONLY SHOW ON THIS SHIFT'),
    h('p', { class: 'hint' }, n === 7 ? 'The hints for THE RECORDER and the ending it leads to.' : n === 5 ? 'The bubble INTENT puts up the first time a request is shot.' : 'Shown once, the first time in the field.'),
    lines.map(lineField)) : null;

  const tabs = ['order', 'viewfinder', ...(n === 5 ? ['ask'] : []), 'quota', 'report', ...(n === LAST_DAY ? ['endFiled', 'endRevoked'] : [])];
  const side = h('div', { class: 'side' },
    screenPanel(tabs, n, {
      reroll: true,
      notes: (tab) => {
        if (tab !== 'order') return null;
        const r = orderRoom(n);
        return r.spare < 0 ? { cls: 'bad', text: `With ${plural(r.R, 'request')} the work order runs ${-r.spare} px into ● ACCEPT ORDER.` } : { text: 'A sample draw from this shift\'s pool. ↻ draws another.' };
      },
    }),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => tryShift(n) }, `▶ Try shift ${n} with these changes`),
      h('span', { class: 'msg', style: 'color:var(--mid)' }, 'A fresh Recorder in a test save; your real game is untouched.')));

  return h('div', null, head,
    h('p', { class: 'lede' }, n === 6 ? 'Shift 6 asks about earlier photos. A fresh Recorder (TRY) has none, so the game swaps those requests for shift 5 ones, as it does for any Recorder without them.' : n === LAST_DAY ? 'THE RECORDER stays on this shift: filing it is how the game ends.' : ''),
    h('div', { class: 'cols' }, h('div', null, order, poolEditor(n), quests, linesCard), side));
}

// The requests a shift's work order can draw: slots, each drawing one of its requests.
function poolEditor(n) {
  const s = app.draft.shift(n), pick = s.pick;
  const set = (p, key = `pick:${n}`) => change(key, () => app.draft.setShift(n, 'pick', p), { rerender: true });
  const selfCount = pick.flat().filter((k) => k === 'self').length;
  const label = (k) => {
    const q = app.draft.quest(k);
    return fill(q.short || q.text || k, { NO: 'N' });
  };
  const chip = (k, i) => {
    const q = app.draft.quest(k);
    const locked = k === 'self' && selfCount <= 1;
    return h('span', { class: `q ${q.custom ? 'custom' : ''}`, title: REQUESTS[k] ? REQUESTS[k].how || '' : 'This request has a problem (Every request page)' },
      h('a', { href: `#requests/${k}`, onclick: (e) => { e.preventDefault(); goTo(`#requests/${k}`, `[data-quest="${k}"]`); }, style: 'color:inherit;text-decoration:none' }, label(k)),
      h('span', { class: 'm' }, q.merit),
      h('button', { title: locked ? 'THE RECORDER ends the game: it stays' : 'Take it out of this slot', disabled: locked, onclick: () => {
        const p = pick.map((o) => o.slice()); p[i] = p[i].filter((x) => x !== k);
        set(p.filter((o) => o.length));
      } }, '×'));
  };
  const quotaVal = s.quota;
  const quota = h('div', { class: 'quota' },
    'The Recorder must file',
    h('span', { class: 'stepper' },
      h('button', { disabled: quotaVal <= 1, onclick: () => change(`quota:${n}`, () => app.draft.setShift(n, 'quota', quotaVal - 1), { rerender: true }), 'aria-label': 'Fewer' }, '−'),
      h('span', null, quotaVal),
      h('button', { disabled: quotaVal >= pick.length, onclick: () => change(`quota:${n}`, () => app.draft.setShift(n, 'quota', quotaVal + 1), { rerender: true }), 'aria-label': 'More' }, '+')),
    `of the ${plural(pick.length, 'request')} drawn. Missing the quota costs a citation; meeting it pays a 20% bonus.`,
    app.draft.shiftChanged(n, 'quota') ? h('button', { class: 'reset', onclick: () => change(`reset:${n}:quota`, () => app.draft.resetShift(n, 'quota'), { rerender: true }) }, '↺ original') : null);
  const slots = pick.map((opts, i) => h('div', { class: 'slot' },
    h('div', { class: 'no' }, `#${i + 1}`, h('br'), opts.length > 1 ? 'ONE OF' : ''),
    h('div', { class: 'opts' }, opts.map((k) => chip(k, i)),
      h('button', { class: 'add', onclick: () => pickQuest(n, { exclude: opts, onPick: (k) => { const p = pick.map((o) => o.slice()); p[i].push(k); set(p); } }) }, '+ or…')),
    h('div', { class: 'acts' },
      h('button', { class: 'ib', title: 'Move up', disabled: i === 0, onclick: () => { const p = pick.map((o) => o.slice()); [p[i - 1], p[i]] = [p[i], p[i - 1]]; set(p); } }, '↑'),
      h('button', { class: 'ib', title: 'Move down', disabled: i === pick.length - 1, onclick: () => { const p = pick.map((o) => o.slice()); [p[i + 1], p[i]] = [p[i], p[i + 1]]; set(p); } }, '↓'),
      h('button', { class: 'ib', title: opts.includes('self') && selfCount <= 1 ? 'THE RECORDER ends the game: it stays' : 'Remove this slot', disabled: pick.length <= 1 || (opts.includes('self') && selfCount <= 1), onclick: () => set(pick.filter((_, j) => j !== i)) }, '✕'))));
  return h('div', { class: 'card', 'data-pool': n },
    h('h2', null, 'WHAT THE WORK ORDER CAN ASK', app.draft.shiftChanged(n, 'pick') ? h('button', { class: 'reset', onclick: () => change(`reset:${n}:pick`, () => app.draft.resetShift(n, 'pick'), { rerender: true }) }, '↺ back to the original') : null),
    h('p', { class: 'hint' }, `Each slot becomes one request when the shift starts, drawn at random from its list, never the same request twice${n === 6 ? ' (except THE SUBJECT OF EXPOSURE #N AGAIN, which picks a different photo each time)' : ''}. Only requests this shift's modules can judge are offered.`),
    quota, h('div', { class: 'slots' }, slots),
    h('div', { style: 'margin-top:10px' }, h('button', { class: 'add', disabled: pick.length >= 12, onclick: () => pickQuest(n, { exclude: [], onPick: (k) => set([...pick.map((o) => o.slice()), [k]]) }) }, '+ Add a slot')));
}

// Choose a request for a slot (or make a new one).
function pickQuest(n, { exclude = [], onPick }) {
  const mods = DAYS[n - 1].modules;
  const ok = (k) => REQUESTS[k] && mods.includes(REQUESTS[k].mod) && (k !== 'self' || n === LAST_DAY);
  const search = h('input', { class: 't', type: 'search', placeholder: 'Find a request…', style: 'text-transform:none' });
  const list = h('div', { class: 'pick-list' });
  const fillList = () => {
    const q = search.value.trim().toUpperCase();
    const keys = app.draft.questKeys().filter(ok).filter((k) => !q || `${REQUESTS[k].text} ${REQUESTS[k].short || ''} ${REQUESTS[k].how || ''}`.toUpperCase().includes(q));
    const rows = [];
    for (const m of MODULE_ORDER) {
      const ks = keys.filter((k) => REQUESTS[k].mod === m);
      if (!ks.length) continue;
      rows.push(h('div', { class: 'modh' }, `${modName(m)} · ${MODULES[m].what}`));
      for (const k of ks) {
        const r = REQUESTS[k], used = app.draft.shiftsUsing(k);
        rows.push(h('button', { class: 'pick-row', disabled: exclude.includes(k), onclick: () => { closeDialog(); onPick(k); } },
          h('div', null, h('div', { class: 'w' }, fill(r.text, { NO: 'N' }), app.draft.isCustom(k) ? h('span', { class: 'chip', style: 'margin-left:6px' }, 'NEW') : null), h('div', { class: 'h' }, r.how || '')),
          h('div', { class: 'h', style: 'text-align:right' }, `${r.merit} merit`, h('br'), used.length ? `shift ${used.join(', ')}` : 'on no shift')));
      }
    }
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint' }, 'Nothing matches.')]));
  };
  search.addEventListener('input', fillList);
  fillList();
  dialog(`ADD A REQUEST TO SHIFT ${n}`, [
    h('p', { class: 'hint', style: 'margin-top:0' }, `Shift ${n} has ${mods.map(modName).join(', ')}. Requests that need another module aren't listed.`),
    search, list,
  ], [
    ['+ Make a new request…', () => newQuest({ shift: n, onCreate: (k) => onPick(k) })],
    ['Cancel', closeDialog],
  ]);
  setTimeout(() => search.focus(), 30);
}

// --- requests -------------------------------------------------------------------------------
function questCard(key, { shift = null, open = false } = {}) {
  const q = app.draft.quest(key);
  const def = REQUESTS[key];
  const card = h('details', { class: 'quest', 'data-quest': key, open: open || null });
  const sum = h('summary', null,
    h('div', null, h('div', { class: 'w', id: `qw-${key}` }), h('div', { class: 'hint', style: 'color:var(--mid);font-size:12px;margin-top:2px' }, def ? def.how || '' : '')),
    h('div', { class: 'meta', id: `qm-${key}` }));
  live(() => {
    const cur = app.draft.quest(key);
    $(`#qw-${CSS.escape(key)}`, card).textContent = fill(cur.text || key, { NO: 'N' });
    const used = app.draft.shiftsUsing(key);
    $(`#qm-${CSS.escape(key)}`, card).replaceChildren(...[
      cur.custom ? h('span', { class: 's new' }, 'NEW') : app.draft.questChanged(key) ? h('span', { class: 's ed' }, 'EDITED') : null,
      ...used.map((u) => h('span', { class: 's' }, `S${u}`)),
      h('span', null, `${cur.merit ?? 0} merit`)].filter(Boolean));
  });
  card.append(sum);
  // The body is built the first time it opens (a page can hold 60 of these).
  let built = false;
  const build = () => { if (built) return; built = true; card.append(questBody(key, shift)); refresh(); };
  card.addEventListener('toggle', () => { if (card.open) build(); });
  if (open) build();
  return card;
}

function questBody(key, shift) {
  const q = app.draft.quest(key);
  const body = h('div', { class: 'body' });
  const fieldWrap = (name, label, where, el, extra) => {
    const w = h('div', { class: 'field' }, h('div', { class: 'fl' }, h('label', { htmlFor: el.id }, label), h('span', { class: 'where' }, where)), el, extra || null);
    live(() => { w.classList.toggle('changed', !q.custom && app.draft.questChanged(key, name)); const v = app.draft.quest(key)[name]; if (el.type !== 'number') syncValue(el, v == null ? '' : String(v)); });
    return w;
  };
  const resetBtn = (name) => {
    if (q.custom) return null;
    const b = h('button', { class: 'reset', type: 'button', onclick: () => change(`reset:${key}:${name}`, () => app.draft.resetQuest(key, name), { rerender: true }) }, '↺ original');
    live(() => { b.hidden = !app.draft.questChanged(key, name); });
    return b;
  };
  const preview = (getText, fit) => {
    const c = h('canvas', { class: 'px' });
    const m = h('span', { class: 'msg' });
    live(() => {
      const raw = getText();
      const r = lineCanvas(fill(raw, { NO: '012' }), fit, c);
      c.style.width = `${c.width * 2}px`;
      const f = fitMessage(r, fit, raw);
      const p = textProblems('', raw, ['RECORDER', 'UNIT', ...(q.dynamic ? ['NO'] : [])]);
      m.className = `msg ${p.length ? 'bad' : f.cls === 'ok' ? 'ok' : 'warn'}`;
      m.textContent = p.length ? p.map((x) => x.text).join(' · ') : f.cls === 'ok' ? f.text : `${r.wide} px too long: the unit cuts it with …`;
    });
    return [h('div', { class: 'pxbox' }, c), m];
  };
  const text = capsInput(h('input', { class: 't', type: 'text', id: `q-${key}-text`, value: q.text || '', spellcheck: 'false' }), (v) => change(`q:${key}:text`, () => app.draft.setQuest(key, 'text', v)));
  const short = capsInput(h('input', { class: 't', type: 'text', id: `q-${key}-short`, value: q.short || '', placeholder: 'same as the wording', spellcheck: 'false' }), (v) => change(`q:${key}:short`, () => app.draft.setQuest(key, 'short', v)));
  const merit = h('input', { class: 't num', type: 'number', id: `q-${key}-merit`, min: 0, max: 999, step: 1, value: q.merit ?? 20 });
  merit.addEventListener('input', () => { const v = Math.round(Number(merit.value)); if (Number.isFinite(v) && v >= 0 && v <= 999) change(`q:${key}:merit`, () => app.draft.setQuest(key, 'merit', v)); });
  live(() => { const v = app.draft.quest(key).merit; if (document.activeElement !== merit && Number(merit.value) !== v) merit.value = v; });

  body.append(
    fieldWrap('text', 'Wording', 'On the work order (cut at 200 px), the FILED stamp and the archive.', text,
      h('div', { class: 'foot' }, ...preview(() => app.draft.quest(key).text || '', { w: 200, cut: true }), h('span', { style: 'flex:1' }), q.dynamic ? h('button', { class: 'chip', onclick: () => insertAtCaret(text, '{NO}') }, '{NO}') : null, resetBtn('text'))),
    fieldWrap('short', 'Short wording', 'In the viewfinder\'s list, top left (cut at 170 px). Empty: the wording.', short,
      h('div', { class: 'foot' }, ...preview(() => { const c = app.draft.quest(key); return c.short || c.text || ''; }, { w: 170, cut: true }), h('span', { style: 'flex:1' }), resetBtn('short'))),
    fieldWrap('merit', 'Merit', 'Paid when it\'s filed (more with a sharper sensor and a cleaner match).', merit, h('div', { class: 'foot' }, resetBtn('merit'))),
  );
  // Shift 5's question and label.
  const hasWord = q.custom ? q.kind === 'word' : q.ask !== undefined;
  if (hasWord) {
    const ask = capsInput(h('input', { class: 't', type: 'text', id: `q-${key}-ask`, value: q.ask || '', spellcheck: 'false' }), (v) => { app.focusAsk = key; change(`q:${key}:ask`, () => app.draft.setQuest(key, 'ask', v)); });
    ask.addEventListener('focus', () => { app.focusAsk = key; refresh(); });
    const label = capsInput(h('input', { class: 't', type: 'text', id: `q-${key}-label`, value: q.label || '', spellcheck: 'false' }), (v) => change(`q:${key}:label`, () => app.draft.setQuest(key, 'label', v)));
    body.append(
      fieldWrap('ask', 'Question', 'INTENT asks it in the YOU SURE? bubble the first time this request is shot (172 px wide).', ask,
        h('div', { class: 'foot' }, ...preview(() => app.draft.quest(key).ask || '', { w: 172, lines: 6 }), h('span', { style: 'flex:1' }), resetBtn('ask'))),
      fieldWrap('label', 'Label', q.custom ? 'What the Recorder files them as: the tag on the photo, and what later photos that look like it get called. (New labels stay on the phone: the shared index only takes its ten.)' : 'What the Recorder files them as: the tag on the photo, what later photos get called, and the shelf in the shared index.', label,
        h('div', { class: 'foot' }, ...preview(() => app.draft.quest(key).label || '', { w: 120 }), h('span', { style: 'flex:1' }), resetBtn('label'))),
    );
  }
  if (q.custom) body.append(kindSettings(key));
  const how = h('div', { class: 'how' });
  live(() => {
    const r = REQUESTS[key], probs = app.draft.questProblems(key);
    how.replaceChildren(...[
      h('b', null, 'How the unit judges it: '), r ? fill(r.how || '', { NO: 'N' }) : 'not at all yet.',
      probs.length ? h('div', { class: 'msg bad', style: 'display:block;margin-top:4px' }, `The game skips this request: ${probs.join('; ')}.`) : null].filter(Boolean));
  });
  const used = h('div', { class: 'foot' });
  live(() => {
    const u = app.draft.shiftsUsing(key);
    used.replaceChildren(h('span', { class: 'msg', style: 'color:var(--mid)' }, u.length ? `In the work-order pool of shift ${u.join(', ')}.` : 'Not in any work order yet: add it from a shift page.'),
      ...u.filter((x) => x !== shift).map((x) => h('a', { class: 'chip', href: `#shift/${x}` }, `Shift ${x}`)));
  });
  body.append(how, used);
  if (q.custom) {
    body.append(h('div', { class: 'foot', style: 'margin-top:12px' }, h('button', { class: 'btn danger', onclick: () => {
      const u = app.draft.shiftsUsing(key);
      dialog('DELETE THIS REQUEST?', [h('p', null, `${fill(app.draft.quest(key).text)} goes${u.length ? `, and comes out of shift ${u.join(', ')}` : ''}. ↶ brings it back.`)], [
        ['Delete', () => { closeDialog(); change(`del:${key}`, () => app.draft.removeQuest(key), { rerender: true }); toast('Deleted. ↶ undoes it.'); }, 'danger'],
        ['Keep', closeDialog],
      ]);
    } }, 'Delete this request')));
  }
  return body;
}

// The settings of one of William's own requests, by kind.
function kindSettings(key) {
  const q = app.draft.quest(key);
  const set = (f, v, rerender = false) => change(`q:${key}:${f}`, () => app.draft.setQuest(key, f, v), { rerender });
  const box = h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Check'), h('span', { class: 'where' }, KINDS[q.kind] ? KINDS[q.kind].name : q.kind)));
  box.append(...kindFields(q, set));
  return box;
}

// Fields for a kind's settings. q: the request; set(field, value, rerender).
function kindFields(q, set) {
  const out = [];
  if (q.kind === 'things' || q.kind === 'with') {
    out.push(thingsPicker(q.things || [], (list) => set('things', list, false)));
    const word = capsInput(h('input', { class: 't', type: 'text', value: q.word || '', placeholder: 'e.g. DOG (default: the things, joined with OR)', spellcheck: 'false' }), (v) => set('word', v));
    out.push(h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Its name in NOT FILED'), h('span', { class: 'where' }, q.kind === 'with' ? 'SUBJECT FOUND, NO … ' : 'NO … ON RECORD')), word));
    if (q.kind === 'things') {
      const min = h('input', { type: 'range', min: 0.2, max: 0.9, step: 0.05, value: q.min ?? 0.4 });
      const out2 = h('span', { class: 'msg' }, `${Math.round((q.min ?? 0.4) * 100)}%`);
      min.addEventListener('input', () => { out2.textContent = `${Math.round(Number(min.value) * 100)}%`; set('min', Number(min.value)); });
      out.push(h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'How sure INVENTORY must be'), h('span', { class: 'where' }, 'The built-in requests use 35-40%. Higher: fewer false hits, more misses.')), h('div', { class: 'row' }, min, out2)));
    }
  } else if (q.kind === 'people') {
    const n = h('input', { class: 't num', type: 'number', min: 1, max: 20, step: 1, value: q.n ?? 2 });
    n.addEventListener('input', () => { const v = Math.round(Number(n.value)); if (v >= 1 && v <= 20) set('n', v); });
    out.push(h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'At least this many people'), h('span', { class: 'where' }, 'Counted by INVENTORY, near or far.')), n));
  } else if (q.kind === 'colour') {
    const sel = h('select', { class: 't', style: 'width:auto' }, COLORS.map((c) => h('option', { value: c, selected: c === q.colour || null }, c)));
    sel.value = q.colour || 'red';
    sel.addEventListener('change', () => set('colour', sel.value));
    const need = h('input', { class: 't num', type: 'number', min: 1, max: 90, step: 1, value: Math.round((q.need ?? 0.08) * 100) });
    need.addEventListener('input', () => { const v = Number(need.value); if (v >= 1 && v <= 90) set('need', Math.round(v) / 100); });
    out.push(h('div', { class: 'field row' }, h('div', null, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Colour')), sel), h('div', null, h('div', { class: 'fl' }, h('span', { class: 'lab' }, '% of the brackets')), need, h('span', { class: 'msg', style: 'margin-left:8px;color:var(--mid)' }, 'built-in colours: 8%'))));
  } else if (q.kind === 'like') {
    const sel = h('select', { class: 't' }, BUILTIN_KEYS.filter((k) => !NOT_LIKE.has(k)).map((k) => h('option', { value: k }, `${DEFAULTS.quests[k].text} · ${modName(DEFAULTS.quests[k].mod)}`)));
    sel.value = q.base || 'smile';
    sel.addEventListener('change', () => set('base', sel.value, true));
    out.push(h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Judged exactly like'), h('span', { class: 'where' }, 'Same check, same NOT FILED reasons; your own wording and merit.')), sel));
  } else if (q.kind === 'word') {
    const sel = h('select', { class: 't' }, Object.entries(WORD_RULES).map(([k, v]) => h('option', { value: k }, v)));
    sel.value = q.rule || 'subject';
    sel.addEventListener('change', () => set('rule', sel.value, true));
    out.push(h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'What the photo needs'), h('span', { class: 'where' }, 'Shift 5 requests file on the Recorder\'s word; the unit only checks this much.')), sel));
  }
  return out;
}

// The 80 things the INVENTORY knows, as toggles.
function thingsPicker(selected, onChange) {
  const on = new Set(selected);
  const box = h('div', { class: 'things' });
  const find = h('input', { class: 't', type: 'search', placeholder: 'Find a thing (dog, umbrella, cell phone…)', style: 'text-transform:none;margin-bottom:6px' });
  const draw = () => {
    const f = find.value.trim().toLowerCase();
    box.replaceChildren(...THINGS.filter((x) => !f || x.includes(f) || on.has(x)).map((x) => {
      const cb = h('input', { type: 'checkbox', checked: on.has(x) });
      const l = h('label', { class: on.has(x) ? 'on' : '' }, cb, x);
      cb.addEventListener('change', () => { if (cb.checked) on.add(x); else on.delete(x); l.classList.toggle('on', cb.checked); onChange(THINGS.filter((y) => on.has(y))); });
      return l;
    }));
  };
  find.addEventListener('input', draw);
  draw();
  return h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Things the INVENTORY looks for'), h('span', { class: 'where' }, 'Any one of them counts. Its 80 kinds of thing, in its own words.')), find, box);
}

// A new request: pick a kind, word it, set it up.
function newQuest({ shift = null, onCreate = null } = {}) {
  const mods = shift ? DAYS[shift - 1].modules : MODULE_ORDER;
  const kindOk = (k) => {
    if (k === 'like') return BUILTIN_KEYS.some((b) => !NOT_LIKE.has(b) && mods.includes(DEFAULTS.quests[b].mod));
    return mods.includes(KINDS[k].mod);
  };
  const q = { kind: Object.keys(KINDS).find(kindOk) || 'colour', text: '', short: '', merit: 25, things: [], min: 0.4, word: '', n: 2, colour: 'purple', need: 0.08, base: 'smile', rule: 'subject', label: '', ask: '' };
  const firstBase = BUILTIN_KEYS.find((b) => !NOT_LIKE.has(b) && mods.includes(DEFAULTS.quests[b].mod));
  if (!mods.includes(DEFAULTS.quests[q.base].mod)) q.base = firstBase;
  const kinds = h('div', { class: 'kinds' });
  const settings = h('div');
  const errs = h('div', { class: 'msg bad', style: 'display:block;margin-top:8px' });
  const prev = h('canvas', { class: 'px' });
  const text = capsInput(h('input', { class: 't', type: 'text', placeholder: 'e.g. A DOG', spellcheck: 'false' }), (v) => { q.text = v; check(); });
  const short = capsInput(h('input', { class: 't', type: 'text', placeholder: 'optional: shorter, for the viewfinder', spellcheck: 'false' }), (v) => { q.short = v; check(); });
  const merit = h('input', { class: 't num', type: 'number', min: 0, max: 999, value: 25 });
  merit.addEventListener('input', () => { q.merit = Math.round(Number(merit.value)); check(); });
  const label = capsInput(h('input', { class: 't', type: 'text', placeholder: 'e.g. DANGEROUS', spellcheck: 'false' }), (v) => { q.label = v; if (!askTouched) { q.ask = v ? `OH, SO THAT'S ${v}?` : ''; ask.value = q.ask; } check(); });
  let askTouched = false;
  const ask = capsInput(h('input', { class: 't', type: 'text', placeholder: "OH, SO THAT'S …?", spellcheck: 'false' }), (v) => { askTouched = true; q.ask = v; check(); });
  const wordBox = h('div', null,
    h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Label'), h('span', { class: 'where' }, 'What the Recorder files them as, and what later look-alikes get called.')), label),
    h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Question'), h('span', { class: 'where' }, 'INTENT asks it the first time (YOU SURE?).')), ask));
  const candidate = () => {
    const c = { kind: q.kind, text: q.text, short: q.short || undefined, merit: q.merit };
    if (q.kind === 'things' || q.kind === 'with') { c.things = q.things; if (q.word) c.word = q.word; if (q.kind === 'things') c.min = q.min; }
    if (q.kind === 'people') c.n = q.n;
    if (q.kind === 'colour') { c.colour = q.colour; c.need = q.need; }
    if (q.kind === 'like') c.base = q.base;
    if (q.kind === 'word') { c.rule = q.rule; c.label = q.label; c.ask = q.ask || undefined; }
    return c;
  };
  const check = () => {
    const warn = [];
    const ok = checkQuest('q-new', candidate(), warn);
    errs.textContent = q.text || warn.length > 1 ? warn.map((w) => w.replace(/^quest [^:]+: /, '')).join('; ') : '';
    create.disabled = !ok;
    const r = lineCanvas(fill(q.text || ' '), { w: 200 }, prev); prev.style.width = `${r.canvas.width * 2}px`;
  };
  const drawSettings = () => {
    const set = (f, v, re) => { q[f] = v; if (re) drawSettings(); check(); };
    settings.replaceChildren(...kindFields(q, set), q.kind === 'word' ? wordBox : '');
    kinds.querySelectorAll('.kind').forEach((b) => b.classList.toggle('on', b.dataset.kind === q.kind));
  };
  const KIND_HELP = {
    things: 'A DOG, AN UMBRELLA, SOMETHING TO SIT ON: anything among the INVENTORY\'s 80 kinds.',
    with: 'SOMEONE WITH AN UMBRELLA: a person touching one of the things.',
    people: 'THREE PEOPLE, A QUEUE: a head count.',
    colour: 'SOMETHING PURPLE: a colour filling part of the brackets.',
    like: 'SOMEONE LAUGHING judged as SOMEONE SMILING, A WINDOW as A RECTANGLE…',
    word: 'SOMEONE DANGEROUS: the Recorder decides, like the shift 5 requests.',
  };
  for (const [k, kd] of Object.entries(KINDS)) {
    kinds.append(h('button', { class: 'kind', 'data-kind': k, disabled: !kindOk(k), title: kindOk(k) ? '' : `Needs ${modName(kd.mod)}${shift ? `, which shift ${shift} doesn't have` : ''}`, onclick: () => { q.kind = k; drawSettings(); check(); } },
      h('b', null, kd.name), h('span', null, KIND_HELP[k])));
  }
  const create = h('button', { class: 'btn primary', disabled: true, onclick: () => {
    const c = candidate();
    let key = null;
    change('new-quest', () => { key = app.draft.addQuest(c); });
    closeDialog();
    if (onCreate) onCreate(key);
    else goTo(`#requests/${key}`, `[data-quest="${key}"]`);
    toast(`Made ${fill(c.text)}.${onCreate ? ` It's in shift ${shift}'s work order.` : ' Add it to a shift from the shift\'s page.'}`);
  } }, 'Make it');
  dialog(shift ? `A NEW REQUEST FOR SHIFT ${shift}` : 'A NEW REQUEST', [
    h('p', { class: 'hint', style: 'margin-top:0' }, 'Each kind is a check the unit already has, with your own wording and merit.'),
    kinds,
    h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Wording'), h('span', { class: 'where' }, 'As the work order says it.')), text, h('div', { class: 'pxbox' }, prev)),
    h('div', { class: 'row' }, h('div', { class: 'grow field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Short wording')), short), h('div', { class: 'field' }, h('div', { class: 'fl' }, h('span', { class: 'lab' }, 'Merit')), merit)),
    settings, errs,
  ], [['Cancel', closeDialog]]);
  $('#dlg .df').prepend(create);
  drawSettings(); check();
  setTimeout(() => text.focus(), 30);
}

function questsPage(openKey) {
  const keys = app.draft.questKeys();
  const groups = [];
  for (const m of MODULE_ORDER) {
    const ks = keys.filter((k) => { const r = REQUESTS[k]; const mod = r ? r.mod : (app.draft.quest(k).kind && KINDS[app.draft.quest(k).kind] ? KINDS[app.draft.quest(k).kind].mod : null); return mod === m; });
    if (ks.length) groups.push(h('div', { class: 'modh' }, `${modName(m)} · ${MODULES[m].what}`), ...ks.map((k) => questCard(k, { open: k === openKey })));
  }
  const broken = keys.filter((k) => !REQUESTS[k] && app.draft.isCustom(k) && !MODULE_ORDER.includes((KINDS[app.draft.quest(k).kind] || {}).mod));
  if (broken.length) groups.push(h('div', { class: 'modh' }, 'NOT WORKING YET'), ...broken.map((k) => questCard(k, { open: true })));
  return h('div', null,
    h('div', { class: 'page-h' }, h('h1', null, 'EVERY REQUEST'), h('span', { class: 'sub' }, `${plural(keys.length, 'request')} · ${plural(app.draft.customKeys().length, 'new one')}`)),
    h('p', { class: 'lede' }, 'Everything the Office can ask for, by the module that judges it. Open one to change its wording, merit or (shift 5) question and label. New requests reuse a check the unit already has.'),
    h('div', { class: 'row', style: 'margin-bottom:14px' }, h('button', { class: 'btn primary', onclick: () => newQuest() }, '+ A new request')),
    groups);
}

// --- words ---------------------------------------------------------------------------------
function wordsPage(id) {
  const g = GROUPS.find((x) => x.id === id);
  const keys = Object.keys(g.lines).map((k) => `${g.id}.${k}`);
  const changed = keys.filter((k) => app.draft.lineChanged(k)).length;
  const tabs = GROUP_TABS[id] || [];
  return h('div', null,
    h('div', { class: 'page-h' }, h('h1', null, g.name.toUpperCase()), h('span', { class: 'sub' }, `${plural(keys.length, 'line')}${changed ? ` · ${changed} edited` : ''}`)),
    h('p', { class: 'lede' }, g.note || '', ' Placeholders like {SHIFT} are filled in by the game; click one under a line to insert it. Lines are in capitals, like everything on the unit.'),
    h('div', { class: tabs.length ? 'cols' : '' },
      h('div', null, h('div', { class: 'card' }, keys.map(lineField))),
      tabs.length ? h('div', { class: 'side' }, screenPanel(tabs, app.shift, { reroll: ['order', 'viewfinder', 'quota', 'report'].includes(tabs[0]), title: `ON THE UNIT · SHIFT ${app.shift}` })) : null));
}

// --- all changes ---------------------------------------------------------------------------
function changesPage() {
  const ch = app.draft.changes();
  const rows = ch.map((c) => {
    const go = c.where === 'shift' ? [`#shift/${c.id}`, c.field === 'pick' || c.field === 'quota' ? `[data-pool="${c.id}"]` : `[data-shift-field="${c.id}-${c.field}"]`]
      : c.where === 'quest' ? [`#requests/${c.id}`, `[data-quest="${c.id}"]`]
        : [`#words/${c.id.split('.')[0]}`, `[data-line="${c.id}"]`];
    const reset = () => change(`reset:${c.where}:${c.id}:${c.field}`, () => {
      if (c.where === 'shift') app.draft.resetShift(c.id, c.field);
      else if (c.where === 'quest') { if (app.draft.isCustom(c.id)) app.draft.removeQuest(c.id); else app.draft.resetQuest(c.id, c.field); }
      else app.draft.resetLine(c.id);
    }, { rerender: true });
    return h('div', { class: 'chg' },
      h('a', { href: go[0], onclick: (e) => { e.preventDefault(); goTo(go[0], go[1]); } }, c.label),
      h('button', { class: 'reset', onclick: reset }, c.where === 'quest' && app.draft.isCustom(c.id) ? 'delete' : '↺ original'),
      h('span'));
  });
  return h('div', null,
    h('div', { class: 'page-h' }, h('h1', null, 'ALL CHANGES'), h('span', { class: 'sub' }, `${plural(ch.length, 'edit')} to the game as written`)),
    h('p', { class: 'lede' }, `What ${app.file} holds once saved: only what differs from the game as written in src/game/. The game loads it when it starts.`),
    whereSaveGoes(),
    app.warnings.length ? h('div', { class: 'banner bad' }, h('div', { class: 'grow' }, h('b', null, 'The game would skip these:'), h('ul', { class: 'warnlist' }, app.warnings.map((w) => h('li', null, w))))) : null,
    h('div', { class: 'card' }, rows.length ? rows : h('p', { class: 'hint' }, 'No changes yet: this is the game as written.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: download }, 'Download edits.json'),
      dirty() ? h('button', { class: 'btn', onclick: () => change('discard', () => { app.draft = new Draft(JSON.parse(app.saved || '{"v":1}')); }, { rerender: true }) }, 'Drop unsaved changes') : null,
      ch.length ? h('button', { class: 'btn danger', onclick: () => dialog('BACK TO THE GAME AS WRITTEN?', [h('p', null, `All ${plural(ch.length, 'edit')} go (new requests too). Nothing changes on disk until you SAVE, and ↶ undoes it.`)], [['Clear them all', () => { closeDialog(); change('clear-all', () => { app.draft = new Draft({ v: CONTENT_VERSION }); }, { rerender: true }); }, 'danger'], ['Keep them', closeDialog]]) }, 'Back to the game as written…') : null),
    h('details', { style: 'margin-top:18px' }, h('summary', { style: 'cursor:pointer;color:var(--mid)' }, `${app.file} as it will be saved`), h('pre', { style: 'font:12px/1.45 var(--mono);background:var(--card);border:1px solid var(--rule);border-radius:6px;padding:12px;overflow:auto;max-height:420px' }, app.draft.text())));
}

// Where SAVE goes, and signing in or out (on the public site).
function whereSaveGoes() {
  if (app.mode === 'github') {
    const signed = !!gh.token.get();
    return h('div', { class: 'card' },
      h('h2', null, 'WHERE SAVE GOES'),
      h('p', { class: 'hint', style: 'margin:4px 0 10px' }, 'Each SAVE is a commit to ', h('a', { href: `${gh.REPO_URL}/blob/${gh.REPO.branch}/${gh.REPO.path}`, target: '_blank', rel: 'noopener' }, gh.REPO_LABEL),
        ' on GitHub, and GitHub Pages rebuilds the game from it in about a minute. Every version is in ', h('a', { href: `${gh.REPO_URL}/commits/${gh.REPO.branch}/${gh.REPO.path}`, target: '_blank', rel: 'noopener' }, 'its history'), '.'),
      h('div', { class: 'row', style: 'align-items:center' },
        h('span', { class: 'msg', style: 'color:var(--ink2)' }, signed ? `Signed in on this device${gh.token.kept() ? '' : ' (this tab only)'}.` : 'Not signed in on this device.'),
        signed ? h('button', { class: 'btn', onclick: signOut }, 'Sign out') : h('button', { class: 'btn primary', onclick: () => signIn() }, 'Sign in to save')));
  }
  return h('div', { class: 'card' },
    h('h2', null, 'WHERE SAVE GOES'),
    h('p', { class: 'hint', style: 'margin:4px 0 0' }, `${app.file} on this computer (the last 30 versions are kept in content/backups/). The public game gets it with the next publish; the online controller at thewilliamyao.github.io/clearance/editor/ saves straight to the public game.`));
}

// --- find ----------------------------------------------------------------------------------
function searchPage(q) {
  const Q = String(q || '').toUpperCase();
  const hit = (s) => String(s || '').toUpperCase().includes(Q);
  const mark = (s) => {
    const str = String(s || ''), i = str.toUpperCase().indexOf(Q);
    if (i < 0 || !Q) return str.slice(0, 160);
    const a = Math.max(0, i - 50);
    return [a ? '…' : '', str.slice(a, i), h('mark', null, str.slice(i, i + Q.length)), str.slice(i + Q.length, i + Q.length + 90)];
  };
  const res = [];
  for (let n = 1; n <= LAST_DAY; n++) {
    const s = app.draft.shift(n);
    for (const f of ['code', 'memo', 'issueNote']) if (hit(s[f])) res.push([`#shift/${n}`, `[data-shift-field="${n}-${f}"]`, `Shift ${n} · ${FIELD_NAMES[f]}`, s[f]]);
  }
  for (const k of app.draft.questKeys()) {
    const qq = app.draft.quest(k);
    for (const f of ['text', 'short', 'ask', 'label']) if (hit(qq[f])) res.push([`#requests/${k}`, `[data-quest="${k}"]`, `Request · ${FIELD_NAMES[f]}`, qq[f]]);
  }
  for (const k of Object.keys(LINES)) if (hit(app.draft.line(k)) || hit(LINES[k].where)) res.push([`#words/${k.split('.')[0]}`, `[data-line="${k}"]`, `${groupName(k)} · ${LINES[k].where}`, app.draft.line(k)]);
  return h('div', null,
    h('div', { class: 'page-h' }, h('h1', null, 'FIND'), h('span', { class: 'sub' }, `${plural(res.length, 'place')} with “${q}”`)),
    h('div', { style: 'margin-top:14px' }, res.map(([href, sel, where, text]) => h('a', { class: 'res', href, onclick: (e) => { e.preventDefault(); goTo(href, sel); } }, h('div', { class: 'w' }, mark(text)), h('div', { class: 'h' }, where)))));
}

boot();
