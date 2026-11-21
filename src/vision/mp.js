// The INVENTORY, CENSUS and SENTIMENT modules: Google MediaPipe Tasks (TFLite models in WASM,
// on the GPU through WebGL when the phone allows it).
//   objects: EfficientDet-Lite0 int8 (COCO, 80 classes)    4.6 MB
//   faces:   BlazeFace short range                         0.2 MB
//   affect:  Face Landmarker: 478 points + 52 blendshapes   3.8 MB
import { assetUrl, fetchBytes } from '../config.js';

let vision = null, fileset = null;

async function base() {
  if (!fileset) {
    vision = await import(await assetUrl('mediapipe'));
    fileset = await vision.FilesetResolver.forVisionTasks(await assetUrl('mediapipeWasm'));
  }
}

async function create(Klass, options, prefer) {
  const tryWith = (delegate) => Klass.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate } });
  if (prefer === 'CPU') return { task: await tryWith('CPU'), delegate: 'CPU' };
  try { return { task: await tryWith('GPU'), delegate: 'GPU' }; }
  catch (e) { console.warn('GPU delegate unavailable, using CPU:', e && e.message); return { task: await tryWith('CPU'), delegate: 'CPU' }; }
}

export class MediaPipe {
  // CPU (XNNPACK) by default: the int8 detector has no GPU path, and the GPU delegate varies
  // a lot between phones. ?gpu=1 tries WebGL first.
  constructor() {
    this.objects = null; this.faces = null; this.affect = null; this.ts = 0; this.delegate = {};
    this.prefer = typeof location !== 'undefined' && new URLSearchParams(location.search).get('gpu') === '1' ? 'GPU' : 'CPU';
  }

  stamp() { this.ts = Math.max(this.ts + 1, Math.floor(performance.now())); return this.ts; }

  async loadObjects(onProgress) {
    const buf = await fetchBytes('objects', onProgress);
    await base();
    const r = await create(vision.ObjectDetector, { baseOptions: { modelAssetBuffer: buf }, runningMode: 'VIDEO', scoreThreshold: 0.3, maxResults: 12 }, this.prefer);
    this.objects = r.task; this.delegate.objects = r.delegate;
  }

  async loadFaces(onProgress) {
    const buf = await fetchBytes('faces', onProgress);
    await base();
    const r = await create(vision.FaceDetector, { baseOptions: { modelAssetBuffer: buf }, runningMode: 'VIDEO', minDetectionConfidence: 0.5 }, this.prefer);
    this.faces = r.task; this.delegate.faces = r.delegate;
  }

  async loadAffect(onProgress) {
    const buf = await fetchBytes('affect', onProgress);
    await base();
    const r = await create(vision.FaceLandmarker, {
      baseOptions: { modelAssetBuffer: buf }, runningMode: 'IMAGE', numFaces: 4,
      outputFaceBlendshapes: true, minFaceDetectionConfidence: 0.45,
    }, this.prefer);
    this.affect = r.task; this.delegate.affect = r.delegate;
  }

  // Boxes come back normalised to 0..1 of the source.
  detectObjects(src, w, h) {
    if (!this.objects) return null;
    const res = this.objects.detectForVideo(src, this.stamp());
    return (res.detections || []).map((d) => {
      const b = d.boundingBox, c = d.categories[0];
      return { label: c.categoryName, score: c.score, box: [b.originX / w, b.originY / h, b.width / w, b.height / h] };
    });
  }

  detectFaces(src, w, h) {
    if (!this.faces) return null;
    const res = this.faces.detectForVideo(src, this.stamp());
    return (res.detections || []).map((d) => {
      const b = d.boundingBox;
      return { score: d.categories[0].score, box: [b.originX / w, b.originY / h, b.width / w, b.height / h] };
    });
  }

  detectAffect(src) {
    if (!this.affect) return null;
    const res = this.affect.detect(src);
    return (res.faceLandmarks || []).map((lm, i) => {
      const blend = {};
      const cats = res.faceBlendshapes && res.faceBlendshapes[i] ? res.faceBlendshapes[i].categories : [];
      for (const c of cats) blend[c.categoryName] = c.score;
      return summarizeFace(lm, blend);
    });
  }
}

// Turn landmarks and blendshapes into the Office's readings.
export function summarizeFace(lm, blend) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  const g = (n) => blend[n] || 0;
  const nose = lm[1], left = lm[234], right = lm[454], top = lm[10], chin = lm[152];
  const half = Math.max(1e-4, Math.abs(right.x - left.x) / 2);
  const yaw = (nose.x - (left.x + right.x) / 2) / half; // -1..1, 0 = facing the lens
  const vhalf = Math.max(1e-4, Math.abs(chin.y - top.y) / 2);
  const pitch = (nose.y - (top.y + chin.y) / 2) / vhalf;
  const smile = (g('mouthSmileLeft') + g('mouthSmileRight')) / 2;
  const frown = (g('mouthFrownLeft') + g('mouthFrownRight')) / 2;
  const blinkL = g('eyeBlinkLeft'), blinkR = g('eyeBlinkRight');
  const jaw = g('jawOpen');
  const browUp = Math.max(g('browInnerUp'), (g('browOuterUpLeft') + g('browOuterUpRight')) / 2);
  const browDown = (g('browDownLeft') + g('browDownRight')) / 2;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return {
    box: [x0, y0, x1 - x0, y1 - y0],
    eyes: [[lm[33].x, lm[33].y], [lm[263].x, lm[263].y]],
    mouth: [lm[13].x, lm[14].y],
    yaw, pitch,
    // The nose-offset ratio grows quickly as the head turns (it passes 1 by about 45°), so
    // map it roughly linearly and cap it. 0.5 is about 19°.
    yawDeg: Math.round(Math.max(-1.6, Math.min(1.6, yaw)) * 38),
    smile, frown, jaw, browUp, browDown,
    eyesClosed: Math.min(blinkL, blinkR),
    read: {
      JOY: clamp(smile),
      SURPRISE: clamp(jaw * 0.7 + browUp * 0.6 - smile * 0.3),
      DISTRESS: clamp(frown * 1.6 + browDown * 0.5 + g('browInnerUp') * 0.3 - smile),
      FATIGUE: clamp(((blinkL + blinkR) / 2) * 0.9 + (g('eyeSquintLeft') + g('eyeSquintRight')) * 0.15),
    },
  };
}
