// Saving through GitHub, for the controller on the public site (editor/ on GitHub Pages): it
// reads and writes the game's content/edits.json in the public repo with William's token (a
// fine-grained token for that one repository, Contents: read and write). Each SAVE is a commit,
// and GitHub Pages rebuilds the game from it in about a minute. The token stays in this
// browser (localStorage, or sessionStorage when he doesn't want it kept) and only ever goes to
// api.github.com.
import { CONTROLLER_REPO } from '../src/config.js';

export const REPO = CONTROLLER_REPO;
export const REPO_LABEL = `${REPO.owner}/${REPO.repo} · ${REPO.path}`;
export const REPO_URL = `https://github.com/${REPO.owner}/${REPO.repo}`;
export const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.path.split('/').map(encodeURIComponent).join('/')}`;

const TOKEN_KEY = 'clearance.controller.github';
export const token = {
  get() { try { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
  kept() { try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; } },
  set(t, keep) {
    try {
      (keep ? localStorage : sessionStorage).setItem(TOKEN_KEY, t);
      (keep ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
    } catch { /* private mode: this tab only */ }
  },
  clear() { try { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch { /* fine */ } },
};

const headers = (t) => ({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(t ? { Authorization: `Bearer ${t}` } : {}) });

// UTF-8 text <-> base64 (the edits hold ●, ·, × and the like).
export function toB64(text) {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const s = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function failure(res) {
  let msg = '';
  try { msg = (await res.json()).message || ''; } catch { /* no body */ }
  const limited = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0';
  if (limited) return new GitHubError(429, 'GitHub\'s hourly limit for this connection is used up; try again later (signing in raises it)');
  if (res.status === 401) return new GitHubError(401, 'GitHub refused the token: it may have expired or been mistyped');
  if (res.status === 403) return new GitHubError(403, `the token can't write to ${REPO.owner}/${REPO.repo}: it needs Contents: Read and write on that repository${msg ? ` (GitHub: ${msg})` : ''}`);
  if (res.status === 404) return new GitHubError(404, `the token can't see ${REPO.owner}/${REPO.repo}: give it access to that repository`);
  if (res.status === 409 || res.status === 422) return new GitHubError(409, msg || 'the file changed since it was loaded');
  return new GitHubError(res.status, msg || `GitHub answered ${res.status}`);
}

// The edits as they are in the repo now: { content, sha, broken }. No file yet: no edits.
export async function load(t = token.get()) {
  const res = await fetch(`${API}?ref=${encodeURIComponent(REPO.branch)}`, { headers: headers(t), cache: 'no-store' });
  if (res.status === 404 && !t) return { content: { v: 1 }, sha: null, broken: null };
  if (res.status === 404) {
    // With a token, 404 is either no file yet or no access: ask without the token.
    const anon = await fetch(`${API}?ref=${encodeURIComponent(REPO.branch)}`, { headers: headers(''), cache: 'no-store' });
    if (anon.status === 404) return { content: { v: 1 }, sha: null, broken: null };
    throw await failure(res);
  }
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  const text = fromB64(j.content || '');
  try { return { content: JSON.parse(text), sha: j.sha, broken: null }; } catch { return { content: { v: 1 }, sha: j.sha, broken: text.slice(0, 4000) }; }
}

// Commit new edits. base: the sha they were loaded at; GitHub refuses a stale one (409).
export async function save(content, base, message, t = token.get()) {
  const body = { message, content: toB64(JSON.stringify(content, null, 2) + '\n'), branch: REPO.branch };
  if (base) body.sha = base;
  const res = await fetch(API, { method: 'PUT', headers: { ...headers(t), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await failure(res);
  const j = await res.json();
  return { sha: j.content && j.content.sha, commit: j.commit && j.commit.html_url };
}

// Is the token good for this repo? (Reading proves access; writing is checked on SAVE.)
export async function check(t) {
  const res = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`, { headers: headers(t), cache: 'no-store' });
  if (!res.ok) throw await failure(res);
  return true;
}
