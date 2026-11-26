// Clearance: the shared index. A Cloudflare Worker with a D1 database that keeps what
// Recorders filed on shift 5 (SAD, ALONE, DOES NOT BELONG, ...), pooled from every unit
// whose Recorder turned on Settings ▸ SHARE WITH THE INDEX.
//
// Each entry is a 40x30 two-tone print (the game's lowest grade, SENSOR I / TONE I, made on
// the phone), its label and the day it arrived. Nothing else is accepted or stored: no
// photo, no sharper print, no embedding, no location, nothing that identifies the unit.
// Addresses are only used, as a salted hash that lives for an hour, to limit uploads.
//
//   POST   /api/entries               {"label": "sadness", "bits": "<base64, 150 bytes>"}
//                                     → 201 {id, key, day, status}; key withdraws it later
//   GET    /api/index?per=N           every label's count and its newest N prints (N ≤ 200)
//   GET    /api/entries?label=K&before=ID&limit=N   older prints of one label
//   DELETE /api/entries/ID            X-Delete-Key: <key> (the sender), or the admin token
//   POST   /api/entries/ID/approve    admin, when HOLD_NEW is on
//   GET    /api/admin/entries?status=held|live|all&before=ID&limit=N   admin
//
// Admin requests carry "Authorization: Bearer <ADMIN_TOKEN>" (a Worker secret).
// Settings (wrangler.toml [vars]): ALLOWED_ORIGINS, ALLOW_TUNNELS, HOLD_NEW, UPLOADS_PER_HOUR,
// UPLOADS_PER_DAY.

import { LABELS, MAX_BODY, parseSubmission, originAllowed } from './rules.js';

const MAX_PER = 200;

const today = (now) => new Date(now).toISOString().slice(0, 10);
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); }
async function hmac(secret, s) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(s)));
}
function randomKey() { const b = new Uint8Array(16); crypto.getRandomValues(b); return hex(b); }
async function sameSecret(a, b) {
  // Compare digests so the comparison takes the same time whatever the input.
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

// --- responses -------------------------------------------------------------------------------
function cors(request, env, write) {
  const origin = request.headers.get('Origin');
  if (!write) return { 'Access-Control-Allow-Origin': '*' };
  return origin && originAllowed(origin, env) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}
function json(request, env, body, status = 200, { write = false, cache = 0 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache ? `public, max-age=${cache}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...cors(request, env, write),
    },
  });
}
const fail = (request, env, status, error, write = true) => json(request, env, { error }, status, { write });

async function isAdmin(request, env) {
  const m = /^Bearer (.+)$/.exec(request.headers.get('Authorization') || '');
  return !!(m && env.ADMIN_TOKEN && (await sameSecret(m[1], env.ADMIN_TOKEN)));
}

const row = (r) => ({ id: r.id, label: r.label, day: r.day, bits: r.bits, ...(r.status ? { status: r.status } : {}) });
const int = (v, d, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

// --- routes ----------------------------------------------------------------------------------
async function submit(request, env, now) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return fail(request, env, 413, 'body too large');
  const text = await request.text();
  const sub = parseSubmission(text);
  if (sub.error) return fail(request, env, sub.status, sub.error);

  // Rate limit: per address per hour, then one cap for the whole index per day.
  const t = Math.floor(now / 1000), hour = Math.floor(t / 3600), day = today(now);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipKey = 'ip:' + (await hmac((env.ADMIN_TOKEN || 'clearance') + ':rate', `${ip}:${hour}`));
  const perHour = int(env.UPLOADS_PER_HOUR, 30, 1, 1e6), perDay = int(env.UPLOADS_PER_DAY, 1000, 1, 1e7);
  const [, ipRes] = await env.DB.batch([
    env.DB.prepare('DELETE FROM rate WHERE until < ?1').bind(t),
    env.DB.prepare('INSERT INTO rate (k, n, until) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n').bind(ipKey, (hour + 1) * 3600),
  ]);
  if (ipRes.results[0].n > perHour) return fail(request, env, 429, 'too many uploads from here this hour');
  const dayRes = await env.DB.prepare('INSERT INTO rate (k, n, until) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n')
    .bind('day:' + day, Math.floor(Date.parse(day + 'T00:00:00Z') / 1000) + 2 * 86400).first();
  if (dayRes.n > perDay) return fail(request, env, 503, 'the index is closed for today');

  const key = randomKey();
  const status = env.HOLD_NEW === '1' ? 'held' : 'live';
  const ins = await env.DB.prepare('INSERT INTO entries (label, bits, day, status, key_hash) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id')
    .bind(sub.label, sub.bits, day, status, await sha256(key)).first();
  return json(request, env, { id: ins.id, key, day, status }, 201, { write: true });
}

async function index(request, env, url) {
  const per = int(url.searchParams.get('per'), 42, 0, MAX_PER);
  const counts = await env.DB.prepare("SELECT label, COUNT(*) AS n FROM entries WHERE status = 'live' GROUP BY label").all();
  const n = Object.fromEntries(counts.results.map((r) => [r.label, r.n]));
  let newest = LABELS.map(() => ({ results: [] }));
  if (per > 0) {
    newest = await env.DB.batch(LABELS.map((l) => env.DB.prepare("SELECT id, label, day, bits FROM entries WHERE status = 'live' AND label = ?1 ORDER BY id DESC LIMIT ?2").bind(l, per)));
  }
  const labels = LABELS.map((l, i) => ({ label: l, n: n[l] || 0, entries: newest[i].results.map(row) }));
  return json(request, env, { labels, total: labels.reduce((a, l) => a + l.n, 0) }, 200, { cache: 20 });
}

async function older(request, env, url) {
  const label = url.searchParams.get('label');
  if (!LABELS.includes(label)) return fail(request, env, 400, 'unknown label', false);
  const before = int(url.searchParams.get('before'), Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  const limit = int(url.searchParams.get('limit'), 42, 1, MAX_PER);
  const r = await env.DB.prepare("SELECT id, label, day, bits FROM entries WHERE status = 'live' AND label = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3")
    .bind(label, before, limit + 1).all();
  const rows = r.results.slice(0, limit).map(row);
  return json(request, env, { entries: rows, more: r.results.length > limit }, 200, { cache: 20 });
}

async function remove(request, env, id) {
  if (await isAdmin(request, env)) {
    const r = await env.DB.prepare('DELETE FROM entries WHERE id = ?1').bind(id).run();
    return r.meta.changes ? json(request, env, { deleted: id }, 200, { write: true }) : fail(request, env, 404, 'no such entry');
  }
  const key = request.headers.get('X-Delete-Key') || '';
  if (!/^[0-9a-f]{32}$/.test(key)) return fail(request, env, 403, 'a delete key or the admin token is needed');
  const r = await env.DB.prepare('DELETE FROM entries WHERE id = ?1 AND key_hash = ?2').bind(id, await sha256(key)).run();
  return r.meta.changes ? json(request, env, { deleted: id }, 200, { write: true }) : fail(request, env, 404, 'no such entry for this key');
}

async function approve(request, env, id) {
  if (!(await isAdmin(request, env))) return fail(request, env, 403, 'admin only');
  const r = await env.DB.prepare("UPDATE entries SET status = 'live' WHERE id = ?1").bind(id).run();
  return r.meta.changes ? json(request, env, { approved: id }, 200, { write: true }) : fail(request, env, 404, 'no such entry');
}

async function adminList(request, env, url) {
  if (!(await isAdmin(request, env))) return fail(request, env, 403, 'admin only');
  const status = url.searchParams.get('status') || 'all';
  if (!['held', 'live', 'all'].includes(status)) return fail(request, env, 400, 'status is held, live or all');
  const before = int(url.searchParams.get('before'), Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER);
  const limit = int(url.searchParams.get('limit'), 100, 1, 500);
  const r = await env.DB.prepare(`SELECT id, label, day, bits, status FROM entries WHERE id < ?1 ${status === 'all' ? '' : 'AND status = ?3'} ORDER BY id DESC LIMIT ?2`)
    .bind(...(status === 'all' ? [before, limit] : [before, limit, status])).all();
  return json(request, env, { entries: r.results.map(row) }, 200, { write: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const m = request.method;
    const write = m !== 'GET' && m !== 'HEAD';
    try {
      // Browsers ask before a POST or DELETE with these headers; only the game's own pages may.
      if (m === 'OPTIONS') {
        const origin = request.headers.get('Origin');
        if (!origin || !originAllowed(origin, env)) return new Response(null, { status: 403 });
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin, Vary: 'Origin',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Delete-Key',
            'Access-Control-Max-Age': '86400',
          },
        });
      }
      if (write && !originAllowed(request.headers.get('Origin'), env)) return fail(request, env, 403, 'this page may not write to the index', false);

      if (path === '/') return new Response('Clearance: the shared index. The page: https://thewilliamyao.github.io/clearance/index/\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      if (path === '/api/index' && m === 'GET') return await index(request, env, url);
      if (path === '/api/entries' && m === 'GET') return await older(request, env, url);
      if (path === '/api/entries' && m === 'POST') return await submit(request, env, Date.now());
      if (path === '/api/admin/entries' && m === 'GET') return await adminList(request, env, url);
      let r = /^\/api\/entries\/(\d{1,12})$/.exec(path);
      if (r && m === 'DELETE') return await remove(request, env, Number(r[1]));
      r = /^\/api\/entries\/(\d{1,12})\/approve$/.exec(path);
      if (r && m === 'POST') return await approve(request, env, Number(r[1]));
      return fail(request, env, 404, 'not found', write);
    } catch (e) {
      console.error('index error', e && e.message);
      return fail(request, env, 500, 'the index failed', write);
    }
  },
};
