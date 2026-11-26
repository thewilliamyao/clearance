// The unit's recognition modules. CHROMA and FORM are plain code and always ready; the rest
// download a model the first time they're needed, so the game starts with nothing to load.
import { MediaPipe } from './mp.js';
import { Clip } from './clip.js';
import { analyzeCV } from './cv.js';

export const MODULES = {
  chroma: { code: 'C', name: 'CHROMA', what: 'READS COLOUR', mb: 0, tech: 'HSV COUNTING' },
  form: { code: 'F', name: 'FORM', what: 'READS SHAPE', mb: 0, tech: 'CONVEX HULLS' },
  objects: { code: 'O', name: 'INVENTORY', what: 'KNOWS 80 KINDS OF THING', mb: 4.6, tech: 'EFFICIENTDET-LITE0' },
  faces: { code: 'P', name: 'CENSUS', what: 'FINDS AND TRACKS FACES', mb: 0.2, tech: 'BLAZEFACE' },
  affect: { code: 'A', name: 'SENTIMENT', what: 'READS 52 FACE MOVEMENTS', mb: 3.8, tech: 'FACE LANDMARKER' },
  intent: { code: 'I', name: 'INTENT', what: 'JUDGES ANYTHING IN WORDS', mb: 15.7, tech: 'MOBILECLIP-S0' },
};
export const MODULE_ORDER = Object.keys(MODULES);
// One-time runtime downloads behind the models.
export const RUNTIME_MB = { mediapipe: 13.5, ort: 14.2 };

export class Modules {
  constructor() {
    this.mp = new MediaPipe();
    this.clip = new Clip();
    this.st = {};
    for (const id of MODULE_ORDER) this.st[id] = { state: id === 'chroma' || id === 'form' ? 'ready' : 'off', progress: 0, ms: 0, error: '' };
    this.cvCanvas = null;
  }

  ready(id) { return this.st[id].state === 'ready'; }
  loading() { return MODULE_ORDER.filter((id) => this.st[id].state === 'loading'); }

  ensure(id) {
    const s = this.st[id];
    if (s.state === 'ready') return Promise.resolve(true);
    if (s.state === 'loading') return s.promise;
    s.state = 'loading'; s.progress = 0; s.error = '';
    const t0 = performance.now();
    const onProgress = (p) => { s.progress = p; };
    const load = {
      objects: () => this.mp.loadObjects(onProgress),
      faces: () => this.mp.loadFaces(onProgress),
      affect: () => this.mp.loadAffect(onProgress),
      intent: () => this.clip.load(onProgress),
    }[id];
    s.promise = load().then(() => { s.state = 'ready'; s.progress = 1; s.ms = performance.now() - t0; return true; })
      .catch((e) => { console.error(`module ${id} failed`, e); s.state = 'error'; s.error = String((e && e.message) || e).slice(0, 200); return false; });
    return s.promise;
  }

  // Run every installed module on a still (a canvas, normally 640x480).
  async analyze(canvas, enabled) {
    const w = canvas.width, h = canvas.height;
    const A = { ms: {} };
    if (!this.cvCanvas) {
      this.cvCanvas = document.createElement('canvas');
      this.cvCanvas.width = 160; this.cvCanvas.height = 120;
      this.cvCtx = this.cvCanvas.getContext('2d', { willReadFrequently: true });
      this.bigCanvas = document.createElement('canvas'); // the rectangle finder wants more detail
      this.bigCanvas.width = 320; this.bigCanvas.height = 240;
      this.bigCtx = this.bigCanvas.getContext('2d', { willReadFrequently: true });
    }
    for (const c of [this.cvCtx, this.bigCtx]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; }
    this.cvCtx.drawImage(canvas, 0, 0, 160, 120);
    this.bigCtx.drawImage(canvas, 0, 0, 320, 240);
    A.cv = analyzeCV(this.cvCtx.getImageData(0, 0, 160, 120).data, 160, 120, { rgba: this.bigCtx.getImageData(0, 0, 320, 240).data, w: 320, h: 240 });
    A.ms.cv = A.cv.ms;
    const on = (id) => enabled.includes(id) && this.ready(id);
    const time = (key, f) => { const t = performance.now(); const r = f(); A.ms[key] = performance.now() - t; return r; };
    try { if (on('objects')) A.objects = time('objects', () => this.mp.detectObjects(canvas, w, h)); } catch (e) { console.error(e); }
    try { if (on('faces')) A.faces = time('faces', () => this.mp.detectFaces(canvas, w, h)); } catch (e) { console.error(e); }
    try { if (on('affect')) A.affect = time('affect', () => this.mp.detectAffect(canvas)); } catch (e) { console.error(e); }
    if (on('intent')) {
      try {
        const t = performance.now();
        A.emb = await this.clip.embed(canvas, w, h);
        A.ms.intent = performance.now() - t;
        A.profile = this.clip.profile(A.emb);
      } catch (e) { console.error(e); }
    }
    return A;
  }
}
