// The controller's edits (content/edits.json): loading, checking, applying, and the
// controller's own model of them (editor/model.js). Run with the other unit tests: npm test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAYS, makeOrder, seeded, shiftLine, LAST_DAY, shownBy } from '../../src/game/days.js';
import { REQUESTS, ASK, LEARNED_LABEL, requestText, requestShort, judgeSelected, lookFor, liveNeed } from '../../src/game/requests.js';
import { TEXT, LINES, t, fill } from '../../src/game/text.js';
import { DEFAULTS, applyContent, resetContent, loadContent, cleanText, checkQuest } from '../../src/game/content.js';
import { INDEX_LABELS } from '../../src/game/labels.js';
import { SharedIndex } from '../../src/game/shared-index.js';
import { Draft, caps } from '../../editor/model.js';
import { measure } from '../../editor/preview.js';

const snapshot = () => JSON.stringify({ days: DAYS.map((d) => [d.code, d.memo, d.issueNote, d.quota, d.pick]), req: Object.entries(REQUESTS).map(([k, r]) => [k, r.text, r.short, r.merit]), ask: ASK, lab: LEARNED_LABEL, text: TEXT });
const box = (x, y, w, h) => [x, y, w, h];
const person = (score = 0.8, b = box(0.3, 0.2, 0.3, 0.7)) => ({ label: 'person', score, box: b });

export async function run(test) {
  console.log('content (the controller\'s edits)');
  const BASE = snapshot();

  await test('the lines read as they did before the text table (spot checks)', () => {
    assert.equal(t('order.title', { SHIFT: 3, SHIFTS: 7, NAME: 'CENSUS' }), 'WORK ORDER · SHIFT 3 OF 7 · CENSUS');
    assert.equal(t('field.quotaBody', { FILED: 4, N: 6, BONUS: 24 }), '4 OF 6 REQUESTS FILED. RETURN FOR REVIEW NOW AND COLLECT A +24 DILIGENCE BONUS.');
    assert.equal(t('global.recorderLine'), 'RECORDER 3-17');
    assert.equal(t('archive.title', { N: 1, S: '' }), 'ARCHIVE · 1 EXPOSURE ON FILE');
    assert.equal(t('shop.now', { SPEC: '80×60', CURRENT: '64×48' }), '80×60 (NOW 64×48)');
    assert.deepEqual(t('ending.filedText', { COUNT: 41, SUBJECTS: 23, FILED: 26 }).split('\n'), [
      'THE FILE ON RECORDER 3-17 IS COMPLETE.', '',
      'EXPOSURES ON FILE: 41', 'EXPOSURES WITH SUBJECTS: 23', 'REQUESTS FILED: 26', '',
      'EVERY EXPOSURE DESCRIBES THE ONE WHO TOOK IT: WHERE YOU WENT, WHAT YOU NOTICED, WHOM YOU CHOSE TO RECORD.',
      'THE OFFICE THANKS YOU FOR YOUR SERVICE. YOUR CLEARANCE IS REVOKED.',
    ]);
    assert.deepEqual(t('ending.exposedText', { COUNT: 9 }).split('\n'), [
      'UNIT OCR-7, ISSUED TO RECORDER 3-17, WAS RETURNED WITH ITS BACK OPEN.', '',
      'EXPOSURES LOST TO LIGHT: 9', 'RECORDS RECOVERED: 0', '', 'RECORDER 3-17 COULD NOT BE REACHED FOR COMMENT.',
    ]);
    assert.ok(shiftLine(DAYS[0], 'memo').startsWith('RECORDER 3-17: WELCOME TO THE OFFICE OF CIVIC RECORD.'));
    assert.equal(requestText({ key: 'again', arg: 7 }), 'THE SUBJECT OF EXPOSURE #007 AGAIN');
    assert.equal(requestShort({ key: 'again', arg: 7 }), 'SUBJECT #007 AGAIN');
    assert.equal(fill('{NOPE} {RECORDER}'), '{NOPE} 3-17', 'unknown placeholders stay as they are');
  });

  await test('every line fits its box as written (else text.js has the wrong box)', () => {
    const bad = [];
    for (const [k, l] of Object.entries(LINES)) {
      if (l.fit.cut) continue; // the unit cuts these with … by design
      const m = measure(fill(l.text, l.vars), l.fit);
      if (m.wide || m.over) bad.push(`${k} (${m.wide ? `${m.wide}px wide` : `${m.n} lines`})`);
    }
    assert.deepEqual(bad, []);
  });

  await test('no edits is the game as written; reset undoes everything', () => {
    applyContent(null); assert.equal(snapshot(), BASE);
    applyContent({ v: 1 }); assert.equal(snapshot(), BASE);
    applyContent({ v: 1, shifts: { 2: { memo: 'X' } }, quests: { red: { text: 'CRIMSON' }, 'q-dog': { kind: 'things', things: ['dog'], text: 'A DOG' } }, lines: { 'order.accept': 'GO' } });
    assert.notEqual(snapshot(), BASE);
    resetContent(); assert.equal(snapshot(), BASE);
    assert.equal(REQUESTS['q-dog'], undefined);
  });

  await test('shift edits: name, memo, issue note, quota and the pool reach the work order', () => {
    const r = applyContent({ v: 1, shifts: { 3: { code: 'HEADCOUNT', memo: 'COUNT THEM, {RECORDER}.', issueNote: '', quota: 2, pick: [['person'], ['two', 'crowd'], ['face']] } } });
    assert.deepEqual(r.warnings, []);
    const d = DAYS[2];
    assert.equal(d.code, 'HEADCOUNT');
    assert.equal(shiftLine(d, 'memo'), 'COUNT THEM, 3-17.');
    assert.equal(d.issueNote, undefined, 'an empty issue note means none');
    for (let s = 1; s < 40; s++) {
      const o = makeOrder(3, seeded(s), []);
      assert.equal(o.quota, 2);
      assert.equal(o.requests.length, 3);
      assert.equal(o.requests[0].key, 'person');
      assert.ok(['two', 'crowd'].includes(o.requests[1].key));
      assert.equal(o.requests[2].key, 'face');
    }
    resetContent();
  });

  await test('bad edits are skipped with a warning, never thrown', () => {
    const r = applyContent({ v: 1,
      shifts: { 1: { pick: [['red', 'nope'], ['person'], []], quota: 9 }, 3: { pick: [['self'], ['face']] }, 7: { pick: [['smile']] }, 9: { memo: 'X' }, 2: 'oops' },
      quests: { red: { merit: -4, text: '' }, 'q-x': { kind: 'nonsense', text: 'X' }, bad_key: { kind: 'things', things: ['dog'], text: 'A DOG' }, 'q-y': { kind: 'things', things: ['unicorn'], text: 'A UNICORN' } },
      lines: { 'no.such': 'X', 'order.accept': 42 } });
    const w = r.warnings.join('\n');
    for (const s of ['unknown request "nope"', 'person needs INVENTORY', 'quota must be 1 to 1', 'THE RECORDER ends the game', 'THE RECORDER put back', 'shift 9', 'shift 2: not an object', 'merit must be', 'empty wording', 'unknown kind', 'q-something', 'at least one thing', 'no such line', 'not text']) assert.ok(w.includes(s), `missing warning: ${s}\n${w}`);
    assert.deepEqual(DAYS[0].pick, [['red']], 'only what checks out is kept');
    assert.equal(DAYS[0].quota, 1);
    assert.deepEqual(DAYS[2].pick, [['face']]);
    assert.ok(DAYS[6].pick.some((s) => s.includes('self')), 'shift 7 always keeps THE RECORDER');
    assert.ok(DAYS[6].pick.some((s) => s.includes('smile')));
    assert.equal(REQUESTS.red.merit, 10);
    assert.equal(TEXT['order.accept'], '● ACCEPT ORDER');
    assert.deepEqual(applyContent('nonsense').warnings, ['content: not an object']);
    resetContent();
  });

  await test('built-in requests: wording, short wording, merit, question, label', () => {
    const r = applyContent({ v: 1, quests: { red: { text: 'SOMETHING CRIMSON', short: 'CRIMSON', merit: 14 }, outofplace: { short: '' }, sadness: { ask: "OH, SO THAT'S GRIEF?", label: 'GRIEVING' } } });
    assert.deepEqual(r.warnings, []);
    assert.equal(requestText({ key: 'red' }), 'SOMETHING CRIMSON');
    assert.equal(requestShort({ key: 'red' }), 'CRIMSON');
    assert.equal(REQUESTS.red.merit, 14);
    assert.equal(requestShort({ key: 'outofplace' }), 'SOMETHING THAT DOES NOT BELONG', 'an emptied short wording falls back to the wording');
    const A = { objects: [person()], faces: [], cv: { blank: { score: 0 } } };
    const asked = REQUESTS.sadness.judge(A, { req: { asked: false } });
    assert.equal(asked.why, "OH, SO THAT'S GRIEF?");
    assert.equal(asked.marks[0].label, 'GRIEVING?');
    resetContent();
  });

  await test('new requests of every kind are judged by the unit\'s existing checks', () => {
    const r = applyContent({ v: 1, quests: {
      'q-dog': { kind: 'things', things: ['dog'], text: 'A DOG', merit: 30, word: 'DOG' },
      'q-umbrella': { kind: 'with', things: ['umbrella'], text: 'SOMEONE WITH AN UMBRELLA' },
      'q-three': { kind: 'people', n: 3, text: 'THREE PEOPLE' },
      'q-purple': { kind: 'colour', colour: 'purple', need: 0.1, text: 'SOMETHING PURPLE' },
      'q-laugh': { kind: 'like', base: 'smile', text: 'SOMEONE LAUGHING' },
      'q-window': { kind: 'like', base: 'rect', text: 'A WINDOW' },
      'q-danger': { kind: 'word', rule: 'subject', label: 'DANGEROUS', text: 'SOMEONE DANGEROUS' },
    }, shifts: { 2: { pick: [['q-dog'], ['q-purple', 'q-window']] }, 3: { pick: [['q-umbrella'], ['q-three']] }, 4: { pick: [['q-laugh']] }, 5: { pick: [['q-danger'], ['sadness']] } } });
    assert.deepEqual(r.warnings, []);
    const dog = { label: 'dog', score: 0.8, box: box(0.4, 0.4, 0.2, 0.2) };
    assert.equal(REQUESTS['q-dog'].judge({ objects: [dog] }).ok, true);
    assert.equal(REQUESTS['q-dog'].judge({ objects: [] }).why, 'NO DOG ON RECORD');
    assert.equal(REQUESTS['q-dog'].merit, 30);
    assert.deepEqual(lookFor('q-dog').labels, ['dog']);
    const umb = { label: 'umbrella', score: 0.7, box: box(0.35, 0.1, 0.2, 0.2) };
    assert.equal(REQUESTS['q-umbrella'].judge({ objects: [person(), umb] }).ok, true);
    assert.equal(REQUESTS['q-umbrella'].judge({ objects: [person()] }).why, 'SUBJECT FOUND, NO UMBRELLA');
    assert.equal(REQUESTS['q-three'].judge({ objects: [person(), person(), person()] }).ok, true);
    assert.equal(REQUESTS['q-three'].judge({ objects: [person()] }).why, '1 OF 3 SUBJECTS');
    assert.equal(REQUESTS['q-three'].merit, 20, 'merit defaults to 20');
    const cv = (purple) => ({ color: { frac: { purple } } });
    assert.equal(REQUESTS['q-purple'].judge({ cv: cv(0.2) }).ok, true);
    assert.equal(REQUESTS['q-purple'].judge({ cv: cv(0.05) }).why, 'PURPLE IN BRACKETS 5% · NEED 10%');
    assert.deepEqual(liveNeed('q-purple'), ['color']);
    assert.deepEqual(liveNeed('q-window'), ['rects'], 'judged like A RECTANGLE: live check too');
    const face = { box: box(0.4, 0.3, 0.2, 0.2), smile: 0.8, eyesClosed: 0, yaw: 0, yawDeg: 0, read: { SURPRISE: 0 } };
    assert.equal(REQUESTS['q-laugh'].judge({ affect: [face] }).ok, true);
    assert.equal(REQUESTS['q-laugh'].mod, 'affect');
    const A = { objects: [person()], faces: [], cv: { blank: { score: 0 } } };
    const reqs = [{ key: 'q-danger', done: false }];
    const first = judgeSelected(A, reqs, 0, {});
    assert.equal(first.pick, null);
    assert.equal(first.focus.soft, true, 'it asks first, like the shift 5 requests');
    assert.equal(first.focus.why, "OH, SO THAT'S DANGEROUS?");
    reqs[0].asked = true;
    assert.ok(judgeSelected(A, reqs, 0, {}).pick, 'then files on the Recorder\'s word');
    assert.equal(LEARNED_LABEL['q-danger'], 'DANGEROUS');
    for (let s = 1; s < 30; s++) {
      const keys = makeOrder(2, seeded(s), []).requests.map((x) => x.key);
      assert.equal(keys[0], 'q-dog');
      assert.ok(['q-purple', 'q-window'].includes(keys[1]));
    }
    resetContent();
  });

  await test('a new shift 5 label stays on the phone: the shared index only takes its ten', () => {
    applyContent({ v: 1, quests: { 'q-danger': { kind: 'word', rule: 'subject', label: 'DANGEROUS', text: 'SOMEONE DANGEROUS' } } });
    assert.equal(INDEX_LABELS.length, 10);
    assert.ok(!INDEX_LABELS.includes('q-danger'));
    const sent = [];
    const g = { save: { settings: { share: true }, outbox: [], shared: [] }, persist() {} };
    const ix = new SharedIndex(g, { base: 'http://index.test', fetchFn: async (url, opts) => { sent.push(opts); return { status: 201, ok: true, json: async () => ({ id: 1, key: 'k', day: '2026-11-23' }) }; } });
    const px = new Uint8Array(1200);
    assert.equal(ix.file(5, 'q-danger', px), false);
    assert.equal(ix.file(6, 'sadness', px), true);
    resetContent();
  });

  await test('cleanText: straight quotes, no tabs or control characters', () => {
    assert.equal(cleanText('THAT’S “IT”\tNOW\u0007'), 'THAT\'S "IT" NOW');
    assert.equal(cleanText('A\r\nB'), 'A\nB');
    assert.equal(caps('that’s it'), "THAT'S IT");
  });

  await test('loadContent: the file, the TRY draft, and nothing at all', async () => {
    const ok = (j) => async () => ({ ok: true, json: async () => j });
    let r = await loadContent({ fetchFn: ok({ v: 1, lines: { 'order.accept': '● SIGN HERE' } }) });
    assert.equal(r.from, 'file'); assert.equal(TEXT['order.accept'], '● SIGN HERE');
    r = await loadContent({ fetchFn: async () => { throw new Error('offline'); } });
    assert.equal(r.from, 'none'); assert.equal(TEXT['order.accept'], '● ACCEPT ORDER');
    r = await loadContent({ fetchFn: async () => ({ ok: false, status: 404 }) });
    assert.equal(r.from, 'none');
    globalThis.localStorage = { getItem: () => JSON.stringify({ v: 1, shifts: { 1: { code: 'TRIAL' } } }) };
    r = await loadContent({ draft: true, fetchFn: ok({ v: 1 }) });
    assert.equal(r.from, 'draft'); assert.equal(DAYS[0].code, 'TRIAL');
    delete globalThis.localStorage;
    r = await loadContent({ fetchFn: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }) });
    assert.equal(r.from, 'none');
    resetContent();
  });

  await test('the committed content/edits.json applies cleanly', () => {
    const c = JSON.parse(readFileSync(new URL('../../content/edits.json', import.meta.url)));
    assert.equal(c.v, 1);
    assert.deepEqual(applyContent(c).warnings, []);
    for (const d of DAYS) for (let s = 1; s < 20; s++) {
      const o = makeOrder(d.n, seeded(s * 31), []);
      assert.ok(o.requests.length >= o.quota && o.quota >= 1);
      for (const q of o.requests) assert.ok(REQUESTS[q.key]);
    }
    resetContent();
  });

  await test('the controller keeps only what differs from the game as written', () => {
    const d = new Draft({ v: 1 });
    d.setShift(2, 'memo', DEFAULTS.shifts[1].memo);
    d.setLine('order.accept', '● accept order');
    d.setQuest('red', 'merit', 10);
    assert.deepEqual(d.toJSON(), { v: 1 }, 'setting a field back to the original drops it');
    d.setShift(2, 'memo', 'new memo');
    assert.equal(d.toJSON().shifts[2].memo, 'NEW MEMO', 'capitals, like everything on the unit');
    d.setLine('order.accept', '● sign');
    assert.equal(d.line('order.accept'), '● SIGN');
    assert.ok(d.lineChanged('order.accept'));
    d.resetLine('order.accept');
    assert.ok(!d.lineChanged('order.accept'));
    assert.equal(d.changes().length, 1);
  });

  await test('the controller\'s new requests: keys, pools, deleting', () => {
    const d = new Draft({ v: 1 });
    const k = d.addQuest({ kind: 'things', things: ['dog'], text: 'a dog', merit: 30 });
    assert.equal(k, 'q-a-dog');
    assert.equal(d.addQuest({ kind: 'things', things: ['cat'], text: 'A DOG' }), 'q-a-dog-2', 'keys never collide');
    assert.equal(d.quest(k).text, 'A DOG');
    assert.ok(checkQuest(k, d.toJSON().quests[k]));
    d.setShift(2, 'pick', [...DEFAULTS.shifts[1].pick, [k]]);
    assert.deepEqual(d.shiftsUsing(k), [2]);
    d.setShift(2, 'quota', 7);
    d.setShift(2, 'pick', [[k]]);
    assert.equal(d.shift(2).quota, 1, 'fewer slots than the quota: the quota comes down');
    assert.equal(d.toJSON().shifts[2].quota, 1);
    d.removeQuest(k);
    assert.equal(d.quest(k).text, undefined);
    assert.deepEqual(d.shiftsUsing(k), []);
    assert.equal(d.toJSON().shifts, undefined, 'a pool left empty goes back to the original');
    assert.deepEqual(applyContent(d.toJSON()).warnings, []);
    resetContent();
  });

  await test('how many requests a work order shows: edited, checked, and the quota kept under it', () => {
    let r = applyContent({ v: 1, shifts: { 1: { show: 4, quota: 3 } } });
    assert.deepEqual(r.warnings, []);
    for (let s = 1; s < 30; s++) { const o = makeOrder(1, seeded(s), []); assert.equal(o.requests.length, 4); assert.equal(o.quota, 3); }
    r = applyContent({ v: 1, shifts: { 1: { show: 9 }, 2: { show: 2, quota: 3 } } });
    assert.ok(r.warnings.some((w) => /shift 1: show must be 1 to 6/.test(w)), r.warnings.join());
    assert.ok(r.warnings.some((w) => /shift 2: quota must be 1 to 2/.test(w)), r.warnings.join());
    assert.equal(shownBy(DAYS[0]), 3, 'a bad show is ignored');
    assert.equal(DAYS[1].quota, 2);
    r = applyContent({ v: 1, shifts: { 3: { pick: [['person'], ['face']] } } });
    assert.equal(shownBy(DAYS[2]), 2, 'a smaller pool brings show down');
    resetContent();
    assert.equal(shownBy(DAYS[0]), 3);
  });

  await test('the controller keeps show and quota in step with the pool', () => {
    const d = new Draft({ v: 1 });
    d.setShift(4, 'show', 5);
    assert.equal(d.shift(4).show, 5);
    d.setShift(4, 'quota', 5);
    d.setShift(4, 'show', 2);
    assert.equal(d.shift(4).quota, 2, 'showing fewer brings the quota down');
    assert.deepEqual(d.toJSON().shifts[4], { show: 2, quota: 2 });
    d.setShift(4, 'pick', [['smile']]);
    assert.equal(d.shift(4).show, 1);
    d.resetShift(4, 'pick');
    assert.equal(d.toJSON().shifts, undefined, 'the pool as written comes back with its own show and quota');
    assert.deepEqual(applyContent(d.toJSON()).warnings, []);
    resetContent();
  });
}
