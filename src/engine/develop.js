// Turns camera pixels into the unit's picture: downsample to the sensor resolution, auto
// levels, a little sharpening, then quantise to the tone tier's tones or colours.
import { threshold, ordered, atkinson, floyd, orderedPalette, trueColor, buildLut } from './dither.js';
import { toneRamp, PAL16 } from './palette.js';

export class Developer {
  constructor() {
    this.lo = 0.08; this.hi = 0.92; this.primed = false;
    this.bufs = new Map();
    this.ramps = new Map();
    this.lut16 = null;
  }

  buf(key, Type, n) {
    let b = this.bufs.get(key);
    if (!b || b.length !== n) { b = new Type(n); this.bufs.set(key, b); }
    return b;
  }

  ramp(theme, n) {
    const k = theme.id + n;
    if (!this.ramps.has(k)) this.ramps.set(k, toneRamp(theme, n));
    return this.ramps.get(k);
  }

  // Area-average an RGBA image (sw x sh) down to w x h floats (0..1, three per pixel).
  downsample(src, sw, sh, w, h, key = 'rgb') {
    const out = this.buf(key + w, Float32Array, w * h * 3);
    const fx = sw / w, fy = sh / h;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1; yy++) {
          let p = (yy * sw + x0) * 4;
          for (let xx = x0; xx < x1; xx++, p += 4) { r += src[p]; g += src[p + 1]; b += src[p + 2]; n++; }
        }
        const o = (y * w + x) * 3, k = 1 / (255 * n);
        out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
      }
    }
    return out;
  }

  // Auto levels from the 1.5th and 98.5th percentile of luminance. Live frames ease toward
  // the new levels so the picture doesn't pump; stills use their own levels.
  levels(lum, live) {
    const hist = new Uint32Array(64);
    for (let i = 0; i < lum.length; i++) hist[Math.min(63, (lum[i] * 64) | 0)]++;
    const n = lum.length, loN = n * 0.015, hiN = n * 0.985;
    let acc = 0, lo = 0, hi = 1;
    for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc >= loN) { lo = b / 64; break; } }
    acc = 0;
    for (let b = 0; b < 64; b++) { acc += hist[b]; if (acc >= hiN) { hi = (b + 1) / 64; break; } }
    if (hi - lo < 0.3) { const m = (hi + lo) / 2; lo = Math.max(0, m - 0.15); hi = Math.min(1, m + 0.15); }
    if (!live) return [lo, hi];
    if (!this.primed) { this.lo = lo; this.hi = hi; this.primed = true; return [lo, hi]; }
    this.lo += (lo - this.lo) * 0.15; this.hi += (hi - this.hi) * 0.15;
    return [this.lo, this.hi];
  }

  // src: RGBA bytes (sw x sh). Returns w*h packed colours.
  process(src, sw, sh, w, h, tone, theme, live) {
    const rgbf = this.downsample(src, sw, sh, w, h);
    const n = w * h;
    const lum = this.buf('lum' + w, Float32Array, n);
    for (let i = 0; i < n; i++) lum[i] = 0.2126 * rgbf[i * 3] + 0.7152 * rgbf[i * 3 + 1] + 0.0722 * rgbf[i * 3 + 2];
    const [lo, hi] = this.levels(lum, live);
    const k = 1 / Math.max(0.05, hi - lo);
    const out = this.buf('out' + w + (live ? 'L' : 'S'), Uint32Array, n);

    if (tone.color) {
      for (let i = 0; i < n * 3; i++) rgbf[i] = Math.min(1, Math.max(0, (rgbf[i] - lo) * k));
      if (tone.color === 'pal16') {
        if (!this.lut16) this.lut16 = buildLut(PAL16);
        orderedPalette(rgbf, w, h, PAL16, this.lut16, 0.22, out);
      } else trueColor(rgbf, w, h, 5, out);
      return out;
    }

    for (let i = 0; i < n; i++) lum[i] = Math.min(1, Math.max(0, (lum[i] - lo) * k));
    if (w >= 64) sharpen(lum, w, h, w >= 160 ? 0.45 : 0.6, this.buf('blur' + w, Float32Array, n));
    const idx = this.buf('idx' + w, Uint8Array, n);
    const method = live ? tone.live : tone.still;
    if (method === 'threshold') threshold(lum, tone.levels, idx);
    else if (method === 'ordered') ordered(lum, w, h, tone.levels, idx);
    else if (method === 'atkinson') atkinson(lum, w, h, tone.levels, idx);
    else floyd(lum, w, h, tone.levels, idx);
    const ramp = this.ramp(theme, tone.levels);
    for (let i = 0; i < n; i++) out[i] = ramp[idx[i]];
    return out;
  }

  // The lowest grade (SENSOR I / TONE I: 40x30, two tones, no dither) as bits, 1 = paper:
  // exactly the picture process() prints at that grade. The shared index gets only this
  // (src/game/shared-index.js); the frame and sharper prints never leave the phone.
  bits(src, sw, sh, w = 40, h = 30) {
    const rgbf = this.downsample(src, sw, sh, w, h, 'bits');
    const n = w * h, lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.2126 * rgbf[i * 3] + 0.7152 * rgbf[i * 3 + 1] + 0.0722 * rgbf[i * 3 + 2];
    const [lo, hi] = this.levels(lum, false);
    const k = 1 / Math.max(0.05, hi - lo);
    for (let i = 0; i < n; i++) lum[i] = Math.min(1, Math.max(0, (lum[i] - lo) * k));
    const idx = new Uint8Array(n);
    threshold(lum, 2, idx);
    return idx;
  }
}

// Unsharp mask with a 3x3 box blur.
function sharpen(lum, w, h, amount, blur) {
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1), yp = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(w - 1, x + 1);
      blur[y * w + x] = (lum[ym * w + xm] + lum[ym * w + x] + lum[ym * w + xp] + lum[y * w + xm] + lum[y * w + x] +
        lum[y * w + xp] + lum[yp * w + xm] + lum[yp * w + x] + lum[yp * w + xp]) / 9;
    }
  }
  for (let i = 0; i < lum.length; i++) lum[i] = Math.min(1, Math.max(0, lum[i] + amount * (lum[i] - blur[i])));
}
