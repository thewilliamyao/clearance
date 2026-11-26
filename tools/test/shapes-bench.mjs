// Rectangle detector benchmark. Makes a few hundred camera-like pictures from the workspace's
// photos: rectangles of every kind (plain, printed with a picture, picture frames, screens
// with a bezel, rounded phones and cards, outlines drawn on the ground, tilted in perspective,
// with shadows, uneven light, noise, blur and JPEG) and non-rectangles (circles, ellipses,
// triangles, blobs), always roughly inside the brackets. Then it scores the old blob-based
// detector and the new edge-based one the way the game judges A RECTANGLE.
//   cd tools && node test/shapes-bench.mjs [count] [--sheet]
// --sheet writes contact sheets of the misses to tools/test/out/shapes/.
import sharp from 'sharp';
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findShapes, findRects, luma, inFocus } from '../../src/vision/cv.js';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/shapes/', import.meta.url));
const COUNT = Number(process.argv.find((a) => /^\d+$/.test(a)) || 360);
const SHEET = process.argv.includes('--sheet');
const PASS = Number(process.env.PASS || 0.6); // the new judge's bar

const imgs = (dir) => (existsSync(path.join(REPO, dir)) ? readdirSync(path.join(REPO, dir)).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => path.join(REPO, dir, f)) : []);
const BG = [...imgs('room-watch/ref'), ...imgs('room-watch/ref-living'), ...imgs('portfolio/content/bench/thumbs').slice(0, 14), ...imgs('ancient-cats').slice(0, 6), ...imgs('portfolio/content/shelf/take-a-seat')];
const TEX = [...imgs('portfolio/content/bench/thumbs').slice(14), ...imgs('portfolio/content/shelf/now'), ...imgs('portfolio/content/shelf/dimmy-the-cube'), ...imgs('portfolio/content/media/grimes')];

let seed = 1234567;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const R = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

async function crop(file, w, h) {
  const m = await sharp(file).metadata();
  const ar = w / h;
  let cw = m.width * R(0.45, 1), ch = cw / ar;
  if (ch > m.height) { ch = m.height * R(0.6, 1); cw = ch * ar; }
  cw = Math.min(cw, m.width); ch = Math.min(ch, m.height);
  const left = Math.floor(R(0, m.width - cw)), top = Math.floor(R(0, m.height - ch));
  const buf = await sharp(file).extract({ left, top, width: Math.max(8, Math.floor(cw)), height: Math.max(8, Math.floor(ch)) }).resize(w, h, { fit: 'fill' }).removeAlpha().ensureAlpha().raw().toBuffer();
  return new Uint8Array(buf);
}

// Homography mapping the unit square to the quad (corners in order (0,0) (1,0) (1,1) (0,1)).
function homography(q) {
  const src = [[0, 0], [1, 0], [1, 1], [0, 1]], A = [], b = [];
  for (let k = 0; k < 4; k++) {
    const [x, y] = src[k], [u, v] = q[k];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let i = 0; i < 8; i++) {
    let p = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    for (let r = 0; r < 8; r++) { if (r === i) continue; const f = A[r][i] / A[i][i]; for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const hh = b.map((v, i) => v / A[i][i]);
  return [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1];
}
function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

// A flat rectangle W x H turned in 3D (yaw, pitch, roll) and projected, centred at (sx, sy).
function project(sx, sy, W, H, yaw, pitch, roll, f = 640) {
  const cr = Math.cos(roll), sr = Math.sin(roll), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy2 = Math.sin(yaw);
  return [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]].map(([x, y]) => {
    let X = x * cr - y * sr, Y = x * sr + y * cr, Z = 0;
    [Y, Z] = [Y * cp - Z * sp, Y * sp + Z * cp];
    [X, Z] = [X * cy + Z * sy2, -X * sy2 + Z * cy];
    return [sx + (f * X) / (Z + f), sy + (f * Y) / (Z + f)];
  });
}

function sampleTex(tex, tw, th, u, v) {
  const x = Math.max(0, Math.min(tw - 1.001, u * (tw - 1))), y = Math.max(0, Math.min(th - 1.001, v * (th - 1)));
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const p = (yy, xx) => tex[(yy * tw + xx) * 4 + c];
    out[c] = (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) + (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy;
  }
  return out;
}

// Paint a shape (defined in the unit square by inside(u, v) -> colour or null) through the
// homography, 3x3 supersampled.
function paint(img, w, h, quad, inside) {
  const Hm = homography(quad), Hi = invert3(Hm);
  const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 1), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 1), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)) + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    let n = 0; const acc = [0, 0, 0];
    for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3, py = y + (sy + 0.5) / 3;
      const W = Hi[6] * px + Hi[7] * py + Hi[8], u = (Hi[0] * px + Hi[1] * py + Hi[2]) / W, v = (Hi[3] * px + Hi[4] * py + Hi[5]) / W;
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      const c = inside(u, v);
      if (!c) continue;
      n++; acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    }
    if (!n) continue;
    const a = n / 9, p = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) img[p + c] = img[p + c] * (1 - a) + (acc[c] / n) * a;
  }
}

function shadow(img, w, h, quad, dx, dy, k) {
  const m = new Float32Array(w * h), q = quad.map(([x, y]) => [x + dx, y + dy]);
  const tmp = new Uint8Array(w * h * 4).fill(0);
  paint(tmp, w, h, q, () => [255, 255, 255]);
  for (let i = 0; i < w * h; i++) m[i] = tmp[i * 4] / 255;
  // Box blur, radius 6, twice.
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(w * h), r = 6;
    for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += m[y * w + Math.max(0, Math.min(w - 1, x))]; for (let x = 0; x < w; x++) { t[y * w + x] = s / (2 * r + 1); s += m[y * w + Math.min(w - 1, x + r + 1)] - m[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.max(0, Math.min(h - 1, y)) * w + x]; for (let y = 0; y < h; y++) { m[y * w + x] = s / (2 * r + 1); s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
  }
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) img[i * 4 + c] *= 1 - k * m[i];
}

const STYLES = ['solid', 'photo', 'photo', 'framed', 'screen', 'rounded', 'outline', 'lowcontrast'];
const NEG = ['ellipse', 'ellipse', 'triangle', 'blob', 'blob'];

async function makeCase(i) {
  const W = 640, H = 480;
  const img = await crop(pick(BG), W, H);
  const pos = rnd() < 0.68;
  const style = pos ? pick(STYLES) : pick(NEG);
  const tex = rnd() < 0.75 ? await crop(pick(TEX), 160, 160) : null;
  // Size and place: roughly inside the brackets, like a player framing it.
  const big = R(0.2, 0.62) * W, aspect = Math.exp(R(Math.log(0.45), Math.log(2.2)));
  let sw = big, sh = big / aspect;
  if (sh > 0.7 * H) { sh = 0.7 * H; sw = sh * aspect; }
  const cx = W * R(0.38, 0.62), cy = H * R(0.38, 0.62);
  const tilt = rnd() < 0.7;
  const yaw = tilt ? R(-0.6, 0.6) : R(-0.1, 0.1), pitch = tilt ? R(-0.55, 0.55) : R(-0.1, 0.1), roll = R(-0.4, 0.4);
  const quad = project(cx, cy, sw, sh, yaw, pitch, roll);
  if (quad.some(([x, y]) => x < 4 || y < 4 || x > W - 5 || y > H - 5)) return makeCase(i); // keep it whole in the frame
  const solid = [R(10, 245), R(10, 245), R(10, 245)];
  // Low contrast: a colour near the ground's average around the shape.
  if (style === 'lowcontrast') {
    let s = [0, 0, 0], n = 0;
    for (let y = Math.floor(cy - sh / 2); y < cy + sh / 2; y += 4) for (let x = Math.floor(cx - sw / 2); x < cx + sw / 2; x += 4) { const p = (Math.max(0, Math.min(H - 1, y)) * W + Math.max(0, Math.min(W - 1, x))) * 4; s[0] += img[p]; s[1] += img[p + 1]; s[2] += img[p + 2]; n++; }
    const d = R(28, 45) * (rnd() < 0.5 ? -1 : 1);
    for (let c = 0; c < 3; c++) solid[c] = Math.max(0, Math.min(255, s[c] / n + d));
  }
  const shade = (u, v, c) => { const k = 0.88 + 0.22 * (u * 0.6 + v * 0.4); return [c[0] * k, c[1] * k, c[2] * k]; };
  const photo = (u, v) => (tex ? sampleTex(tex, 160, 160, u, v) : solid);
  const rad = R(0.06, 0.18) * Math.min(sw, sh);
  const roundIn = (u, v) => {
    const x = u * sw, y = v * sh, cxr = Math.max(rad, Math.min(sw - rad, x)), cyr = Math.max(rad, Math.min(sh - rad, y));
    return (x - cxr) ** 2 + (y - cyr) ** 2 <= rad * rad;
  };
  const border = R(0.06, 0.12) * Math.min(sw, sh), frameCol = pick([[245, 245, 240], [25, 22, 20], [120, 80, 45], [190, 190, 195]]);
  const stroke = R(3, 9);
  const blobK = [R(0, 6.28), R(0, 6.28), R(0.12, 0.28), R(0.08, 0.2)];
  const inside = {
    solid: (u, v) => shade(u, v, solid),
    lowcontrast: (u, v) => solid,
    photo: (u, v) => shade(u, v, photo(u, v)),
    framed: (u, v) => (u * sw < border || v * sh < border || (1 - u) * sw < border || (1 - v) * sh < border ? shade(u, v, frameCol) : photo(u, v)),
    screen: (u, v) => (!roundIn(u, v) ? null : u * sw < border * 0.8 || v * sh < border * 0.8 || (1 - u) * sw < border * 0.8 || (1 - v) * sh < border * 1.6 ? [18, 18, 20] : photo(u, v)),
    rounded: (u, v) => (roundIn(u, v) ? shade(u, v, tex && rnd() < 0.5 ? photo(u, v) : solid) : null),
    outline: (u, v) => (u * sw < stroke || v * sh < stroke || (1 - u) * sw < stroke || (1 - v) * sh < stroke ? [R(10, 40), R(10, 40), R(10, 40)] : null),
    ellipse: (u, v) => ((2 * u - 1) ** 2 + (2 * v - 1) ** 2 <= 1 ? shade(u, v, tex ? photo(u, v) : solid) : null),
    triangle: (u, v) => (Math.abs(u - 0.5) <= v / 2 ? shade(u, v, tex ? photo(u, v) : solid) : null),
    blob: (u, v) => { const a = Math.atan2(v - 0.5, u - 0.5), r = Math.hypot(u - 0.5, v - 0.5); return r <= 0.4 * (1 + blobK[2] * Math.sin(3 * a + blobK[0]) + blobK[3] * Math.sin(5 * a + blobK[1])) ? shade(u, v, tex ? photo(u, v) : solid) : null; },
  }[style];
  if (style !== 'outline' && rnd() < 0.6) shadow(img, W, H, quad, R(-12, 12), R(4, 16), R(0.2, 0.45));
  paint(img, W, H, quad, inside);
  // Uneven light, exposure, sensor noise.
  const ga = R(0, 6.28), gk = R(0, 0.35), gain = R(0.8, 1.15);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4, l = gain * (1 - gk / 2 + gk * (((x / W - 0.5) * Math.cos(ga) + (y / H - 0.5) * Math.sin(ga)) + 0.5));
    for (let c = 0; c < 3; c++) {
      const n = (rnd() + rnd() + rnd() - 1.5) * 2 * 4;
      img[p + c] = Math.max(0, Math.min(255, img[p + c] * l + n));
    }
  }
  let s = sharp(Buffer.from(img), { raw: { width: W, height: H, channels: 4 } });
  const sigma = R(0, 1.3);
  if (sigma > 0.35) s = s.blur(sigma);
  const jpg = await s.removeAlpha().jpeg({ quality: Math.round(R(65, 90)) }).toBuffer();
  const at = async (w, h) => new Uint8Array(await sharp(jpg).resize(w, h, { kernel: 'linear' }).ensureAlpha().raw().toBuffer());
  return { i, pos, style, quad: quad.map(([x, y]) => [x / W, y / H]), jpg, big: await at(320, 240), small: await at(160, 120) };
}

const bbox = (q) => { const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; };
function iou(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / (a[2] * a[3] + b[2] * b[3] - i);
}

// The old judge: any blob rectangle with score >= 0.55, anywhere. The new: a rectangle whose
// centre is in the brackets with score >= PASS.
const oldJudge = (c) => findShapes(luma(c.small, 160, 120).lum, 160, 120).find((s) => s.kind === 'rect' && s.score >= 0.55) || null;
const stats = {};
const newJudge = (c) => findRects(c.big, 320, 240, { stats }).filter((r) => inFocus(r) && r.score >= PASS)[0] || null;

const cases = [];
for (let i = 0; i < COUNT; i++) cases.push(await makeCase(i));
const rows = { old: {}, new: {} };
const misses = [], falses = [];
let ms = 0;
for (const c of cases) {
  for (const [name, judge] of [['old', oldJudge], ['new', newJudge]]) {
    const t0 = performance.now();
    const r = judge(c);
    if (name === 'new') ms += performance.now() - t0;
    const k = c.pos ? c.style : 'NOT A RECTANGLE';
    const row = (rows[name][k] = rows[name][k] || { n: 0, yes: 0, right: 0 });
    row.n++;
    if (r) { row.yes++; if (c.pos && iou(r.box, bbox(c.quad)) >= 0.5) row.right++; }
    if (name === 'new' && c.pos && !(r && iou(r.box, bbox(c.quad)) >= 0.5)) misses.push({ c, r });
    if (name === 'new' && !c.pos && r) falses.push({ c, r });
  }
}
const pct = (a, b) => `${Math.round((100 * a) / Math.max(1, b))}%`.padStart(4);
console.log(`${COUNT} pictures (${cases.filter((c) => c.pos).length} rectangles), new bar ${PASS}`);
console.log('kind'.padEnd(18), 'n'.padStart(4), '  old: found (right one)', '   new: found (right one)');
const kinds = [...new Set(cases.map((c) => (c.pos ? c.style : 'NOT A RECTANGLE')))].sort((a, b) => (a === 'NOT A RECTANGLE') - (b === 'NOT A RECTANGLE') || a.localeCompare(b));
let tot = { o: 0, n: 0, or: 0, nr: 0, N: 0 };
for (const k of kinds) {
  const o = rows.old[k], n = rows.new[k];
  console.log(k.padEnd(18), String(o.n).padStart(4), `   ${pct(o.yes, o.n)} (${pct(o.right, o.n)})`.padEnd(24), `   ${pct(n.yes, n.n)} (${pct(n.right, n.n)})`);
  if (k !== 'NOT A RECTANGLE') { tot.o += o.yes; tot.n += n.yes; tot.or += o.right; tot.nr += n.right; tot.N += o.n; }
}
console.log('ALL RECTANGLES'.padEnd(18), String(tot.N).padStart(4), `   ${pct(tot.o, tot.N)} (${pct(tot.or, tot.N)})`.padEnd(24), `   ${pct(tot.n, tot.N)} (${pct(tot.nr, tot.N)})`);
console.log(`new detector: ${(ms / cases.length).toFixed(1)} ms per picture at 320x240 in Node`);
{
  // Misses by cause: how many of the true sides became a line at all.
  const { edgeMap, findLines } = await import('../../src/vision/cv.js');
  const hist = [0, 0, 0, 0, 0];
  for (const { c } of misses) {
    const E = edgeMap(c.big, 320, 240), { lines, cx, cy } = findLines(E, {});
    const q = c.quad.map(([x, y]) => [x * 320 - cx, y * 240 - cy]);
    let got = 0;
    for (let k = 0; k < 4; k++) {
      const [a, b] = [q[k], q[(k + 1) % 4]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      if (lines.some((L) => Math.abs(L.nx * nx + L.ny * ny) >= Math.cos(0.12) && Math.max(Math.abs(a[0] * L.nx + a[1] * L.ny - L.rho), Math.abs(b[0] * L.nx + b[1] * L.ny - L.rho)) <= 4)) got++;
    }
    hist[got]++;
  }
  console.log(`misses by true sides found as lines (0..4): ${hist.join(' / ')}`);
}

if (SHEET) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, list] of [['misses', misses], ['false-rects', falses]]) {
    const tiles = [];
    for (const { c, r } of list.slice(0, 48)) {
      const rgba = new Uint8Array(c.big);
      const line = (q, col) => { for (let k = 0; k < 4; k++) { const [a, b] = [q[k], q[(k + 1) % 4]]; for (let t = 0; t <= 1; t += 0.002) { const x = Math.round((a[0] + (b[0] - a[0]) * t) * 320), y = Math.round((a[1] + (b[1] - a[1]) * t) * 240); if (x >= 0 && y >= 0 && x < 320 && y < 240) { const p = (y * 320 + x) * 4; rgba[p] = col[0]; rgba[p + 1] = col[1]; rgba[p + 2] = col[2]; } } } };
      line(c.quad, [0, 255, 0]);
      if (r) line(r.quad, [255, 0, 0]);
      tiles.push({ input: await sharp(Buffer.from(rgba), { raw: { width: 320, height: 240, channels: 4 } }).png().toBuffer(), label: `${c.i} ${c.style}${r ? ' ' + r.score.toFixed(2) : ''}` });
    }
    if (!tiles.length) continue;
    const cols = 6, rowsN = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * 324, height: rowsN * 244, channels: 3, background: '#222' } })
      .composite(tiles.map((t, k) => ({ input: t.input, left: (k % cols) * 324 + 2, top: Math.floor(k / cols) * 244 + 2 })))
      .png().toFile(path.join(OUT, `${name}.png`));
    console.log(`${name}: ${list.length} (sheet: tools/test/out/shapes/${name}.png; green = truth, red = found) ids ${list.slice(0, 48).map((x) => x.c.i + ':' + x.c.style).join(' ')}`);
  }
}

// --case N: why did picture N miss? Draws every line found and the true outline, and says,
// for each true side, which line matched it and how much of the side is covered.
const ci = process.argv.indexOf('--case');
if (ci > 0) {
  const { edgeMap, findLines } = await import('../../src/vision/cv.js');
  for (const id of process.argv[ci + 1].split(',').map(Number)) {
    const c = cases[id];
    const E = edgeMap(c.big, 320, 240), { lines, cx, cy } = findLines(E, {});
    const rgba = new Uint8Array(c.big);
    for (const i of E.list) { const p = i * 4; rgba[p] = 255; rgba[p + 1] = 255; rgba[p + 2] = 0; }
    const put = (x, y, col) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < 320 && y < 240) { const p = (y * 320 + x) * 4; rgba[p] = col[0]; rgba[p + 1] = col[1]; rgba[p + 2] = col[2]; } };
    for (const L of lines) for (let s = -200; s <= 200; s += 0.5) put(cx + L.rho * L.nx + s * L.dx, cy + L.rho * L.ny + s * L.dy, [0, 160, 255]);
    const q = c.quad.map(([x, y]) => [x * 320 - cx, y * 240 - cy]);
    for (let k = 0; k < 4; k++) { const [a, b] = [q[k], q[(k + 1) % 4]]; for (let t = 0; t <= 1; t += 0.003) put(cx + a[0] + (b[0] - a[0]) * t, cy + a[1] + (b[1] - a[1]) * t, [0, 255, 0]); }
    await sharp(Buffer.from(rgba), { raw: { width: 320, height: 240, channels: 4 } }).resize(640, 480, { kernel: 'nearest' }).png().toFile(path.join(OUT, `case-${id}.png`));
    console.log(`case ${id} ${c.style}: ${E.list.length} edge px (T ${E.T.toFixed(3)}), ${lines.length} lines`);
    for (let k = 0; k < 4; k++) {
      const [a, b] = [q[k], q[(k + 1) % 4]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      let best = null;
      for (const L of lines) {
        const dot = L.nx * nx + L.ny * ny;
        if (Math.abs(dot) < Math.cos(0.12)) continue;
        const off = Math.max(Math.abs(a[0] * L.nx + a[1] * L.ny - L.rho), Math.abs(b[0] * L.nx + b[1] * L.ny - L.rho));
        if (!best || off < best.off) best = { L, off };
      }
      if (!best || best.off > 4) { console.log(`  side ${k} (${Math.round(len)} px): NO LINE`); continue; }
      const s0 = a[0] * best.L.dx + a[1] * best.L.dy, s1 = b[0] * best.L.dx + b[1] * best.L.dy;
      const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
      const cov = (u, v) => { const A = Math.max(0, Math.round(u + best.L.R)), B = Math.min(best.L.pre.length - 1, Math.round(v + best.L.R)); return B > A ? (best.L.pre[B] - best.L.pre[A]) / (B - A) : 0; };
      console.log(`  side ${k} (${Math.round(len)} px): line votes ${best.L.votes.toFixed(0)}, off ${best.off.toFixed(1)} px, covered ${cov(lo + 0.06 * (hi - lo), hi - 0.06 * (hi - lo)).toFixed(2)}`);
    }
  }
}

// --why: for misses where all four true sides became lines, which check turned the shape down?
if (process.argv.includes('--why')) {
  const { edgeMap, findLines } = await import('../../src/vision/cv.js');
  const reasons = {};
  for (const { c } of misses) {
    const E = edgeMap(c.big, 320, 240), { lines, cx, cy } = findLines(E, {});
    const q = c.quad.map(([x, y]) => [x * 320 - cx, y * 240 - cy]);
    const match = [];
    for (let k = 0; k < 4; k++) {
      const [a, b] = [q[k], q[(k + 1) % 4]], len = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
      let best = null;
      for (const L of lines) { if (Math.abs(L.nx * nx + L.ny * ny) < Math.cos(0.12)) continue; const off = Math.max(Math.abs(a[0] * L.nx + a[1] * L.ny - L.rho), Math.abs(b[0] * L.nx + b[1] * L.ny - L.rho)); if (off <= 4 && (!best || off < best.off)) best = { L, off }; }
      match.push(best && best.L);
    }
    if (match.some((m) => !m)) continue;
    // Sides in quad order: q[0]-q[1] is match[0] ... ; corners are where consecutive sides meet.
    const meet = (p, r) => { const det = p.nx * r.ny - p.ny * r.nx; return [(p.rho * r.ny - p.ny * r.rho) / det, (p.nx * r.rho - p.rho * r.nx) / det]; };
    const along = (L, P) => P[0] * L.dx + P[1] * L.dy;
    const cov = (L, u, v) => { if (v < u) [u, v] = [v, u]; const A = Math.max(0, Math.round(u + L.R)), B = Math.min(L.pre.length - 1, Math.round(v + L.R)); return B > A ? (L.pre[B] - L.pre[A]) / (B - A) : 0; };
    const P = [0, 1, 2, 3].map((k) => meet(match[(k + 3) % 4], match[k]));
    const why = [];
    for (let k = 0; k < 4; k++) {
      for (const L of [match[(k + 3) % 4], match[k]]) { const s = along(L, P[k]); if (Math.max(cov(L, s - 28, s - 2), cov(L, s + 2, s + 28)) < 0.35) why.push('corner'); }
    }
    let maxCos = 0;
    for (let k = 0; k < 4; k++) { const p0 = P[(k + 3) % 4], p1 = P[k], p2 = P[(k + 1) % 4]; const ux = p0[0] - p1[0], uy = p0[1] - p1[1], vx = p2[0] - p1[0], vy = p2[1] - p1[1]; maxCos = Math.max(maxCos, Math.abs((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))); }
    if (maxCos > 0.64) why.push('angle ' + maxCos.toFixed(2));
    for (let k = 0; k < 4; k++) {
      const L = match[k], s0 = along(L, P[k]), s1 = along(L, P[(k + 1) % 4]), len = s1 - s0;
      const f = cov(L, s0 + 0.06 * len, s1 - 0.06 * len), e = Math.min(cov(L, s0 + 0.04 * len, s0 + 0.3 * len), cov(L, s1 - 0.3 * len, s1 - 0.04 * len));
      if (f < 0.45) why.push(`side ${f.toFixed(2)}`); else if (e < 0.25) why.push(`end ${e.toFixed(2)}`);
    }
    const key = why.length ? [...new Set(why.map((x) => x.split(' ')[0]))].join('+') : 'passes checks (ranking or score bar)';
    reasons[key] = (reasons[key] || 0) + 1;
    console.log(`  ${c.i} ${c.style}: ${why.join(', ') || 'passes checks'}`);
  }
  console.log(reasons);
}
