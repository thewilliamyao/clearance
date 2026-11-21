// The CHROMA and FORM modules: plain computer vision, no models. Everything in this file is
// simple enough to run on an ESP32-S3 (color counting, connected components, convex hulls).
// Input is a small RGBA image (160x120 in the game). Output coordinates are 0..1.

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'white', 'gray', 'black'];
const CID = Object.fromEntries(COLORS.map((c, i) => [c, i + 1]));

// The focus area (the brackets in the viewfinder): the centre 60% x 60%.
export const FOCUS = { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };

function classify(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), v = max / 255;
  if (v < 0.16) return CID.black;
  const s = max === 0 ? 0 : (max - min) / max;
  if (s < 0.2) return v > 0.78 ? CID.white : CID.gray;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  h *= 60; if (h < 0) h += 360;
  if ((h >= 345 || h < 12) && s >= 0.45 && v >= 0.22) return CID.red;
  if (h >= 12 && h < 38 && s >= 0.5 && v >= 0.35) return CID.orange;
  if (h >= 38 && h < 68 && s >= 0.4 && v >= 0.35) return CID.yellow;
  if (h >= 68 && h < 165 && s >= 0.25 && v >= 0.18) return CID.green;
  if (h >= 165 && h < 255 && s >= 0.28 && v >= 0.18) return CID.blue;
  if (h >= 255 && h < 300 && s >= 0.25) return CID.purple;
  if (h >= 300 && h < 345 && s >= 0.3) return CID.pink;
  return 0;
}

// Fraction of the focus area in each named colour, plus a per-pixel class map for overlays.
export function colorStats(rgba, w, h) {
  const mask = new Uint8Array(w * h);
  const counts = new Float64Array(COLORS.length + 1);
  const x0 = Math.floor(w * FOCUS.x0), x1 = Math.ceil(w * FOCUS.x1), y0 = Math.floor(h * FOCUS.y0), y1 = Math.ceil(h * FOCUS.y1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, p = i * 4;
    const c = classify(rgba[p], rgba[p + 1], rgba[p + 2]);
    mask[i] = c;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) counts[c]++;
  }
  const area = (x1 - x0) * (y1 - y0);
  const frac = {};
  COLORS.forEach((c, i) => { frac[c] = counts[i + 1] / area; });
  return { frac, mask, w, h, id: CID };
}

export function luma(rgba, w, h) {
  const lum = new Float32Array(w * h);
  let sum = 0, clip = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    lum[i] = l; sum += l;
    if (Math.max(r, g, b) >= 250) clip++;
  }
  const mean = sum / (w * h);
  return { lum, mean, clip: clip / (w * h) };
}

// Box-average a luminance image down by an integer factor.
export function shrink(lum, w, h, f) {
  const sw = Math.floor(w / f), sh = Math.floor(h / f), out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) s += lum[(y * f + yy) * w + x * f + xx];
    out[y * sw + x] = s / (f * f);
  }
  return { lum: out, w: sw, h: sh };
}

function std(a) {
  let m = 0; for (const v of a) m += v; m /= a.length;
  let s = 0; for (const v of a) s += (v - m) * (v - m);
  return Math.sqrt(s / a.length);
}

// "NOTHING": a near-uniform frame (a blank wall, the sky, a covered lens).
export function blankness(lum, w, h) {
  const s = shrink(lum, w, h, 4);
  const sd = std(s.lum);
  return { std: sd, score: Math.max(0, Math.min(1, 1 - sd / 0.09)) };
}

// Mirror symmetry about a vertical axis near the centre: best Pearson correlation between
// the frame and its mirror image, over small shifts of the axis.
export function symmetry(lum, w, h) {
  const s = shrink(lum, w, h, 4); // 40x30
  const L = s.lum, sw = s.w, sh = s.h;
  const sd = std(L);
  let best = -1, bestAxis = sw / 2;
  for (let d = -4; d <= 4; d++) {
    const axis = sw / 2 + d; // mirror x -> 2*axis - 1 - x
    let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < axis; x++) {
      const mx = Math.round(2 * axis - 1 - x);
      if (mx <= x || mx >= sw) continue;
      const a = L[y * sw + x], b = L[y * sw + mx];
      n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
    if (n < sw * sh * 0.3) continue;
    const cov = sab / n - (sa / n) * (sb / n);
    const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    const r = cov / Math.sqrt(Math.max(1e-9, va * vb));
    if (r > best) { best = r; bestAxis = axis; }
  }
  return { score: sd < 0.05 ? 0 : best, axis: bestAxis / sw, std: sd };
}

// A light source: some clipped highlights in an otherwise darker frame.
export function lightSource(rgba, lum, w, h) {
  let clip = 0, rest = 0, restN = 0;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    if (Math.max(rgba[p], rgba[p + 1], rgba[p + 2]) >= 248 && lum[i] > 0.9) { clip++; mask[i] = 1; } else { rest += lum[i]; restN++; }
  }
  const frac = clip / (w * h), restMean = restN ? rest / restN : 1;
  const ok = frac >= 0.003 && frac <= 0.4 && restMean < 0.62;
  const score = ok ? Math.min(1, 0.6 + (0.62 - restMean)) : 0;
  return { frac, restMean, ok, score, mask };
}

// --- shapes -------------------------------------------------------------------------------

function otsu(lum) {
  const hist = new Float64Array(256);
  for (const v of lum) hist[Math.min(255, (v * 256) | 0)]++;
  const total = lum.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return (t + 0.5) / 256;
}

function blur3(lum, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += lum[yy * w + xx]; n++;
    }
    out[y * w + x] = s / n;
  }
  return out;
}

// Andrew's monotone chain.
export function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

function polyArea(h) { let a = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }
function polyPerim(h) { let s = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); } return s; }

// Minimum-area enclosing rectangle by rotating calipers over the hull edges.
export function minAreaRect(h) {
  let best = { area: Infinity };
  for (let i = 0; i < h.length; i++) {
    const p = h[i], q = h[(i + 1) % h.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) continue;
    const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len, vx = -uy, vy = ux;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const r of h) {
      const u = r[0] * ux + r[1] * uy, v = r[0] * vx + r[1] * vy;
      if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) {
      const pt = (u, v) => [u * ux + v * vx, u * uy + v * vy];
      best = { area, a: maxU - minU, b: maxV - minV, corners: [pt(minU, minV), pt(maxU, minV), pt(maxU, maxV), pt(minU, maxV)] };
    }
  }
  return best;
}

// Find rectangles, circles and triangles: threshold (Otsu), clean up, label connected regions
// of ink and of paper, and measure each region's convex hull and minimum bounding rectangle.
export function findShapes(lum, w, h) {
  const bl = blur3(lum, w, h);
  const t = otsu(bl);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = bl[i] < t ? 1 : 0;
  // Majority filter to remove speckle.
  const clean = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += bin[yy * w + xx]; n++;
    }
    clean[y * w + x] = s * 2 > n ? 1 : 0;
  }

  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const comps = [];
  for (let start = 0; start < w * h; start++) {
    if (labels[start] !== -1) continue;
    const id = comps.length, val = clean[start];
    let sp = 0, area = 0, minx = w, maxx = 0, miny = h, maxy = 0, border = false;
    stack[sp++] = start; labels[start] = id;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      area++;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0 && labels[i - 1] === -1 && clean[i - 1] === val) { labels[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && labels[i + 1] === -1 && clean[i + 1] === val) { labels[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && labels[i - w] === -1 && clean[i - w] === val) { labels[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && labels[i + w] === -1 && clean[i + w] === val) { labels[i + w] = id; stack[sp++] = i + w; }
    }
    comps.push({ id, val, area, minx, maxx, miny, maxy, border });
  }

  const total = w * h, out = [];
  for (const c of comps) {
    const frac = c.area / total;
    if (c.border || frac < 0.012 || frac > 0.45) continue;
    const pts = [];
    for (let y = c.miny; y <= c.maxy; y++) {
      let lo = -1, hi = -1;
      for (let x = c.minx; x <= c.maxx; x++) if (labels[y * w + x] === c.id) { if (lo < 0) lo = x; hi = x; }
      if (lo < 0) continue;
      pts.push([lo, y], [hi + 1, y], [lo, y + 1], [hi + 1, y + 1]);
    }
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const hullArea = polyArea(hull), perim = polyPerim(hull);
    const rect = minAreaRect(hull);
    const solidity = c.area / hullArea;
    const rectangularity = c.area / rect.area;
    const circularity = (4 * Math.PI * hullArea) / (perim * perim);
    const aspect = Math.max(rect.a, rect.b) / Math.max(1e-6, Math.min(rect.a, rect.b));
    let kind = null, score = 0;
    if (rectangularity >= 0.86 && solidity >= 0.92 && aspect <= 6) { kind = 'rect'; score = 0.55 + 0.45 * Math.min(1, (rectangularity - 0.86) / 0.12); }
    else if (circularity >= 0.87 && solidity >= 0.92 && rectangularity >= 0.7 && rectangularity <= 0.84 && aspect <= 1.8) { kind = 'circle'; score = 0.55 + 0.45 * Math.min(1, (circularity - 0.87) / 0.1); }
    else if (solidity >= 0.88 && rectangularity >= 0.42 && rectangularity <= 0.64 && circularity >= 0.45 && circularity <= 0.8) { kind = 'triangle'; score = 0.55 + 0.45 * Math.min(1, (solidity - 0.88) / 0.1); }
    if (!kind) continue;
    out.push({
      kind, score, area: frac, solidity, rectangularity, circularity, aspect,
      hull: hull.map(([x, y]) => [x / w, y / h]),
      rect: rect.corners.map(([x, y]) => [x / w, y / h]),
      box: [c.minx / w, c.miny / h, (c.maxx + 1 - c.minx) / w, (c.maxy + 1 - c.miny) / h],
    });
  }
  out.sort((a, b) => b.score * Math.sqrt(b.area) - a.score * Math.sqrt(a.area));
  return out.slice(0, 6);
}

// Run every pure-CV check on one frame.
export function analyzeCV(rgba, w, h) {
  const t0 = now();
  const L = luma(rgba, w, h);
  const color = colorStats(rgba, w, h);
  const blank = blankness(L.lum, w, h);
  const sym = symmetry(L.lum, w, h);
  const light = lightSource(rgba, L.lum, w, h);
  const shapes = findShapes(L.lum, w, h);
  return { w, h, mean: L.mean, color, blank, sym, light, shapes, ms: now() - t0 };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
