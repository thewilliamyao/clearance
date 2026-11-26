// Unit tests for the parts that don't need a browser: font, dithering, the pure-CV module,
// request judging and the shift data.   cd tools && npm test
import assert from 'node:assert/strict';
import { glyphChars, textWidth, wrapText } from '../../src/engine/font.js';
import { ordered, atkinson, threshold, buildLut } from '../../src/engine/dither.js';
import { BLUE } from '../../src/data/bluenoise.js';
import { analyzeCV, colorStats, convexHull, minAreaRect, findRects, inFocus } from '../../src/vision/cv.js';
import { REQUESTS as REQ } from '../../src/game/requests.js';
import { Screen, hex } from '../../src/engine/screen.js';
import { PAL16 } from '../../src/engine/palette.js';

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message); }
};

// --- synthetic images -----------------------------------------------------------------
const W = 160, H = 120;
function canvas(bg = [150, 150, 150]) {
  const a = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { a[i * 4] = bg[0]; a[i * 4 + 1] = bg[1]; a[i * 4 + 2] = bg[2]; a[i * 4 + 3] = 255; }
  return a;
}
function fill(a, inside, col) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x + 0.5, y + 0.5)) { const p = (y * W + x) * 4; a[p] = col[0]; a[p + 1] = col[1]; a[p + 2] = col[2]; }
  return a;
}
function noise(a, amt = 12, seed = 7) {
  let s = seed;
  for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) { s = (s * 1103515245 + 12345) >>> 0; a[i + k] = Math.max(0, Math.min(255, a[i + k] + ((s / 4294967296) - 0.5) * amt)); }
  return a;
}
const rot = (cx, cy, ang) => (x, y) => { const c = Math.cos(-ang), s = Math.sin(-ang); return [(x - cx) * c - (y - cy) * s, (x - cx) * s + (y - cy) * c]; };
const inRect = (cx, cy, hw, hh, ang = 0) => (x, y) => { const [u, v] = rot(cx, cy, ang)(x, y); return Math.abs(u) <= hw && Math.abs(v) <= hh; };
const inCircle = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inTri = (pts) => (x, y) => {
  const s = (a, b) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const d1 = s(pts[0], pts[1]), d2 = s(pts[1], pts[2]), d3 = s(pts[2], pts[0]);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const kinds = (r) => r.shapes.map((s) => s.kind);

console.log('font');
await test('every glyph decodes with 7 rows', () => assert.ok(glyphChars().length > 70));
await test('text width and wrapping', () => {
  assert.equal(textWidth('A'), 5);
  assert.equal(textWidth('I'), 3);
  const lines = wrapText('PHOTOGRAPH WHAT IS REQUESTED. NOTHING MORE.', 100);
  assert.ok(lines.length >= 2 && lines.every((l) => textWidth(l) <= 100));
});

console.log('dither');
await test('blue noise covers 0..255 evenly', () => {
  const counts = new Uint32Array(256); for (const v of BLUE) counts[v]++;
  assert.equal(BLUE.length, 4096); assert.ok(counts.every((c) => c === 16));
});
await test('ordered 1-bit keeps mean brightness', () => {
  const lum = new Float32Array(64 * 64).fill(0.3), out = new Uint8Array(64 * 64);
  ordered(lum, 64, 64, 2, out);
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  assert.ok(Math.abs(mean - 0.3) < 0.02, `mean ${mean}`);
});
await test('atkinson and threshold stay in range', () => {
  const lum = Float32Array.from({ length: 400 }, (_, i) => (i % 20) / 19), out = new Uint8Array(400);
  atkinson(lum, 20, 20, 4, out); assert.ok(out.every((v) => v <= 3));
  threshold(lum, 2, out); assert.ok(out.every((v) => v <= 1));
});
await test('palette LUT maps palette colours to themselves', () => {
  const lut = buildLut(PAL16);
  PAL16.forEach((c, i) => {
    const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    assert.equal(lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)], i);
  });
});
await test('screen draws without throwing off-edge', () => {
  const s = new Screen(null); s.rect(-10, -10, 400, 400, hex('#123456')); s.line(-5, -5, 400, 300, 1); s.circle(10, 10, 30, 2);
  assert.equal(s.buf[0], hex('#123456'));
});

console.log('cv: shapes');
await test('dark rectangle on grey', () => assert.equal(kinds(analyzeCV(noise(fill(canvas(), inRect(80, 60, 30, 20), [30, 30, 30])), W, H))[0], 'rect'));
await test('rotated rectangle', () => assert.equal(kinds(analyzeCV(noise(fill(canvas(), inRect(80, 60, 34, 16, 0.5), [25, 25, 25])), W, H))[0], 'rect'));
await test('light rectangle on dark', () => assert.equal(kinds(analyzeCV(noise(fill(canvas([40, 40, 40]), inRect(80, 60, 25, 32), [230, 230, 220])), W, H))[0], 'rect'));
await test('circle', () => assert.equal(kinds(analyzeCV(noise(fill(canvas(), inCircle(80, 60, 28), [30, 30, 30])), W, H))[0], 'circle'));
await test('small circle', () => assert.equal(kinds(analyzeCV(noise(fill(canvas(), inCircle(60, 50, 12), [20, 20, 20])), W, H))[0], 'circle'));
await test('ellipse still reads as a circle', () => {
  const r = analyzeCV(noise(fill(canvas(), (x, y) => ((x - 80) / 34) ** 2 + ((y - 60) / 24) ** 2 <= 1, [30, 30, 30])), W, H);
  assert.equal(kinds(r)[0], 'circle');
});
await test('triangle', () => assert.equal(kinds(analyzeCV(noise(fill(canvas(), inTri([[80, 20], [125, 100], [35, 100]]), [30, 30, 30])), W, H))[0], 'triangle'));
await test('rotated triangle', () => assert.equal(kinds(analyzeCV(noise(fill(canvas(), inTri([[40, 30], [130, 50], [70, 105]]), [30, 30, 30])), W, H))[0], 'triangle'));
// The rectangle finder works on edges, so it should take what the old blob finder couldn't:
// a printed, tilted rectangle, an outline, a rounded phone. (At 160x120 here; 320x240 in game.)
const inQuad = (q) => (x, y) => { let sg = 0; for (let k = 0; k < 4; k++) { const [a, b] = [q[k], q[(k + 1) % 4]], c = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])); if (c && sg && c !== sg) return false; if (c) sg = c; } return true; };
const stripes = (a, inside, k = 6) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x + 0.5, y + 0.5)) { const p = (y * W + x) * 4, v = (Math.floor(x / k) + Math.floor(y / k)) % 2 ? 200 : 90; a[p] = v; a[p + 1] = v * 0.8; a[p + 2] = 60; } return a; };
const rectIn = (a) => findRects(a, W, H).filter((r) => inFocus(r) && r.score >= 0.6);
await test('rectangle printed with a pattern, seen at an angle', () => {
  const q = [[45, 30], [118, 38], [112, 92], [50, 86]];
  assert.ok(rectIn(noise(stripes(canvas([60, 90, 140]), inQuad(q)))).length, 'not found');
});
await test('rectangle drawn as an outline', () => {
  const a = canvas([235, 235, 228]);
  fill(a, (x, y) => inRect(80, 60, 36, 24)(x, y) && !inRect(80, 60, 32, 20)(x, y), [25, 25, 25]);
  assert.ok(rectIn(noise(a)).length, 'not found');
});
await test('rounded phone with a picture on its screen', () => {
  const a = canvas([170, 160, 150]), round = (x, y) => { const dx = Math.max(0, Math.abs(x - 80) - 18), dy = Math.max(0, Math.abs(y - 60) - 34); return dx * dx + dy * dy <= 49; };
  fill(a, round, [20, 20, 22]); stripes(a, inRect(80, 60, 20, 36), 5);
  assert.ok(rectIn(noise(a)).length, 'not found');
});
await test('a circle and a triangle are not rectangles', () => {
  assert.equal(rectIn(noise(fill(canvas(), inCircle(80, 60, 30), [30, 30, 30]))).length, 0);
  assert.equal(rectIn(noise(fill(canvas(), inTri([[80, 22], [125, 100], [35, 100]]), [30, 30, 30]))).length, 0);
});
await test('A RECTANGLE needs it inside the brackets', () => {
  const v = REQ.rect.judge({ cv: analyzeCV(noise(fill(canvas(), inRect(22, 22, 16, 12), [30, 30, 30])), W, H) });
  assert.equal(v.ok, false); assert.ok(/OUTSIDE/.test(v.why), v.why);
  assert.equal(REQ.rect.judge({ cv: analyzeCV(noise(fill(canvas(), inRect(80, 60, 30, 20), [30, 30, 30])), W, H) }).ok, true);
});
await test('blank frame has no shapes and reads as nothing', () => {
  const r = analyzeCV(noise(canvas([120, 120, 120]), 8), W, H);
  assert.equal(r.shapes.length, 0); assert.ok(r.blank.score > 0.7, `blank ${r.blank.score}`);
});
await test('busy frame is not blank', () => {
  const a = canvas(); for (let k = 0; k < 12; k++) fill(a, inRect(10 + k * 13, 60, 4, 50), k % 2 ? [20, 20, 20] : [240, 240, 240]);
  assert.ok(analyzeCV(a, W, H).blank.score < 0.2);
});

console.log('cv: colour, symmetry, light');
await test('red square in the focus area', () => {
  const r = analyzeCV(noise(fill(canvas([90, 100, 110]), inRect(80, 60, 18, 18), [200, 30, 35])), W, H);
  assert.ok(r.color.frac.red > 0.1, `red ${r.color.frac.red}`); assert.ok(r.color.frac.blue < 0.02);
});
await test('skin tone is not red', () => {
  const r = colorStats(noise(fill(canvas([60, 60, 60]), inCircle(80, 60, 30), [214, 160, 130])), W, H);
  assert.ok(r.frac.red < 0.03, `red ${r.frac.red}`);
});
await test('blue and green', () => {
  const r = analyzeCV(fill(fill(canvas(), inRect(60, 60, 15, 30), [40, 80, 200]), inRect(100, 60, 15, 30), [50, 160, 70]), W, H);
  assert.ok(r.color.frac.blue > 0.1 && r.color.frac.green > 0.1);
});
await test('symmetric face-like pattern', () => {
  const a = canvas([160, 150, 140]);
  fill(a, inCircle(65, 50, 8), [20, 20, 20]); fill(a, inCircle(95, 50, 8), [20, 20, 20]); fill(a, inRect(80, 85, 20, 5), [40, 20, 20]);
  const r = analyzeCV(a, W, H); assert.ok(r.sym.score > 0.85, `sym ${r.sym.score}`);
});
await test('asymmetric frame scores low', () => {
  const a = canvas(); fill(a, inRect(30, 40, 20, 30), [10, 10, 10]); fill(a, inCircle(120, 90, 10), [250, 250, 250]);
  assert.ok(analyzeCV(a, W, H).sym.score < 0.6);
});
await test('a lamp in a dark room', () => {
  const r = analyzeCV(fill(canvas([35, 30, 30]), inCircle(80, 50, 10), [255, 255, 252]), W, H);
  assert.ok(r.light.ok, JSON.stringify({ frac: r.light.frac, rest: r.light.restMean }));
});
await test('a bright, evenly lit wall is not a light source', () => assert.ok(!analyzeCV(canvas([200, 200, 200]), W, H).light.ok));

console.log('cv: geometry');
await test('convex hull of a square', () => assert.equal(convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]]).length, 4));
await test('min-area rect of a rotated square', () => {
  const s = Math.SQRT1_2; const r = minAreaRect([[0, -s], [s, 0], [0, s], [-s, 0]]);
  assert.ok(Math.abs(r.area - 1) < 1e-6);
});

export { test, passed, failed };
if (process.argv[1] && process.argv[1].endsWith('unit.mjs')) {
  const more = await import('./unit-game.mjs').catch((e) => (e.code === 'ERR_MODULE_NOT_FOUND' ? null : Promise.reject(e)));
  if (more) await more.run(test);
  const index = await import('./unit-index.mjs');
  await index.run(test);
  const content = await import('./unit-content.mjs');
  await content.run(test);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
