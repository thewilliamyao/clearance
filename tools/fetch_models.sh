#!/usr/bin/env bash
# Downloads the runtimes and models into vendor/ and models/ (both kept in the repo, so this is only
# needed to rebuild them).
# Without them the game still runs: it falls back to the same files on public CDNs.
#
#   bash tools/fetch_models.sh
#
# Sources (all official):
#   @mediapipe/tasks-vision 1.1.1 and onnxruntime-web 1.30.0 from the npm registry
#   MediaPipe models from storage.googleapis.com/mediapipe-models
#   MobileCLIP-S0 image encoder (fp32 ONNX) from huggingface.co/Xenova/mobileclip_s0, then
#   shrunk to 15.7 MB by tools/quantize_clip.py (needs Python; makes tools/.venv with onnx).
#   The published int8 builds of that model are broken (see quantize_clip.py).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MP_VER=1.1.1
ORT_VER=1.30.0

need() { command -v "$1" >/dev/null || { echo "needs $1"; exit 1; }; }
need npm; need curl; need tar

echo "== MediaPipe tasks-vision $MP_VER"
(cd "$TMP" && npm pack "@mediapipe/tasks-vision@$MP_VER" --silent >/dev/null && mkdir mp && tar xzf mediapipe-tasks-vision-$MP_VER.tgz -C mp)
mkdir -p "$HERE/vendor/mediapipe/wasm"
cp "$TMP/mp/package/vision_bundle.mjs" "$HERE/vendor/mediapipe/"
cp "$TMP/mp/package/wasm/vision_wasm_internal."{js,wasm} "$HERE/vendor/mediapipe/wasm/"
cp "$TMP/mp/package/wasm/vision_wasm_nosimd_internal."{js,wasm} "$HERE/vendor/mediapipe/wasm/"


echo "== onnxruntime-web $ORT_VER"
(cd "$TMP" && npm pack "onnxruntime-web@$ORT_VER" --silent >/dev/null && mkdir ort && tar xzf onnxruntime-web-$ORT_VER.tgz -C ort)
mkdir -p "$HERE/vendor/ort"
cp "$TMP/ort/package/dist/ort.wasm.min.mjs" "$TMP/ort/package/dist/ort-wasm-simd-threaded.mjs" "$TMP/ort/package/dist/ort-wasm-simd-threaded.wasm" "$HERE/vendor/ort/"

echo "== models"
mkdir -p "$HERE/models"
get() { # url file bytes
  local url="$1" out="$HERE/models/$2" bytes="$3"
  if [ -f "$out" ] && [ "$(wc -c < "$out" | tr -d ' ')" = "$bytes" ]; then echo "   have $2"; return; fi
  echo "   get  $2"
  curl -fsSL "$url" -o "$out.part"
  local got; got="$(wc -c < "$out.part" | tr -d ' ')"
  [ "$got" = "$bytes" ] || { echo "   size mismatch for $2: $got (expected $bytes)"; rm -f "$out.part"; exit 1; }
  mv "$out.part" "$out"
}
get https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite efficientdet_lite0_int8.tflite 4602795
get https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite blaze_face_short_range.tflite 229746
get https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task face_landmarker.task 3758596
get https://huggingface.co/Xenova/mobileclip_s0/resolve/main/onnx/vision_model.onnx mobileclip_s0_vision_fp32.onnx 45543630
rm -f "$HERE/models/mobileclip_s0_vision_int8.onnx"
if [ ! -f "$HERE/models/mobileclip_s0_vision.onnx" ]; then
  echo "   shrink MobileCLIP (weight-only int8)"
  if [ ! -x "$HERE/tools/.venv/bin/python" ]; then python3 -m venv "$HERE/tools/.venv" && "$HERE/tools/.venv/bin/pip" install -q --disable-pip-version-check onnx numpy; fi
  if "$HERE/tools/.venv/bin/python" "$HERE/tools/quantize_clip.py" "$HERE/models/mobileclip_s0_vision_fp32.onnx" "$HERE/models/mobileclip_s0_vision.onnx"; then
    rm -f "$HERE/models/mobileclip_s0_vision_fp32.onnx"
  else
    echo "   (no Python onnx: using the 45 MB fp32 model)"; mv "$HERE/models/mobileclip_s0_vision_fp32.onnx" "$HERE/models/mobileclip_s0_vision.onnx"
  fi
else
  rm -f "$HERE/models/mobileclip_s0_vision_fp32.onnx"
fi

echo "done: $(du -sh "$HERE/vendor" | cut -f1) vendor, $(du -sh "$HERE/models" | cut -f1) models"
