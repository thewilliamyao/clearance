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

// --- rectangles ---------------------------------------------------------------------------
// Real rectangles (a book, a screen, a door, a picture frame, a phone) rarely come out as one
// clean blob: they have print and pictures inside, shadows and rounded corners, and they're
// seen at an angle. So rectangles are found from their edges, the way document scanners do:
// gradients on brightness and on colour, a Hough transform for straight lines, then every
// pair of near-parallel lines crossed with another pair is tried as a four-sided shape and
// kept if all four sides are really there in the picture. Perspective is allowed (corners
// between about 50 and 130 degrees). Plain arithmetic, about 320x240 in the game.

const NT = 90; // Hough angle bins (2 degrees)

function smooth121(a, w, h) {
  const t = new Float32Array(a.length);
  for (let y = 0; y < h; y++) {
    const r = y * w;
    t[r] = (3 * a[r] + a[r + 1]) / 4;
    for (let x = 1; x < w - 1; x++) t[r + x] = (a[r + x - 1] + 2 * a[r + x] + a[r + x + 1]) / 4;
    t[r + w - 1] = (a[r + w - 2] + 3 * a[r + w - 1]) / 4;
  }
  for (let x = 0; x < w; x++) {
    a[x] = (3 * t[x] + t[x + w]) / 4;
    for (let y = 1; y < h - 1; y++) { const i = y * w + x; a[i] = (t[i - w] + 2 * t[i] + t[i + w]) / 4; }
    const i = (h - 1) * w + x; a[i] = (t[i - w] + 3 * t[i]) / 4;
  }
}

const binDiff = (a, b) => { const d = Math.abs(a - b) % NT; return Math.min(d, NT - d); };

// Edge pixels: the strongest gradient over brightness and two colour differences, thinned to
// one pixel (non-maximum suppression), above a threshold that follows the picture's contrast.
export function edgeMap(rgba, w, h) {
  const n = w * h;
  const Y = new Float32Array(n), U = new Float32Array(n), V = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    Y[i] = y; U[i] = (b - y) * 0.8; V[i] = (r - y) * 0.8;
  }
  smooth121(Y, w, h); smooth121(U, w, h); smooth121(V, w, h);
  const gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n);
  for (const C of [Y, U, V]) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = C[i - w - 1], b = C[i - w], c = C[i - w + 1], d = C[i - 1], f = C[i + 1], g = C[i + w - 1], k = C[i + w], l = C[i + w + 1];
      const sx = c + 2 * f + l - (a + 2 * d + g), sy = g + 2 * k + l - (a + 2 * b + c);
      const m = sx * sx + sy * sy;
      if (m > mag[i]) { mag[i] = m; gx[i] = sx; gy[i] = sy; }
    }
  }
  const hist = new Uint32Array(512);
  for (let i = 0; i < n; i++) { const m = Math.sqrt(mag[i]); mag[i] = m; hist[Math.min(511, (m * 128) | 0)]++; }
  let acc = 0, p90 = 0;
  for (let k = 0; k < 512; k++) { acc += hist[k]; if (acc >= n * 0.9) { p90 = k / 128; break; } }
  // Hysteresis, as in Canny: pixels above T are edges, and so are pixels above T/2 that join
  // up with them, so a boundary that fades in places isn't cut into pieces.
  const T = Math.max(0.07, Math.min(0.22, p90 * 0.4)), lo = T * 0.5;
  const edge = new Uint8Array(n), list = [], cand = new Uint8Array(n);
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, m = mag[i];
    if (m < lo) continue;
    const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    let m1, m2;
    if (ay <= ax * 0.4142) { m1 = mag[i - 1]; m2 = mag[i + 1]; }
    else if (ax <= ay * 0.4142) { m1 = mag[i - w]; m2 = mag[i + w]; }
    else if ((gx[i] > 0) === (gy[i] > 0)) { m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; }
    else { m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; }
    if (m < m1 || m <= m2) continue;
    cand[i] = m >= T ? 2 : 1;
  }
  const stack = [];
  for (let i = 0; i < n; i++) if (cand[i] === 2) stack.push(i);
  while (stack.length) {
    const i = stack.pop();
    if (edge[i]) continue;
    let th = Math.atan2(gy[i], gx[i]);
    if (th < 0) th += Math.PI;
    edge[i] = Math.min(NT - 1, Math.floor((th / Math.PI) * NT)) + 1;
    list.push(i);
    for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) { const j = i + d; if (cand[j] && !edge[j]) stack.push(j); }
  }
  return { w, h, edge, list, T };
}

// Straight lines through the edges: a Hough transform where each edge pixel only votes for
// angles near its own gradient, then each line is refitted to the pixels on it and gets a
// coverage profile (which stretches of it are really drawn), so any segment's support can be
// read off in constant time.
export function findLines(E, { max = 90, minVotes = 0 } = {}) {
  const { w, h, edge, list } = E;
  const cx = w / 2, cy = h / 2, R = Math.ceil(Math.hypot(w, h) / 2) + 2, NR = 2 * R + 1;
  const COS = new Float32Array(NT), SIN = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { const a = ((t + 0.5) / NT) * Math.PI; COS[t] = Math.cos(a); SIN[t] = Math.sin(a); }
  const acc = new Float32Array(NT * NR);
  const X = new Float32Array(list.length), Yc = new Float32Array(list.length), B = new Uint8Array(list.length);
  const byBin = Array.from({ length: NT }, () => []);
  list.forEach((i, k) => { X[k] = (i % w) - cx; Yc[k] = ((i / w) | 0) - cy; B[k] = edge[i] - 1; byBin[B[k]].push(k); });
  for (let k = 0; k < list.length; k++) {
    const x = X[k], y = Yc[k], b = B[k];
    for (let d = -2; d <= 2; d++) {
      const t = (b + d + NT) % NT;
      acc[t * NR + Math.round(x * COS[t] + y * SIN[t]) + R] += d === 0 ? 1 : 0.7;
    }
  }
  const need = minVotes || Math.max(10, Math.round(Math.min(w, h) * 0.05));
  const peaks = [];
  for (let t = 0; t < NT; t++) for (let r = 3; r < NR - 3; r++) {
    const v = acc[t * NR + r];
    if (v < need) continue;
    let top = true;
    for (let dt = -2; dt <= 2 && top; dt++) {
      const tt = (t + dt + NT) % NT, rr = t + dt < 0 || t + dt >= NT ? 2 * R - r : r;
      for (let dr = -3; dr <= 3; dr++) { if (!dt && !dr) continue; const u = acc[tt * NR + rr + dr]; if (u > v || (u === v && (dt < 0 || (!dt && dr < 0)))) { top = false; break; } }
    }
    if (top) peaks.push({ t, r: r - R, v });
  }
  peaks.sort((a, b) => b.v - a.v);
  // The same line seen twice: close angle and offset (across the 0/180 degree wrap the offset
  // changes sign).
  const same = (l, p) => {
    const d = Math.abs(l.t - p.t);
    if (d <= 2) return Math.abs(l.r - p.r) <= 4;
    if (NT - d <= 2) return Math.abs(l.r + p.r) <= 4;
    return false;
  };
  const near = (t, spread) => { const out = []; for (let d = -spread; d <= spread; d++) for (const k of byBin[(t + d + NT) % NT]) out.push(k); return out; };
  const lines = [];
  for (const p of peaks) {
    if (lines.length >= max) break;
    if (lines.some((l) => same(l, p))) continue;
    const cand = near(p.t, 7);
    // Refit to the edge pixels within 1.5 px with a matching gradient (total least squares).
    let a = ((p.t + 0.5) / NT) * Math.PI, nx = Math.cos(a), ny = Math.sin(a), rho = p.r;
    for (let pass = 0; pass < 2; pass++) {
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (const k of cand) {
        if (binDiff(B[k], p.t) > 5) continue;
        const x = X[k], y = Yc[k];
        if (Math.abs(x * nx + y * ny - rho) > 1.5) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
      if (n < 8) break;
      const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
      const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // direction of the line
      let mnx = -Math.sin(ang), mny = Math.cos(ang);
      if (mnx * nx + mny * ny < 0) { mnx = -mnx; mny = -mny; }
      nx = mnx; ny = mny; rho = mx * nx + my * ny;
    }
    // Coverage along the line: s runs along the direction (-ny, nx).
    const dx = -ny, dy = nx, cov = new Uint8Array(NR + 2);
    for (const k of cand) {
      const x = X[k], y = Yc[k];
      if (Math.abs(x * nx + y * ny - rho) > 1.6) continue;
      const s = x * dx + y * dy + R;
      cov[Math.max(0, Math.floor(s))] = 1; cov[Math.min(NR + 1, Math.ceil(s))] = 1;
    }
    const pre = new Uint16Array(NR + 3);
    for (let k = 0; k < NR + 2; k++) pre[k + 1] = pre[k] + cov[k];
    let th = Math.atan2(ny, nx); if (th < 0) th += Math.PI;
    lines.push({ t: p.t, r: p.r, nx, ny, rho, dx, dy, th, votes: p.v, pre, R });
  }
  return { lines, cx, cy };
}

// Fraction of the segment s0..s1 of a line that is drawn.
function cover(L, s0, s1) {
  if (s1 < s0) [s0, s1] = [s1, s0];
  const a = Math.max(0, Math.round(s0 + L.R)), b = Math.min(L.pre.length - 1, Math.round(s1 + L.R));
  return b > a ? (L.pre[b] - L.pre[a]) / (b - a) : 0;
}

const angDiff = (a, b) => { const d = Math.abs(a - b) % Math.PI; return Math.min(d, Math.PI - d); };
const meet = (p, q) => {
  const det = p.nx * q.ny - p.ny * q.nx;
  if (Math.abs(det) < 0.2) return null;
  return [(p.rho * q.ny - p.ny * q.rho) / det, (p.nx * q.rho - p.rho * q.nx) / det];
};
const along = (L, P) => P[0] * L.dx + P[1] * L.dy;

export function findRects(rgba, w, h, opts = {}) {
  const t0 = now();
  const E = opts.edges || edgeMap(rgba, w, h);
  const { lines, cx, cy } = findLines(E, opts);
  const n = lines.length, minSide = Math.max(10, Math.min(w, h) * 0.08), frame = w * h;
  // Corners: two lines at 40 degrees or more that meet inside the frame, each of them drawn
  // up to (or through) the meeting point. Rounded corners leave a gap, so look 2-28 px out.
  const corner = new Array(n * n).fill(null);
  const reaches = (L, P) => { const s = along(L, P); return Math.max(cover(L, s - 28, s - 2), cover(L, s + 2, s + 28)) >= 0.25; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = lines[i], b = lines[j];
    if (angDiff(a.th, b.th) < 0.7) continue; // ~40 degrees
    const P = meet(a, b);
    if (!P || P[0] < -cx - 2 || P[0] > cx + 2 || P[1] < -cy - 2 || P[1] > cy + 2) continue;
    if (!reaches(a, P) || !reaches(b, P)) continue;
    corner[i * n + j] = corner[j * n + i] = P;
  }
  // Four-sided shapes: two near-parallel lines a and b, and two more lines c and d that each
  // make a corner with both.
  const out = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = lines[i], b = lines[j];
    if (angDiff(a.th, b.th) > 0.55) continue; // opposite sides: within ~31 degrees
    if (Math.abs(a.nx * b.nx + a.ny * b.ny > 0 ? a.rho - b.rho : a.rho + b.rho) < minSide) continue;
    const S = [];
    for (let k = 0; k < n; k++) if (k !== i && k !== j && corner[i * n + k] && corner[j * n + k]) S.push(k);
    for (let x = 0; x < S.length; x++) for (let y = x + 1; y < S.length; y++) {
      const c = lines[S[x]], d = lines[S[y]];
      if (angDiff(c.th, d.th) > 0.55) continue;
      const P = [corner[i * n + S[x]], corner[j * n + S[x]], corner[j * n + S[y]], corner[i * n + S[y]]];
      // Convex, with corners between ~50 and ~130 degrees.
      let sign = 0, bad = false, maxCos = 0;
      for (let k = 0; k < 4 && !bad; k++) {
        const p0 = P[(k + 3) % 4], p1 = P[k], p2 = P[(k + 1) % 4];
        const ux = p0[0] - p1[0], uy = p0[1] - p1[1], vx = p2[0] - p1[0], vy = p2[1] - p1[1];
        const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
        if (lu < minSide || lv < minSide) { bad = true; break; }
        const sg = Math.sign(ux * vy - uy * vx);
        if (!sg || (sign && sg !== sign)) { bad = true; break; }
        sign = sg;
        maxCos = Math.max(maxCos, Math.abs((ux * vx + uy * vy) / (lu * lv)));
      }
      if (bad || maxCos > 0.64) continue;
      const area = polyArea(P);
      if (area < frame * 0.02 || area > frame * 0.92) continue;
      // Every side must really be there, including near both of its corners.
      const sides = [[c, P[0], P[1]], [b, P[1], P[2]], [d, P[2], P[3]], [a, P[3], P[0]]];
      let sum = 0, min = 1, ends = 1;
      for (const [L, p, q] of sides) {
        const s0 = along(L, p), s1 = along(L, q), len = s1 - s0;
        const f = cover(L, s0 + 0.06 * len, s1 - 0.06 * len);
        if (f < 0.45) { min = 0; break; }
        const e = Math.min(cover(L, s0 + 0.04 * len, s0 + 0.3 * len), cover(L, s1 - 0.3 * len, s1 - 0.04 * len));
        sum += f; min = Math.min(min, f); ends = Math.min(ends, e);
      }
      if (min < 0.45 || ends < 0.15) continue;
      const mean = sum / 4;
      const score = Math.max(0, Math.min(1, 0.45 * mean + 0.3 * min + 0.1 * ends + 0.15 * (1 - maxCos / 0.64)));
      const pts = P.map(([px, py]) => [(px + cx) / w, (py + cy) / h]);
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      out.push({
        kind: 'rect', score, area: area / frame, support: mean, minSupport: min, maxCos,
        hull: pts, quad: pts, cx: xs.reduce((s, v) => s + v, 0) / 4, cy: ys.reduce((s, v) => s + v, 0) / 4,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
      });
    }
  }
  // Best first; drop near-duplicates of a better one.
  out.sort((p, q) => q.score - p.score || q.area - p.area);
  const keep = [];
  for (const r of out) {
    if (keep.some((k) => boxIoU(k.box, r.box) > 0.7)) continue;
    keep.push(r);
    if (keep.length >= 8) break;
  }
  if (opts.stats) Object.assign(opts.stats, { ms: now() - t0, lines: n, edges: E.list.length, found: out.length });
  return keep;
}

function boxIoU(a, b) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]), x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / Math.max(1e-9, a[2] * a[3] + b[2] * b[3] - i);
}

// Is a shape's centre inside the brackets (with a little slack)?
export function inFocus(s, slack = 0.03) {
  const x = s.cx !== undefined ? s.cx : s.box[0] + s.box[2] / 2, y = s.cy !== undefined ? s.cy : s.box[1] + s.box[3] / 2;
  return x >= FOCUS.x0 - slack && x <= FOCUS.x1 + slack && y >= FOCUS.y0 - slack && y <= FOCUS.y1 + slack;
}

// Run every pure-CV check on one frame. big (optional): the same frame at about 320x240 for
// the rectangle finder, which needs the detail. only (optional): the checks to run, for the
// live viewfinder (any of color, blank, sym, light, blobs, rects); the rest come back empty.
export function analyzeCV(rgba, w, h, big, only) {
  const t0 = now();
  const want = (k) => !only || only.includes(k);
  const L = luma(rgba, w, h);
  const color = want('color') ? colorStats(rgba, w, h) : { frac: {}, mask: null, w, h, id: CID };
  const blank = want('blank') ? blankness(L.lum, w, h) : { std: 1, score: 0 };
  const sym = want('sym') ? symmetry(L.lum, w, h) : { score: 0, axis: 0.5, std: 0 };
  const light = want('light') ? lightSource(rgba, L.lum, w, h) : { frac: 0, restMean: 1, ok: false, score: 0, mask: null };
  const rects = !want('rects') ? [] : big ? findRects(big.rgba, big.w, big.h) : findRects(rgba, w, h);
  const blobs = want('blobs') ? findShapes(L.lum, w, h).filter((s) => s.kind !== 'rect') : [];
  const shapes = blobs.concat(rects);
  shapes.sort((a, b) => b.score * Math.sqrt(b.area) - a.score * Math.sqrt(a.area));
  return { w, h, mean: L.mean, color, blank, sym, light, shapes, ms: now() - t0 };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
