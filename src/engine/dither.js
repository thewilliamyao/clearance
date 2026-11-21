// Quantisers. The live view uses ordered (blue-noise) dithering because it holds still from
// frame to frame; developed photos use error diffusion (Atkinson / Floyd-Steinberg), which
// looks like a print but would crawl on live video.
import { BLUE, BLUE_N } from '../data/bluenoise.js';
import { rgb, unpack } from './screen.js';

const BLUE_MASK = BLUE_N - 1;

// Posterise with no dither: the crude first tier (hard blobs of ink and paper).
export function threshold(lum, n, out) {
  const m = n - 1;
  for (let i = 0; i < lum.length; i++) out[i] = Math.min(m, Math.max(0, Math.round(lum[i] * m)));
}

// 4x4 Bayer matrix: a regular cross-hatch that still reads at very low resolutions.
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

// Ordered dither. Blue noise (fine, even grain) from 160x120 up; Bayer below, where blue
// noise turns into static.
export function ordered(lum, w, h, n, out, kind = w >= 160 ? 'blue' : 'bayer') {
  const m = n - 1;
  for (let y = 0; y < h; y++) {
    const brow = (y & BLUE_MASK) * BLUE_N, yb = (y & 3) * 4;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = kind === 'blue' ? (BLUE[brow + (x & BLUE_MASK)] + 0.5) / 256 : BAYER4[yb + (x & 3)];
      const v = lum[i] * m + t;
      out[i] = Math.min(m, Math.max(0, v | 0));
    }
  }
}

// Atkinson diffusion (spreads 6/8 of the error: crisp, high-contrast, early-Macintosh print).
export function atkinson(lum, w, h, n, out) {
  const m = n - 1, e = Float32Array.from(lum);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const q = Math.min(m, Math.max(0, Math.round(e[i] * m)));
    out[i] = q;
    const err = (e[i] - q / m) / 8;
    if (x + 1 < w) e[i + 1] += err;
    if (x + 2 < w) e[i + 2] += err;
    if (y + 1 < h) {
      if (x > 0) e[i + w - 1] += err;
      e[i + w] += err;
      if (x + 1 < w) e[i + w + 1] += err;
    }
    if (y + 2 < h) e[i + 2 * w] += err;
  }
}

// Floyd-Steinberg (spreads all of the error: smoother tones, used for the 8-tone tier).
export function floyd(lum, w, h, n, out) {
  const m = n - 1, e = Float32Array.from(lum);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const q = Math.min(m, Math.max(0, Math.round(e[i] * m)));
    out[i] = q;
    const err = e[i] - q / m;
    if (x + 1 < w) e[i + 1] += (err * 7) / 16;
    if (y + 1 < h) {
      if (x > 0) e[i + w - 1] += (err * 3) / 16;
      e[i + w] += (err * 5) / 16;
      if (x + 1 < w) e[i + w + 1] += err / 16;
    }
  }
}

// Nearest-palette lookup table over 15-bit RGB (32x32x32), weighted for perceived difference.
export function buildLut(palette) {
  const P = [...palette].map(unpack);
  const lut = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const R = r * 8 + 4, Gc = g * 8 + 4, B = b * 8 + 4;
    let best = 0, bd = Infinity;
    for (let k = 0; k < P.length; k++) {
      const [pr, pg, pb] = P[k];
      const rm = (R + pr) / 2;
      const dr = R - pr, dg = Gc - pg, db = B - pb;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bd) { bd = d; best = k; }
    }
    lut[(r << 10) | (g << 5) | b] = best;
  }
  return lut;
}

// Ordered dither in colour: nudge each channel by the blue-noise threshold, then look up the
// nearest palette colour. rgbf holds 0..1 floats, three per pixel.
export function orderedPalette(rgbf, w, h, palette, lut, spread, out) {
  for (let y = 0; y < h; y++) {
    const brow = (y & BLUE_MASK) * BLUE_N;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = (BLUE[brow + (x & BLUE_MASK)] + 0.5) / 256 - 0.5;
      const o = t * spread;
      const r = clamp31((rgbf[i * 3] + o) * 31.99), g = clamp31((rgbf[i * 3 + 1] + o) * 31.99), b = clamp31((rgbf[i * 3 + 2] + o) * 31.99);
      out[i] = palette[lut[(r << 10) | (g << 5) | b]];
    }
  }
}

// Near-true colour: `bits` per channel with a blue-noise dither, so it still reads as pixels.
export function trueColor(rgbf, w, h, bits, out) {
  const levels = (1 << bits) - 1;
  for (let y = 0; y < h; y++) {
    const brow = (y & BLUE_MASK) * BLUE_N;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = (BLUE[brow + (x & BLUE_MASK)] + 0.5) / 256;
      const q = (v) => Math.round((Math.min(levels, (v * levels + t) | 0) / levels) * 255);
      out[i] = rgb(q(rgbf[i * 3]), q(rgbf[i * 3 + 1]), q(rgbf[i * 3 + 2]));
    }
  }
}

const clamp31 = (v) => (v < 0 ? 0 : v > 31 ? 31 : v | 0);
