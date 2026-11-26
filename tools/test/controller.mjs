// The controller (editor/) end to end in headless Chrome: edit a memo, make a new request
// and put it in a work order, edit a line, save, reload, play it in the game, TRY a shift with
// unsaved changes in a test save, a save that clashes with the file on disk, read-only mode,
// a phone-width window, and the save endpoint's guards. Starts its own serve.py with a copy
// of the edits, so content/edits.json is never touched.
//   cd tools && node test/controller.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/controller/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const PORT = 8000 + Math.floor(Math.random() * 900) + 50;
const BASE = `http://localhost:${PORT}`;
const TMP = mkdtempSync(path.join(tmpdir(), 'clearance-ctl-'));
const FILE = path.join(TMP, 'edits.json');
writeFileSync(FILE, '{\n  "v": 1\n}\n');

const server = spawn('python3', [path.join(APP, 'serve.py'), '--port', String(PORT), '--content', FILE], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('serve.py did not start')), 8000);
  server.stdout.on('data', (d) => { if (String(d).includes('Controller on')) { clearTimeout(t); resolve(); } });
});

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message.split('\n').slice(0, 6).join('\n        ')); }
};
const read = () => JSON.parse(readFileSync(FILE, 'utf8'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
// Chrome logs the answers the tests ask for (a 409 clash, a 404 read-only) as failed loads.
const expected = /Failed to load resource: (the server responded with a status of (409|404)|net::ERR_FAILED)/;
ctx.on('page', (p) => { p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !expected.test(m.text())) errors.push(`${p.url()}: ${m.text()}`); }); });
const page = await ctx.newPage();
const canvasData = (sel) => page.$eval(sel, (c) => c.toDataURL());
const typeInto = async (sel, text) => { await page.fill(sel, ''); await page.type(sel, text, { delay: 2 }); };

console.log('controller');
await page.goto(`${BASE}/editor/#shift/3`);
await page.waitForSelector('#shift-3-memo');

await test('opens on a shift with its work order drawn by the game\'s own code', async () => {
  assert.match(await page.textContent('h1'), /SHIFT 3 · CENSUS/);
  assert.match(await page.textContent('#status'), /saved/);
  const px = await page.$eval('.screen canvas', (c) => { const d = c.getContext('2d').getImageData(0, 0, 320, 240).data; let ink = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80) ink++; return ink; });
  assert.ok(px > 5000, `the preview is drawn (${px} dark pixels)`);
});

await test('editing a memo changes the preview and marks it unsaved', async () => {
  const before = await canvasData('.screen canvas');
  await typeInto('#shift-3-memo', 'count everyone. {recorder}, nobody is exempt.');
  await page.waitForTimeout(150);
  assert.equal(await page.inputValue('#shift-3-memo'), 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.', 'typed in capitals');
  assert.notEqual(await canvasData('.screen canvas'), before);
  assert.match(await page.textContent('#status'), /not saved yet/);
  assert.match(await page.textContent('[data-shift-field="3-memo"] .msg'), /lines · room for/);
});

await test('a memo too long for the paper is flagged', async () => {
  await typeInto('#shift-3-memo', 'WORD '.repeat(140));
  await page.waitForTimeout(150);
  assert.match(await page.textContent('[data-shift-field="3-memo"] .msg'), /runs \d+ px into ● ACCEPT ORDER/);
  await typeInto('#shift-3-memo', 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.');
});

await test('undo and redo', async () => {
  await page.click('body'); // out of the text box: ⌘Z is the controller's
  await page.click('#undo');
  await page.waitForTimeout(100);
  const after = await page.inputValue('#shift-3-memo');
  assert.notEqual(after, 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.');
  await page.click('#redo');
  await page.waitForTimeout(100);
  assert.equal(await page.inputValue('#shift-3-memo'), 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.');
});

await test('a new request, made from shift 2\'s work order and added to it', async () => {
  await page.evaluate(() => { location.hash = '#shift/2'; });
  await page.waitForSelector('[data-pool="2"]');
  await page.click('[data-pool="2"] >> text=+ Add a slot');
  await page.waitForSelector('dialog[open] .pick-row');
  assert.ok(!(await page.$('dialog[open] .pick-row >> text=SOMEONE SMILING')), 'requests shift 2 can\'t judge aren\'t offered');
  await page.click('dialog[open] >> text=+ Make a new request…');
  await page.click('dialog[open] .kind[data-kind="things"]');
  await page.type('dialog[open] input[placeholder="e.g. A DOG"]', 'a dog');
  await page.fill('dialog[open] input[type=search][placeholder^="Find a thing"]', 'dog');
  await page.click('dialog[open] .things label:has-text("dog")');
  await page.fill('dialog[open] input.num', '30');
  await page.click('dialog[open] >> text=Make it');
  await page.waitForTimeout(250);
  const pool = await page.textContent('[data-pool="2"]');
  assert.match(pool, /A DOG/);
  assert.match(await page.textContent('#toast'), /Made A DOG/);
});

await test('how many requests a work order shows, and the quota under it', async () => {
  await page.evaluate(() => { location.hash = '#shift/1'; });
  await page.waitForSelector('[data-stepper="show"]');
  assert.equal(await page.textContent('[data-stepper="show"] span'), '3');
  assert.equal(await page.textContent('[data-stepper="quota"] span'), '2');
  await page.click('[data-stepper="show"] button[aria-label="More requests shown"]');
  await page.waitForTimeout(150);
  assert.equal(await page.textContent('[data-stepper="show"] span'), '4');
  for (let k = 0; k < 3; k++) { await page.click('[data-stepper="show"] button[aria-label="Fewer requests shown"]'); await page.waitForTimeout(120); }
  assert.equal(await page.textContent('[data-stepper="show"] span'), '1');
  assert.equal(await page.textContent('[data-stepper="quota"] span'), '1', 'the quota follows it down');
  assert.equal(await page.isDisabled('[data-stepper="quota"] button[aria-label="More to file"]'), true);
  for (let k = 0; k < 3 && (await page.$('[data-pool="1"] .reset')); k++) { await page.click('[data-pool="1"] .reset'); await page.waitForTimeout(150); }
  assert.equal(await page.textContent('[data-stepper="show"] span'), '3');
  assert.equal(await page.textContent('[data-stepper="quota"] span'), '2');
});

await test('editing a line, with its pixel preview and fit', async () => {
  await page.evaluate(() => { location.hash = '#words/order'; });
  const sel = '[data-line="order.accept"] input';
  await page.waitForSelector(sel);
  await typeInto(sel, '● sign here');
  await page.waitForTimeout(150);
  assert.match(await page.textContent('[data-line="order.accept"]'), /fits/);
  await typeInto(sel, '● SIGN HERE AND HERE AND HERE AND ALSO RIGHT HERE PLEASE, RECORDER');
  await page.waitForTimeout(150);
  assert.match(await page.textContent('[data-line="order.accept"]'), /too wide/);
  await typeInto(sel, '● SIGN HERE {NOPE} é');
  await page.waitForTimeout(150);
  const t = await page.textContent('[data-line="order.accept"]');
  assert.match(t, /\{NOPE\} isn't filled in here/);
  assert.match(t, /font has no “É”/);
  await typeInto(sel, '● SIGN HERE');
});

await test('SAVE writes only what changed to the edits file', async () => {
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  const c = read();
  assert.equal(c.v, 1);
  assert.equal(c.shifts[3].memo, 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.');
  assert.deepEqual(c.quests['q-a-dog'], { kind: 'things', text: 'A DOG', merit: 30, things: ['dog'], min: 0.4 });
  assert.ok(c.shifts[2].pick.some((s) => s.includes('q-a-dog')));
  assert.equal(c.lines['order.accept'], '● SIGN HERE');
  assert.deepEqual(Object.keys(c).sort(), ['lines', 'quests', 'shifts', 'v']);
  assert.match(await page.textContent('#status'), /saved \d/);
  assert.equal(await page.isDisabled('#save'), true);
});

await test('reloading the controller shows what was saved', async () => {
  await page.goto(`${BASE}/editor/#shift/3`);
  await page.waitForSelector('#shift-3-memo');
  assert.equal(await page.inputValue('#shift-3-memo'), 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.');
  assert.match(await page.textContent('#links'), /Every request\s*1 NEW/);
});

await test('the game loads the saved edits', async () => {
  const g = await ctx.newPage();
  await g.goto(`${BASE}/?image=${encodeURIComponent('docs/unit.png')}`);
  await g.waitForFunction(() => window.__clearance && window.__clearance.game);
  const r = await g.evaluate(async () => {
    const days = await import('/src/game/days.js');
    const text = await import('/src/game/text.js');
    const req = await import('/src/game/requests.js');
    return { from: window.__clearance.content.from, warnings: window.__clearance.content.warnings, memo: days.shiftLine(days.DAYS[2], 'memo'), accept: text.t('order.accept'), dog: req.REQUESTS['q-a-dog'] && req.REQUESTS['q-a-dog'].text, pool: days.DAYS[1].pick.flat() };
  });
  assert.equal(r.from, 'file');
  assert.deepEqual(r.warnings, []);
  assert.equal(r.memo, 'COUNT EVERYONE. 3-17, NOBODY IS EXEMPT.');
  assert.equal(r.accept, '● SIGN HERE');
  assert.equal(r.dog, 'A DOG');
  assert.ok(r.pool.includes('q-a-dog'));
  await g.close();
});

await test('TRY plays a shift with unsaved changes, in a save of its own', async () => {
  const real = await page.evaluate(() => localStorage.getItem('clearance.save.v1'));
  await page.evaluate(() => { location.hash = '#shift/2'; });
  await page.waitForSelector('#shift-2-code');
  await typeInto('#shift-2-code', 'STOCKTAKE');
  await page.waitForTimeout(150);
  const [tryPage] = await Promise.all([ctx.waitForEvent('page'), page.click('text=▶ Try shift 2 with these changes')]);
  await tryPage.waitForFunction(() => window.__clearance && window.__clearance.game);
  const r = await tryPage.evaluate(() => {
    const g = window.__clearance.game;
    return { trial: !!g.trial, day: g.day, code: g.dayDef.code, pool: g.dayDef.pick.flat(), share: g.save.settings.share, tag: document.getElementById('trytag') && document.getElementById('trytag').textContent, tryKey: !!localStorage.getItem('clearance.save.try') };
  });
  assert.equal(r.trial, true); assert.equal(r.day, 2); assert.equal(r.code, 'STOCKTAKE');
  assert.ok(r.pool.includes('q-a-dog'), `the new request is in the shift's pool (the order draws 3 of it at random): ${r.pool}`);
  assert.equal(r.share, false, 'a try never shares with the index');
  assert.match(r.tag, /DRAFT · SHIFT 2 · NOT YOUR REAL GAME/);
  assert.equal(r.tryKey, true);
  assert.equal(await page.evaluate(() => localStorage.getItem('clearance.save.v1')), real, 'the real save is untouched');
  assert.equal(read().shifts[2].code, undefined, 'TRY doesn\'t save');
  await tryPage.close();
});

await test('a save that clashes with the file on disk asks first', async () => {
  const c = read(); c.lines['title.subtitle'] = 'CHANGED ON THE OTHER MACHINE';
  writeFileSync(FILE, JSON.stringify(c, null, 2));
  await page.click('#save');
  await page.waitForSelector('dialog[open] >> text=THE FILE CHANGED ON DISK');
  await page.click('dialog[open] >> text=Load the file');
  await page.waitForTimeout(200);
  assert.equal(await page.isDisabled('#save'), true, 'loaded: nothing unsaved');
  await page.click('#undo'); // my version back
  await page.waitForTimeout(150);
  await page.click('#save');
  await page.waitForTimeout(400);
  const after = read();
  assert.equal(after.shifts[2].code, 'STOCKTAKE');
  assert.equal(after.lines['title.subtitle'], undefined, 'the undo took the file\'s change out again');
});

await test('the changes page lists every edit and can put one back', async () => {
  await page.evaluate(() => { location.hash = '#changes'; });
  await page.waitForSelector('.chg');
  const rows = await page.$$eval('.chg', (r) => r.map((x) => x.textContent));
  assert.ok(rows.some((x) => /Shift 2 · name/.test(x)));
  assert.ok(rows.some((x) => /New request · A DOG/.test(x)));
  await page.click('.chg:has-text("Shift 2 · name") >> text=↺ original');
  await page.waitForTimeout(150);
  assert.ok(!(await page.$$eval('.chg', (r) => r.map((x) => x.textContent))).some((x) => /Shift 2 · name/.test(x)));
});

await test('without serve.py it saves through GitHub (the public site): SIGN IN', async () => {
  const p = await ctx.newPage();
  await p.route('**/editor/api', (r) => r.fulfill({ status: 404, body: 'no' }));
  await p.route('https://api.github.com/**', (r) => r.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"Not Found"}' }));
  await p.goto(`${BASE}/editor/#words/title`);
  await p.waitForSelector('[data-line="title.word"]');
  assert.match(await p.textContent('#status'), /thewilliamyao\/clearance · content\/edits.json · read-only until you sign in/);
  assert.equal(await p.textContent('#save'), 'SIGN IN');
  await p.close();
});

await test('GitHub out of reach as well: read-only, DOWNLOAD instead of SAVE', async () => {
  const p = await ctx.newPage();
  await p.route('**/editor/api', (r) => r.fulfill({ status: 404, body: 'no' }));
  await p.route('https://api.github.com/**', (r) => r.abort());
  await p.goto(`${BASE}/editor/#words/title`);
  await p.waitForSelector('[data-line="title.word"]');
  assert.match(await p.textContent('#status'), /read-only/);
  assert.equal(await p.textContent('#save'), 'DOWNLOAD');
  assert.match(await p.textContent('.banner'), /Couldn't read thewilliamyao\/clearance/);
  await p.close();
});

await test('a phone-width window: the pages become a menu, nothing scrolls sideways', async () => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.goto(`${BASE}/editor/#shift/5`);
  await p.waitForSelector('#shift-5-memo');
  assert.equal(await p.isVisible('#navsel'), true);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  assert.ok(over <= 0, `${over} px of sideways scroll`);
  await p.screenshot({ path: path.join(OUT, 'phone-shift5.png'), fullPage: false });
  await p.close();
});

await test('the save only answers the controller on this computer', async () => {
  const body = JSON.stringify({ content: { v: 1 }, force: true });
  const put = (headers) => fetch(`${BASE}/editor/api`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body }).then((r) => r.status);
  assert.equal(await put({}), 403, 'no controller header');
  assert.equal(await put({ 'X-Clearance-Controller': '1', Origin: 'https://example.com' }), 403, 'another site');
  assert.equal(await put({ 'X-Clearance-Controller': '1', 'Cf-Ray': 'abc' }), 404, 'through the tunnel');
  assert.equal(await fetch(`${BASE}/editor/`, { headers: { 'X-Forwarded-For': '1.2.3.4' } }).then((r) => r.status), 404, 'the page itself, through a proxy');
  const bad = await fetch(`${BASE}/editor/api`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Clearance-Controller': '1' }, body: JSON.stringify({ content: { v: 1, extra: 1 }, force: true }) });
  assert.equal(bad.status, 400);
  assert.equal(read().shifts[3].memo, 'COUNT EVERYONE. {RECORDER}, NOBODY IS EXEMPT.', 'the file is as the controller left it');
});

await page.screenshot({ path: path.join(OUT, 'changes.png') });
await test('no errors in the controller, the game or a try', async () => assert.deepEqual(errors, []));

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
