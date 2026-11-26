// Makes a 64x64 blue-noise threshold map with the void-and-cluster method (Ulichney 1993)
// and writes it to src/data/bluenoise.js. Blue noise gives the live 1-bit view a fine,
// even grain that doesn't crawl when the camera holds still.
//
//   cd tools && npm run bluenoise
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const N = 64, SIZE = N * N, SIGMA = 1.5;
const OUT = fileURLToPath(new URL('../src/data/bluenoise.js', import.meta.url));

// Toroidal Gaussian, indexed by (dx, dy) offset.
const kern = new Float64Array(SIZE);
for (let dy = 0; dy < N; dy++) for (let dx = 0; dx < N; dx++) {
  const x = Math.min(dx, N - dx), y = Math.min(dy, N - dy);
  kern[dy * N + dx] = Math.exp(-(x * x + y * y) / (2 * SIGMA * SIGMA));
}
function splat(energy, i, sign) {
  const ix = i % N, iy = (i / N) | 0;
  for (let y = 0; y < N; y++) {
    const ky = ((y - iy + N) % N) * N;
    for (let x = 0; x < N; x++) energy[y * N + x] += sign * kern[ky + ((x - ix + N) % N)];
  }
}
function extreme(energy, bits, want, pickMax) {
  let best = -1, bv = pickMax ? -Infinity : Infinity;
  for (let i = 0; i < SIZE; i++) {
    if (bits[i] !== want) continue;
    const e = energy[i];
    if (pickMax ? e > bv : e < bv) { bv = e; best = i; }
  }
  return best;
}

// Seeded random initial pattern (~10% on).
let seed = 1234567;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const bits = new Uint8Array(SIZE);
let ones = 0;
while (ones < SIZE / 10) { const i = (rand() * SIZE) | 0; if (!bits[i]) { bits[i] = 1; ones++; } }
const energy = new Float64Array(SIZE);
for (let i = 0; i < SIZE; i++) if (bits[i]) splat(energy, i, 1);

// Even out the initial pattern: move the tightest cluster into the largest void until stable.
for (let guard = 0; guard < SIZE * 4; guard++) {
  const c = extreme(energy, bits, 1, true);
  bits[c] = 0; splat(energy, c, -1);
  const v = extreme(energy, bits, 0, false);
  bits[v] = 1; splat(energy, v, 1);
  if (v === c) break;
}

const rank = new Int32Array(SIZE).fill(-1);
// Phase 1: rank the initial ones by removing tightest clusters.
{
  const b = bits.slice(), e = energy.slice();
  for (let r = ones - 1; r >= 0; r--) {
    const c = extreme(e, b, 1, true);
    b[c] = 0; splat(e, c, -1); rank[c] = r;
  }
}
// Phase 2+3: fill the largest voids until every pixel has a rank.
{
  const b = bits.slice(), e = energy.slice();
  for (let r = ones; r < SIZE; r++) {
    const v = extreme(e, b, 0, false);
    b[v] = 1; splat(e, v, 1); rank[v] = r;
  }
}
const out = new Uint8Array(SIZE);
for (let i = 0; i < SIZE; i++) out[i] = Math.floor((rank[i] * 256) / SIZE);
const b64 = Buffer.from(out).toString('base64');
writeFileSync(OUT, `// 64x64 blue-noise thresholds (0-255), made by tools/make_bluenoise.mjs. Do not edit.
const B64 = '${b64}';
function decode(s) {
  const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary');
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}
export const BLUE_N = ${N};
export const BLUE = decode(B64);
`);
console.log(`wrote ${OUT}`);
