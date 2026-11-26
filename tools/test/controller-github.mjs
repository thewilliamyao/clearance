// The online controller (editor/ on GitHub Pages) in headless Chrome, against a stand-in for
// GitHub's API: read-only until signed in, a bad token refused, SAVE as a commit with the
// file's sha and a message saying what changed, the "live in the game" check once Pages has
// rebuilt, a clash with a save from another device, a revoked token, signing out, TRY.
// Serves the game folder with a plain static server, the way GitHub Pages does (no
// /editor/api), so the controller runs in its GitHub mode. No real GitHub calls.
//   cd tools && node test/controller-github.mjs
//   BASE=https://thewilliamyao.github.io/clearance node test/controller-github.mjs   (the live copy)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => resolve(p)); }); });
// BASE=https://thewilliamyao.github.io/clearance checks the published copy (GitHub's API is
// still the stand-in: nothing is committed).
const PORT = process.env.BASE ? 0 : await freePort();
const BASE = process.env.BASE ? process.env.BASE.replace(/\/+$/, '') : `http://127.0.0.1:${PORT}`;
const server = process.env.BASE ? null : spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', APP], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/index.html')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message.split('\n').slice(0, 6).join('\n        ')); }
};

// The repo as GitHub would have it, and the copy GitHub Pages serves (it catches up a moment
// after each commit, like a Pages rebuild).
const TOKEN = 'github_pat_test_good';
const repo = { text: '{\n  "v": 1\n}\n', sha: 'sha-1', n: 1, puts: [], token: TOKEN };
const pages = { text: repo.text };
const json = (status, body) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, PUT, OPTIONS' }, body: JSON.stringify(body) });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route('https://api.github.com/**', async (route) => {
  const req = route.request(), url = new URL(req.url()), auth = req.headers().authorization || '';
  if (req.method() === 'OPTIONS') return route.fulfill(json(204, {}));
  if (url.pathname === '/repos/thewilliamyao/clearance') {
    return route.fulfill(auth === `Bearer ${repo.token}` ? json(200, { full_name: 'thewilliamyao/clearance' }) : json(401, { message: 'Bad credentials' }));
  }
  if (url.pathname === '/repos/thewilliamyao/clearance/contents/content/edits.json') {
    if (req.method() === 'GET') return route.fulfill(json(200, { sha: repo.sha, encoding: 'base64', content: Buffer.from(repo.text).toString('base64').replace(/(.{60})/g, '$1\n') }));
    if (req.method() === 'PUT') {
      if (auth !== `Bearer ${repo.token}`) return route.fulfill(json(401, { message: 'Bad credentials' }));
      const body = JSON.parse(req.postData());
      repo.puts.push({ ...body, auth });
      if (body.sha !== repo.sha) return route.fulfill(json(409, { message: `content/edits.json does not match ${body.sha}` }));
      repo.text = Buffer.from(body.content, 'base64').toString('utf8');
      repo.sha = `sha-${++repo.n}`;
      const now = repo.text;
      setTimeout(() => { pages.text = now; }, 1500); // Pages rebuilds
      return route.fulfill(json(200, { content: { sha: repo.sha }, commit: { html_url: 'https://github.com/thewilliamyao/clearance/commit/abc' } }));
    }
  }
  return route.fulfill(json(404, { message: 'Not Found' }));
});
await ctx.route(`${BASE}/content/edits.json*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: pages.text }));

const errors = [];
const expected = /Failed to load resource: the server responded with a status of (401|404|409)/;
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !expected.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); }); });
const page = await ctx.newPage();
const typeInto = async (sel, text) => { await page.fill(sel, ''); await page.type(sel, text, { delay: 2 }); };

console.log('controller on GitHub Pages');
await page.goto(`${BASE}/editor/#shift/1`);
await page.waitForSelector('#shift-1-memo');

await test('opens read-only, offering to sign in', async () => {
  assert.equal(await page.textContent('#save'), 'SIGN IN');
  assert.match(await page.textContent('#status'), /thewilliamyao\/clearance · content\/edits\.json · read-only until you sign in/);
  assert.match(await page.textContent('.banner'), /This is the online controller/);
});

await test('editing works before signing in; SAVE asks for the token', async () => {
  await typeInto('#shift-1-memo', 'welcome, {recorder}. photograph everything.');
  await page.waitForTimeout(120);
  assert.match(await page.textContent('#status'), /not saved yet/);
  await page.click('#save');
  await page.waitForSelector('dialog[open] >> text=SIGN IN TO SAVE');
  assert.ok(await page.$('dialog[open] a[href="https://github.com/settings/personal-access-tokens/new"]'), 'links to GitHub\'s token page');
});

await test('a bad token is refused, a good one signs in', async () => {
  await page.fill('#tok', 'github_pat_wrong');
  await page.click('dialog[open] .btn.primary');
  await page.waitForSelector('dialog[open] >> text=GitHub refused the token');
  await page.fill('#tok', TOKEN);
  await page.click('dialog[open] .btn.primary');
  await page.waitForTimeout(250);
  assert.equal(await page.$('dialog[open]'), null);
  assert.equal(await page.textContent('#save'), 'SAVE');
  assert.equal(await page.evaluate(() => localStorage.getItem('clearance.controller.github')), TOKEN, 'kept on this device');
  assert.equal(await page.$('.banner'), null, 'the sign-in note is gone');
});

await test('SAVE commits the edits with the file\'s sha and says what changed', async () => {
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => /rebuilding/.test(document.querySelector('#status').textContent));
  const put = repo.puts.at(-1);
  assert.equal(put.auth, `Bearer ${TOKEN}`);
  assert.equal(put.sha, 'sha-1');
  assert.equal(put.branch, 'main');
  assert.match(put.message, /^Controller: Shift 1 · memo$/);
  const c = JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
  assert.deepEqual(c, { v: 1, shifts: { 1: { memo: 'WELCOME, {RECORDER}. PHOTOGRAPH EVERYTHING.' } } });
});

await test('it says when the game has the edits (Pages rebuilt)', async () => {
  await page.waitForFunction(() => /live in the game/.test(document.querySelector('#status').textContent), null, { timeout: 30000 });
});

await test('a save from another device in between: asks, can load it or overwrite', async () => {
  // Another device saved a line edit since this page loaded the file.
  repo.text = JSON.stringify({ v: 1, shifts: { 1: { memo: 'WELCOME, {RECORDER}. PHOTOGRAPH EVERYTHING.' } }, lines: { 'title.subtitle': 'FROM THE OTHER PHONE' } }, null, 2);
  repo.sha = 'sha-other';
  await page.evaluate(() => { location.hash = '#words/order'; });
  const sel = '[data-line="order.accept"] input';
  await page.waitForSelector(sel);
  await typeInto(sel, '● sign here');
  await page.waitForTimeout(120);
  await page.click('#save');
  await page.waitForSelector('dialog[open] >> text=THE FILE CHANGED ON GITHUB');
  await page.click('dialog[open] >> text=Load the file');
  await page.waitForTimeout(150);
  await page.evaluate(() => { location.hash = '#words/title'; });
  await page.waitForSelector('[data-line="title.subtitle"] input');
  assert.equal(await page.inputValue('[data-line="title.subtitle"] input'), 'FROM THE OTHER PHONE');
  await page.click('#undo'); // mine back
  await page.waitForTimeout(150);
  await page.click('#save');
  await page.waitForFunction(() => /rebuilding|live/.test(document.querySelector('#status').textContent));
  const put = repo.puts.at(-1);
  assert.equal(put.sha, 'sha-other', 'saved over the other device\'s version, knowingly');
  const c = JSON.parse(Buffer.from(put.content, 'base64').toString('utf8'));
  assert.equal(c.lines['order.accept'], '● SIGN HERE');
});

await test('a revoked token: asks to sign in again', async () => {
  repo.token = 'github_pat_new';
  await typeInto('[data-line="title.subtitle"] input', 'A FIELD UNIT OF THE OFFICE');
  await page.waitForTimeout(120);
  await page.click('#save');
  await page.waitForSelector('dialog[open] >> text=Not saved: GitHub refused the token');
  assert.equal(await page.evaluate(() => localStorage.getItem('clearance.controller.github')), null, 'the bad token is forgotten');
  await page.fill('#tok', 'github_pat_new');
  await page.click('dialog[open] input[type=checkbox]'); // this tab only
  await page.click('dialog[open] .btn.primary');
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('clearance.controller.github')), 'github_pat_new');
  assert.equal(await page.evaluate(() => localStorage.getItem('clearance.controller.github')), null);
  await page.click('#save');
  await page.waitForFunction(() => /rebuilding|live/.test(document.querySelector('#status').textContent));
});

await test('TRY works on the public site (same origin as the game)', async () => {
  await page.evaluate(() => { location.hash = '#shift/2'; });
  await page.waitForSelector('#shift-2-code');
  const [tryPage] = await Promise.all([ctx.waitForEvent('page'), page.click('text=▶ Try shift 2 with these changes')]);
  await tryPage.waitForFunction(() => window.__clearance && window.__clearance.game);
  assert.equal(await tryPage.evaluate(() => window.__clearance.game.day), 2);
  await tryPage.close();
});

await test('signing out on the changes page', async () => {
  await page.evaluate(() => { location.hash = '#changes'; });
  await page.waitForSelector('text=WHERE SAVE GOES');
  assert.match(await page.textContent('main'), /Signed in on this device \(this tab only\)/);
  await page.click('main >> text=Sign out');
  await page.waitForTimeout(150);
  assert.equal(await page.textContent('#save'), 'SIGN IN');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('clearance.controller.github')), null);
});

await test('no errors', async () => assert.deepEqual(errors, []));

await browser.close();
if (server) server.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
