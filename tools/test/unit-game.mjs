// Game-logic tests: shifts, work orders, judging, prompt embeddings.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAYS, makeOrder, seeded, issuedBy, shownBy } from '../../src/game/days.js';
import { REQUESTS, judgeSelected, requestText, learnedFrom, LEARNED_LABEL, ASK } from '../../src/game/requests.js';
import { rankIn } from '../../src/vision/clip.js';
import { allPrompts, CONCEPTS } from '../../src/data/prompts.js';
import { wrapText } from '../../src/engine/font.js';

export async function run(test) {
  console.log('game');
  await test('every shift builds a valid order, many times over', () => {
    for (const d of DAYS) for (let s = 1; s < 60; s++) {
      const photos = s % 2 ? [] : [{ id: 3, emb: { q: new Int8Array(512), s: 1 } }, { id: 4, emb: { q: new Int8Array(512), s: 1 } }];
      const { requests, quota } = makeOrder(d.n, seeded(s * 7919), photos);
      assert.ok(requests.length >= quota && quota >= 1, `shift ${d.n}: ${requests.length} requests, quota ${quota}`);
      for (const r of requests) assert.ok(REQUESTS[r.key], `unknown request ${r.key}`);
      const keys = requests.filter((r) => r.key !== 'again').map((r) => r.key);
      assert.equal(new Set(keys).size, keys.length, `duplicate requests on shift ${d.n}: ${keys}`);
      if (!photos.length) assert.ok(!requests.some((r) => ['again', 'seen', 'place'].includes(r.key)), 'continuity request without history');
    }
  });
  await test('every request uses a module installed by the shifts that ask for it', () => {
    for (const d of DAYS) for (const opts of d.pick) for (const k of opts) {
      const mod = REQUESTS[k].mod;
      assert.ok(d.modules.includes(mod), `shift ${d.n} asks ${k} but has no ${mod}`);
    }
  });
  await test('memos fit the work order', () => {
    for (const d of DAYS) assert.ok(wrapText(d.memo, 284).length <= 6, `shift ${d.n} memo too long`);
  });
  await test('issued grades only go up', () => {
    let prev = issuedBy(1);
    for (let n = 2; n <= DAYS.length; n++) { const cur = issuedBy(n); for (const k of Object.keys(cur)) assert.ok(cur[k] >= prev[k]); prev = cur; }
    assert.equal(issuedBy(7).tone, 5);
  });
  await test('dynamic request text', () => assert.equal(requestText({ key: 'again', arg: 12 }), 'THE SUBJECT OF EXPOSURE #012 AGAIN'));
  await test('a photo is judged only for the selected request', () => {
    const A = { cv: { color: { frac: { red: 0.5, blue: 0, green: 0.5 } }, shapes: [], sym: { score: 0 }, light: { ok: false }, blank: { score: 0 } } };
    const reqs = [{ key: 'red', done: false }, { key: 'blue', done: false }, { key: 'green', done: false }];
    assert.equal(judgeSelected(A, reqs, 0, {}).pick.req.key, 'red');
    const v = judgeSelected(A, reqs, 1, {});
    assert.equal(v.pick, null, 'blue is selected: the red and green in the photo must not file anything');
    assert.equal(v.focus.req.key, 'blue');
    assert.ok(/BLUE/.test(v.focus.why));
    reqs[0].done = true;
    assert.equal(judgeSelected(A, reqs, 0, {}).pick, null, 'a filed request is not filed twice');
  });
  await test('the INTENT bars cover every concept (else: intent-bench.mjs calibrate)', () => {
    const bars = JSON.parse(readFileSync(new URL('../../data/intent-bars.json', import.meta.url)));
    for (const id of Object.keys(CONCEPTS)) {
      const q = bars.q[id];
      assert.ok(q && q.length === 21, `no bars for ${id}`);
      for (let i = 1; i < q.length; i++) assert.ok(q[i] >= q[i - 1], `${id} bars not ascending`);
    }
    assert.equal(rankIn(-1, [0, 1, 2]), 0);
    assert.equal(rankIn(1, [0, 1, 2]), 0.5);
    assert.equal(rankIn(1.5, [0, 1, 2]), 0.75);
    assert.equal(rankIn(9, [0, 1, 2]), 1);
  });
  await test('shift 5: the unit asks once, then files on the Recorder\'s word', () => {
    const clip = (p) => ({ concept: () => ({ p, d: 0, best: 'a photo of a sad person', opp: 'A SMILE' }) });
    const person = { label: 'person', score: 0.8, box: [0.3, 0.2, 0.3, 0.7] };
    const cv = (blank) => ({ blank: { score: blank } });
    const none = { emb: new Float32Array(512), objects: [], faces: [], cv: cv(0.1) };
    const one = { ...none, objects: [person] };
    const asked = (v) => ({ clip: clip(0.05), req: { asked: v } });
    // People requests and sadness need a subject; then: asked once, filed the next time.
    for (const k of ['sadness', 'waiting', 'notbelong', 'hurry', 'tired']) {
      assert.match(REQUESTS[k].judge(none, asked(false)).why, /NO SUBJECT/, k);
      const first = REQUESTS[k].judge(one, asked(false));
      assert.equal(first.ok, false); assert.equal(first.soft, true, `${k}: the first photo is a soft fail`);
      assert.equal(first.why, ASK[k]);
      assert.ok(first.marks.some((m) => m.label === `${LEARNED_LABEL[k]}?`), 'the subject is tagged with a question');
      const second = REQUESTS[k].judge(one, asked(true));
      assert.equal(second.ok, true, `${k} files when the Recorder insists, whatever the model saw`);
      assert.ok(second.marks.some((m) => m.label === LEARNED_LABEL[k]));
    }
    // "Something" requests need something in frame; a place isn't a face filling the frame.
    assert.match(REQUESTS.suspicious.judge({ ...none, cv: cv(0.9) }, asked(true)).why, /NOTHING IN FRAME/);
    assert.equal(REQUESTS.suspicious.judge(none, asked(true)).ok, true);
    const selfie = { ...none, faces: [{ score: 0.9, box: [0.2, 0.1, 0.5, 0.6] }] };
    assert.match(REQUESTS.hiding.judge(selfie, asked(true)).why, /A FACE IS NOT A PLACE/);
    assert.equal(REQUESTS.hiding.judge({ ...none, cv: cv(0.9) }, asked(true)).ok, true, 'a dark corner is a place');
    // Works without the INTENT model too.
    assert.equal(REQUESTS.waiting.judge({ objects: [person], faces: [] }, { req: { asked: true } }).ok, true);
  });
  await test('a withdrawn request is never judged', () => {
    const reqs = [{ key: 'suspicious', arg: null, done: false, asked: true, withdrawn: true }];
    const A = { emb: null, objects: [], faces: [], cv: { blank: { score: 0 } } };
    const v = judgeSelected(A, reqs, 0, {});
    assert.equal(v.pick, null); assert.equal(v.focus, null);
  });
  await test('the soft fail is remembered on the work order', () => {
    const reqs = [{ key: 'suspicious', arg: null, done: false }];
    const A = { emb: null, objects: [], faces: [], cv: { blank: { score: 0 } } };
    const v1 = judgeSelected(A, reqs, 0, {});
    assert.equal(v1.pick, null); assert.equal(v1.focus.soft, true);
    reqs[0].asked = true; // game.analyze does this
    assert.ok(judgeSelected(A, reqs, 0, {}).pick, 'the second photo files');
  });
  await test('later exposures are profiled with what the Recorder filed', () => {
    const e = (i) => { const v = new Float32Array(512); v[i] = 1; return v; };
    const pack = (v) => ({ q: Int8Array.from(v, (x) => Math.round(x * 127)), s: 1 / 127 });
    const photos = [
      { id: 3, emb: pack(e(0)), verdict: { ok: true, key: 'sadness' } },
      { id: 4, emb: pack(e(1)), verdict: { ok: true, key: 'notbelong' } },
      { id: 5, emb: pack(e(2)), verdict: { ok: true, key: 'red' } }, // not a shift 5 label
      { id: 6, emb: pack(e(3)), verdict: { ok: false, key: 'sadness' } },
    ];
    const near = new Float32Array(512); near[1] = 0.8; near[0] = 0.6;
    const l = learnedFrom(near, photos);
    assert.equal(l.label, 'DOES NOT BELONG'); assert.equal(l.id, 4); assert.ok(Math.abs(l.sim - 0.8) < 0.01);
    assert.equal(learnedFrom(e(2), photos).label === 'SAD' || learnedFrom(e(2), photos).label === 'DOES NOT BELONG', true, 'a red photo taught nothing');
    assert.equal(learnedFrom(near, []), null);
    assert.equal(learnedFrom(null, photos), null);
  });
  await test('SOMEONE ALONE counts the people in frame', () => {
    const person = (x) => ({ label: 'person', score: 0.7, box: [x, 0.2, 0.2, 0.6] });
    assert.equal(REQUESTS.alone.judge({ objects: [person(0.4)], faces: [] }).ok, true);
    assert.equal(REQUESTS.alone.judge({ objects: [], faces: [{ score: 0.9, box: [0.4, 0.3, 0.2, 0.2] }] }).ok, true);
    const two = REQUESTS.alone.judge({ objects: [person(0.1), person(0.6)], faces: [] });
    assert.equal(two.ok, false); assert.match(two.why, /2 SUBJECTS/);
    assert.match(REQUESTS.alone.judge({ objects: [], faces: [] }).why, /NO SUBJECT/);
  });
  await test('every CLIP prompt has an embedding (else: npm run embed)', () => {
    const j = JSON.parse(readFileSync(new URL('../../data/prompt-embeddings.json', import.meta.url)));
    const have = new Set(j.items.map((x) => x[0]));
    const missing = allPrompts().filter((p) => !have.has(p));
    assert.deepEqual(missing, []);
    assert.ok(Object.keys(CONCEPTS).every((c) => REQUESTS[c] || ['outofplace', 'notbelong'].includes(c)));
  });

  // William, Nov 24: the first shifts were too long. A work order shows a few requests drawn
  // at random from the shift's whole pool; the list grows shift by shift.
  const photos = [3, 4, 5, 6].map((id) => ({ id, emb: { q: new Int8Array(512), s: 1 }, person: true }));
  await test('each work order shows its shift\'s number of requests: 3, 3, 3, 4, 5, 5, then THE RECORDER', () => {
    assert.deepEqual(DAYS.map(shownBy), [3, 3, 3, 4, 5, 5, 1]);
    assert.deepEqual(DAYS.map((d) => d.quota), [2, 2, 2, 3, 3, 3, 1]);
    for (const d of DAYS) for (let s = 1; s < 120; s++) {
      const o = makeOrder(d.n, seeded(s * 104729 + d.n), photos);
      assert.equal(o.requests.length, shownBy(d), `shift ${d.n}, seed ${s}`);
      assert.ok(o.quota <= o.requests.length);
    }
  });
  await test('the list grows as the game goes on', () => {
    const sizes = DAYS.slice(0, -1).map(shownBy);
    for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] >= sizes[i - 1], `shift ${i + 1} shows fewer than shift ${i}`);
  });
  await test('every request in a shift\'s pool still comes up, a different set each game', () => {
    for (const d of DAYS.slice(0, 5)) {
      const seen = new Set(), sets = new Set();
      for (let s = 1; s < 400; s++) {
        const keys = makeOrder(d.n, seeded(s * 7907 + 13), []).requests.map((r) => r.key);
        keys.forEach((k) => seen.add(k));
        sets.add(keys.join());
      }
      assert.deepEqual([...seen].sort(), [...new Set(d.pick.flat())].sort(), `shift ${d.n} never asks some of its pool`);
      assert.ok(sets.size > 5, `shift ${d.n} draws the same few orders`);
    }
  });
  await test('the drawn requests keep the pool\'s order', () => {
    const slotOf = (d, k) => d.pick.findIndex((slot) => slot.includes(k));
    for (let s = 1; s < 100; s++) {
      const d = DAYS[0], idx = makeOrder(1, seeded(s), []).requests.map((r) => slotOf(d, r.key));
      for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1]);
    }
  });
  await test('THE RECORDER is always drawn on the last shift, whatever else its pool holds', () => {
    const d = DAYS[6], keep = { pick: d.pick, show: d.show };
    d.pick = [['smile'], ['face'], ['self'], ['atyou']]; d.show = 1;
    try {
      for (let s = 1; s < 60; s++) assert.deepEqual(makeOrder(7, seeded(s), []).requests.map((r) => r.key), ['self']);
      d.show = 2;
      for (let s = 1; s < 60; s++) assert.ok(makeOrder(7, seeded(s), []).requests.some((r) => r.key === 'self'));
    } finally { d.pick = keep.pick; d.show = keep.show; }
  });
}
