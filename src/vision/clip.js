// The INTENT module: MobileCLIP-S0's image encoder (int8 ONNX, 11.8 MB) in onnxruntime-web.
// Text prompts were embedded ahead of time (data/prompt-embeddings.json), so judging a photo
// is one image-encoder pass plus a few hundred dot products.
import { assetUrl, fetchBytes } from '../config.js';
import { GENERIC, CONCEPTS, PROFILE, LABELS, labelPrompt } from '../data/prompts.js';

const SIZE = 256;

export class Clip {
  constructor() { this.ort = null; this.session = null; this.bank = null; this.canvas = null; }
  get ready() { return !!(this.session && this.bank); }

  async load(onProgress) {
    const ortUrl = await assetUrl('ort');
    this.ort = await import(ortUrl);
    this.ort.env.wasm.wasmPaths = await assetUrl('ortWasm');
    this.ort.env.wasm.numThreads = 1;
    const bytes = await fetchBytes('clip', (p) => onProgress && onProgress(p * 0.9));
    this.session = await this.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    this.bank = await loadBank();
    if (onProgress) onProgress(1);
  }

  // MobileCLIP preprocessing: shortest side to 256, centre crop 256x256, scale to 0..1 (no mean/std).
  pixels(src, sw, sh) {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = SIZE; this.canvas.height = SIZE;
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    const s = Math.min(sw, sh);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(src, (sw - s) / 2, (sh - s) / 2, s, s, 0, 0, SIZE, SIZE);
    const d = this.ctx.getImageData(0, 0, SIZE, SIZE).data;
    const out = new Float32Array(3 * SIZE * SIZE), plane = SIZE * SIZE;
    for (let i = 0; i < plane; i++) {
      out[i] = d[i * 4] / 255; out[plane + i] = d[i * 4 + 1] / 255; out[2 * plane + i] = d[i * 4 + 2] / 255;
    }
    return out;
  }

  async embed(src, sw, sh) {
    const input = new this.ort.Tensor('float32', this.pixels(src, sw, sh), [1, 3, SIZE, SIZE]);
    const out = await this.session.run({ [this.session.inputNames[0]]: input });
    const t = out.image_embeds || out[this.session.outputNames[0]];
    return normalize(Float32Array.from(t.data));
  }

  vec(text) {
    const v = this.bank.get(text);
    if (!v) throw new Error(`prompt not embedded: "${text}" (run tools: npm run embed)`);
    return v;
  }

  // Probability that the photo shows the concept, against its opposites and plain scenes.
  concept(emb, id) {
    const c = CONCEPTS[id];
    const texts = [...c.pos, ...c.neg, ...GENERIC.filter((g) => !c.pos.includes(g))];
    const logits = texts.map((t) => 100 * dot(emb, this.vec(t)));
    const p = softmax(logits);
    let pos = 0, best = 0, bestText = c.pos[0];
    for (let i = 0; i < c.pos.length; i++) { pos += p[i]; if (p[i] > best) { best = p[i]; bestText = c.pos[i]; } }
    return { p: pos, best: bestText };
  }

  // The profile: a softmax over attributes. The model always has an opinion.
  profile(emb, k = 3) {
    const names = Object.keys(PROFILE);
    const logits = names.map((n) => 100 * Math.max(...PROFILE[n].map((t) => dot(emb, this.vec(t)))));
    const p = softmax(logits);
    return names.map((n, i) => ({ name: n, p: p[i] })).sort((a, b) => b.p - a.p).slice(0, k);
  }

  labels(emb, k = 5) {
    const logits = LABELS.map((l) => 100 * dot(emb, this.vec(labelPrompt(l))));
    const p = softmax(logits);
    return LABELS.map((l, i) => ({ label: l, p: p[i] })).sort((a, b) => b.p - a.p).slice(0, k);
  }
}

async function loadBank() {
  const res = await fetch(new URL('../../data/prompt-embeddings.json', import.meta.url));
  if (!res.ok) throw new Error('prompt embeddings missing');
  const j = await res.json();
  const bank = new Map();
  for (const [text, scale, b64] of j.items) {
    const bin = atob(b64), v = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) { const q = bin.charCodeAt(i); v[i] = (q > 127 ? q - 256 : q) * scale; }
    bank.set(text, normalize(v));
  }
  return bank;
}

export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function normalize(v) { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; }
export function softmax(xs) { const m = Math.max(...xs); const e = xs.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); }

// Pack an embedding as int8 for storage with a photo.
export function packEmb(v) {
  let max = 0; for (const x of v) max = Math.max(max, Math.abs(x));
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.round((v[i] / (max || 1)) * 127);
  return { q, s: (max || 1) / 127 };
}
export function unpackEmb(p) {
  if (!p) return null;
  const v = new Float32Array(p.q.length);
  for (let i = 0; i < v.length; i++) v[i] = p.q[i] * p.s;
  return normalize(v);
}
