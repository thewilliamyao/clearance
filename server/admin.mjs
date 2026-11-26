#!/usr/bin/env node
// William's tools for the shared index (the Worker in this folder).
//
//   node admin.mjs list [--held] [--limit N] [--prints]   newest first; --prints draws each one
//   node admin.mjs show <id>...                            draw prints in the terminal
//   node admin.mjs delete <id>...                          take prints down for everyone
//   node admin.mjs approve <id>...                         when HOLD_NEW is on
//   node admin.mjs token                                   copy the admin key (for index/?admin)
//   node admin.mjs new-token                               make a key and keep it in the Keychain
//
// The admin key lives in the macOS Keychain (service "clearance-index", account "admin"), or in
// CLEARANCE_INDEX_ADMIN. The index is the one in ../src/config.js, or INDEX=<url>.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const KEYCHAIN = ['-s', 'clearance-index', '-a', 'admin'];
const [cmd, ...rest] = process.argv.slice(2);

function indexUrl() {
  if (process.env.INDEX) return process.env.INDEX.replace(/\/+$/, '');
  const m = /INDEX_API = '([^']*)'/.exec(readFileSync(new URL('../src/config.js', import.meta.url), 'utf8'));
  return (m && m[1]) || 'http://localhost:8787';
}
function token() {
  if (process.env.CLEARANCE_INDEX_ADMIN) return process.env.CLEARANCE_INDEX_ADMIN;
  try { return execFileSync('security', ['find-generic-password', ...KEYCHAIN, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { if (indexUrl().includes('localhost')) return 'dev-admin'; throw new Error('No admin key: run `node admin.mjs new-token`, or set CLEARANCE_INDEX_ADMIN.'); }
}
async function call(path, opts = {}) {
  const res = await fetch(indexUrl() + path, { ...opts, headers: { Authorization: `Bearer ${token()}`, ...(opts.headers || {}) } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${j.error || ''}`.trim());
  return j;
}

// 40x30 in 15 terminal rows: each character is two pixels, top and bottom (█ paper, space ink).
function draw(bits) {
  const b = Buffer.from(bits, 'base64'), px = (x, y) => (b[(y * 40 + x) >> 3] >> (7 - ((y * 40 + x) & 7))) & 1;
  const rows = [];
  for (let y = 0; y < 30; y += 2) {
    let s = '';
    for (let x = 0; x < 40; x++) s += [' ', '▄', '▀', '█'][px(x, y) * 2 + px(x, y + 1)];
    rows.push('  │' + s + '│');
  }
  return ['  ┌' + '─'.repeat(40) + '┐', ...rows, '  └' + '─'.repeat(40) + '┘'].join('\n');
}
const line = (e) => `${String(e.id).padStart(5)}  ${e.day}  ${e.status.padEnd(4)}  ${e.label}`;

const ids = rest.filter((a) => /^\d+$/.test(a)).map(Number);
const flag = (f) => rest.includes(f);
const opt = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };

try {
  if (cmd === 'list') {
    const j = await call(`/api/admin/entries?status=${flag('--held') ? 'held' : 'all'}&limit=${opt('--limit', 50)}`);
    console.log(`${indexUrl()}: ${j.entries.length} shown, newest first`);
    for (const e of j.entries) { console.log(line(e)); if (flag('--prints')) console.log(draw(e.bits)); }
  } else if (cmd === 'show') {
    const j = await call('/api/admin/entries?status=all&limit=500');
    for (const id of ids) { const e = j.entries.find((x) => x.id === id); console.log(e ? `${line(e)}\n${draw(e.bits)}` : `${id}: not among the newest 500`); }
  } else if (cmd === 'delete') {
    if (!ids.length) throw new Error('Which prints? node admin.mjs delete 12 13');
    for (const id of ids) { await call(`/api/entries/${id}`, { method: 'DELETE' }); console.log(`deleted ${id}`); }
  } else if (cmd === 'approve') {
    for (const id of ids) { await call(`/api/entries/${id}/approve`, { method: 'POST' }); console.log(`approved ${id}`); }
  } else if (cmd === 'token') {
    execFileSync('pbcopy', { input: token() });
    console.log('The admin key is on the clipboard: paste it on the page (index/?admin).');
  } else if (cmd === 'new-token') {
    const t = randomBytes(24).toString('base64url');
    execFileSync('security', ['add-generic-password', '-U', ...KEYCHAIN, '-w', t]);
    console.log('A new admin key is in the Keychain (service clearance-index). Give it to the Worker with:');
    console.log('  security find-generic-password -s clearance-index -a admin -w | npx wrangler secret put ADMIN_TOKEN');
  } else {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
