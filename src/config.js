// Where runtimes and models come from. tools/fetch_models.sh puts copies in vendor/ and
// models/ (so the game works offline and on a Pi); without them it uses the public CDNs.

export const VERSION = '0.1';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist';
const MPM = 'https://storage.googleapis.com/mediapipe-models';

export const ASSETS = {
  mediapipe: { group: 'vendor', local: './vendor/mediapipe/vision_bundle.mjs', cdn: `${MP}/vision_bundle.mjs` },
  mediapipeWasm: { group: 'vendor', local: './vendor/mediapipe/wasm', cdn: `${MP}/wasm` },
  ort: { group: 'vendor', local: './vendor/ort/ort.wasm.min.mjs', cdn: `${ORT}/ort.wasm.min.mjs` },
  ortWasm: { group: 'vendor', local: './vendor/ort/', cdn: `${ORT}/` },
  objects: { group: 'models', local: './models/efficientdet_lite0_int8.tflite', cdn: `${MPM}/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite`, bytes: 4602795 },
  faces: { group: 'models', local: './models/blaze_face_short_range.tflite', cdn: `${MPM}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`, bytes: 229746 },
  affect: { group: 'models', local: './models/face_landmarker.task', cdn: `${MPM}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, bytes: 3758596 },
  // Local: weight-only int8 made by tools/quantize_clip.py (15.7 MB). CDN fallback: fp32 (45.5 MB).
  // Not the published int8 files: those are broken (cosine 0.1-0.3 with fp32).
  clip: { group: 'models', local: './models/mobileclip_s0_vision.onnx', cdn: 'https://huggingface.co/Xenova/mobileclip_s0/resolve/main/onnx/vision_model.onnx', bytes: 0 },
};

// Probe files: if these load, the local copies are there.
const PROBE = { vendor: './vendor/ort/ort.wasm.min.mjs', models: './models/blaze_face_short_range.tflite' };
const local = {};

async function hasLocal(group) {
  if (!(group in local)) {
    local[group] = fetch(PROBE[group], { method: 'HEAD', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  }
  return local[group];
}

export async function assetUrl(key) {
  const a = ASSETS[key];
  return (await hasLocal(a.group)) ? new URL(a.local, location.href).href : a.cdn;
}

// Fetch a model file with download progress (0..1).
export async function fetchBytes(key, onProgress) {
  const url = await assetUrl(key);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}) ${url}`);
  const total = Number(res.headers.get('content-length')) || ASSETS[key].bytes || 0;
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    if (onProgress && total) onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
