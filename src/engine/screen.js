// The 320x240 framebuffer. Everything the player sees is drawn here pixel by pixel, then
// scaled up with nearest-neighbour in CSS. 320x240 is also the size of the small SPI/DPI
// screens the hardware build would use, so this file ports almost as-is.

export const W = 320;
export const H = 240;

// Colours are packed as little-endian ABGR so they can be written straight into ImageData.
export const rgb = (r, g, b) => ((255 << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
export const hex = (s) => {
  const n = parseInt(s.replace('#', ''), 16);
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
};
export const unpack = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];
export function mix(a, b, t) {
  const A = unpack(a), B = unpack(b);
  // Mix in (roughly) linear light so mid tones don't go muddy.
  const ch = (x, y) => Math.round(255 * Math.pow((1 - t) * Math.pow(x / 255, 2.2) + t * Math.pow(y / 255, 2.2), 1 / 2.2));
  return rgb(ch(A[0], B[0]), ch(A[1], B[1]), ch(A[2], B[2]));
}

export class Screen {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.img = this.ctx ? this.ctx.createImageData(W, H) : { data: new Uint8ClampedArray(W * H * 4) };
    this.buf = new Uint32Array(this.img.data.buffer);
    this.saved = new Uint32Array(W * H);
  }

  present() { if (this.ctx) this.ctx.putImageData(this.img, 0, 0); }
  clear(c) { this.buf.fill(c); }
  snapshot() { this.saved.set(this.buf); }
  restore() { this.buf.set(this.saved); }

  pset(x, y, c) {
    x |= 0; y |= 0;
    if (x >= 0 && y >= 0 && x < W && y < H) this.buf[y * W + x] = c;
  }

  rect(x, y, w, h, c) {
    let x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) this.buf.fill(c, yy * W + x0, yy * W + x1);
  }

  hline(x0, x1, y, c) { if (x1 < x0) [x0, x1] = [x1, x0]; this.rect(x0, y, x1 - x0 + 1, 1, c); }
  vline(x, y0, y1, c) { if (y1 < y0) [y0, y1] = [y1, y0]; this.rect(x, y0, 1, y1 - y0 + 1, c); }

  frame(x, y, w, h, c) {
    this.hline(x, x + w - 1, y, c); this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c); this.vline(x + w - 1, y, y + h - 1, c);
  }

  // A 50% checkerboard of colour c: the 1-bit way to dim or shade an area.
  checker(x, y, w, h, c, phase = 0) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0 + ((yy + x0 + phase) & 1); xx < x1; xx += 2) this.buf[yy * W + xx] = c;
  }

  // 25% dots (every other pixel on every other row).
  dots(x, y, w, h, c) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0 + (y0 & 1); yy < y1; yy += 2) for (let xx = x0 + (x0 & 1); xx < x1; xx += 2) this.buf[yy * W + xx] = c;
  }

  // Bresenham line; dash = [on, off] lengths for dashed lines.
  line(x0, y0, x1, y1, c, dash) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    const period = dash ? dash[0] + dash[1] : 0;
    for (;;) {
      if (!dash || n % period < dash[0]) this.pset(x0, y0, c);
      n++;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  poly(pts, c, dash) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      this.line(a[0], a[1], b[0], b[1], c, dash);
    }
  }

  circle(cx, cy, r, c) {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) this.pset(cx + px, cy + py, c);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
  }

  disc(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) {
      const w = Math.floor(Math.sqrt(r * r - y * y + r * 0.8));
      this.hline(cx - w, cx + w, cy + y, c);
    }
  }

  // Corner brackets around a box (the surveillance "lock" look).
  brackets(x, y, w, h, c, len = 4) {
    x |= 0; y |= 0; w |= 0; h |= 0;
    const l = Math.max(2, Math.min(len, (w / 3) | 0, (h / 3) | 0));
    this.hline(x, x + l, y, c); this.vline(x, y, y + l, c);
    this.hline(x + w - l, x + w, y, c); this.vline(x + w, y, y + l, c);
    this.hline(x, x + l, y + h, c); this.vline(x, y + h - l, y + h, c);
    this.hline(x + w - l, x + w, y + h, c); this.vline(x + w, y + h - l, y + h, c);
  }

  // Draw a w*h array of packed colours, scaled up by an integer factor (nearest neighbour).
  blit(colors, w, h, dx, dy, scale = 1) {
    const buf = this.buf;
    for (let y = 0; y < h; y++) {
      for (let sy = 0; sy < scale; sy++) {
        const ty = dy + y * scale + sy;
        if (ty < 0 || ty >= H) continue;
        const row = ty * W;
        for (let x = 0; x < w; x++) {
          const c = colors[y * w + x];
          const tx0 = dx + x * scale;
          for (let sx = 0; sx < scale; sx++) {
            const tx = tx0 + sx;
            if (tx >= 0 && tx < W) buf[row + tx] = c;
          }
        }
      }
    }
  }

  // Nearest-neighbour blit into any destination rectangle.
  blitTo(colors, w, h, dx, dy, dw, dh) {
    const buf = this.buf;
    for (let y = 0; y < dh; y++) {
      const ty = dy + y;
      if (ty < 0 || ty >= H) continue;
      const sy = Math.min(h - 1, ((y * h) / dh) | 0);
      for (let x = 0; x < dw; x++) {
        const tx = dx + x;
        if (tx < 0 || tx >= W) continue;
        buf[ty * W + tx] = colors[sy * w + Math.min(w - 1, ((x * w) / dw) | 0)];
      }
    }
  }

  // Swap colour a for b inside a rectangle (used for inverted text and flash effects).
  invert(x, y, w, h, a, b) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = yy * W + xx, v = this.buf[i];
      this.buf[i] = v === a ? b : v === b ? a : v;
    }
  }
}
