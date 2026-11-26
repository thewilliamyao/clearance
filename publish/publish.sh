#!/bin/bash
# Publish Clearance (this repo, thewilliamyao/clearance-source) to the public repo thewilliamyao/clearance, which
# GitHub Pages serves at https://thewilliamyao.github.io/clearance/.
#
#   publish/publish.sh                 # publish what's on disk
#   publish/publish.sh --dry-run       # build the commit in a temp folder, don't push
#   publish/publish.sh --edits=online  # (or =local) see "William's edits" below
#
# Only what the game needs goes out: index.html, the manifest, src/, data/, icons/, vendor/
# and models/ (both made by tools/fetch_models.sh), the shared index's page (index/), the
# controller (editor/; anyone can open it, only William's GitHub token can save), William's
# edits (content/edits.json), the public README, NOTICES.md and the licence texts, and
# screenshots without faces. Never the rest of the source branch (server/, the Worker,
# is deployed with wrangler instead).
# Each publish is one ordinary commit on the public repo's main branch, which Pages serves.
#
# William's edits: the online controller (editor/ on the public site) saves straight to the
# public repo's content/edits.json, so that copy can be newer than this repo's. Whichever
# side changed since the last publish wins (an online change is copied back into this
# workspace); if both changed, the script stops and --edits=online or --edits=local decides.
#
# A machine without vendor/ and models/ (a cloud session) keeps the public repo's copies.
set -euo pipefail

REMOTE="${CLEARANCE_REMOTE:-https://github.com/thewilliamyao/clearance.git}"
DRY=0; EDITS=""
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --edits=online|--edits=local) EDITS="${a#--edits=}" ;;
    *) echo "Unknown option $a"; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
REV="$(git -C "$APP" rev-parse --short HEAD)" # this repo's commit (thewilliamyao/clearance-source)
OUT="$(mktemp -d)"
trap '[ "$DRY" = 1 ] || rm -rf "$OUT"' EXIT

copy_dir() { # copy a folder into $OUT without macOS litter
  if command -v rsync >/dev/null; then rsync -a --exclude '.DS_Store' "$APP/$1" "$OUT/"
  else cp -R "$APP/$1" "$OUT/"; find "$OUT/$1" -name .DS_Store -delete; fi
}

MODELS=(efficientdet_lite0_int8.tflite blaze_face_short_range.tflite face_landmarker.task mobileclip_s0_vision.onnx)
HAVE_MODELS=1
for f in "${MODELS[@]}"; do [ -f "$APP/models/$f" ] || HAVE_MODELS=0; done
[ -f "$APP/vendor/ort/ort-wasm-simd-threaded.wasm" ] && [ -f "$APP/vendor/mediapipe/wasm/vision_wasm_internal.wasm" ] || HAVE_MODELS=0

# Start from the public repo as it is (an empty new repo clones fine).
git clone -q "$REMOTE" "$OUT" 2>/dev/null || { echo "Can't clone $REMOTE: does the repo exist?"; exit 1; }
if git -C "$OUT" rev-parse -q --verify origin/main >/dev/null; then
  git -C "$OUT" checkout -q -B main origin/main
else
  git -C "$OUT" checkout -q --orphan main
fi

if [ "$HAVE_MODELS" = 0 ]; then
  if git -C "$OUT" cat-file -e HEAD:models/mobileclip_s0_vision.onnx 2>/dev/null && git -C "$OUT" cat-file -e HEAD:vendor/ort/ort-wasm-simd-threaded.wasm 2>/dev/null; then
    echo "vendor/ and models/ aren't on this machine: keeping the public repo's copies."
  else
    echo "models/ or vendor/ is missing (and the public repo has none): run tools/fetch_models.sh"; exit 1
  fi
fi

# William's edits: which copy goes out (see the top of this file).
canon() { python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1])), sort_keys=True))' "$1" 2>/dev/null || echo "unreadable:$1"; }
LOCAL_EDITS="$APP/content/edits.json"
if [ -f "$OUT/content/edits.json" ]; then
  ONLINE="$(mktemp)"; BASE="$(mktemp)"
  cp "$OUT/content/edits.json" "$ONLINE"
  LAST="$(git -C "$OUT" log --format=%H --grep='^Publish Clearance' -n1 || true)"
  if [ -n "$LAST" ] && git -C "$OUT" cat-file -e "$LAST:content/edits.json" 2>/dev/null; then git -C "$OUT" show "$LAST:content/edits.json" > "$BASE"; else echo '{"v": 1}' > "$BASE"; fi
  O="$(canon "$ONLINE")"; L="$(canon "$LOCAL_EDITS")"; B="$(canon "$BASE")"
  if [ "$O" != "$L" ]; then
    if [ "$EDITS" = online ] || { [ -z "$EDITS" ] && [ "$L" = "$B" ]; }; then
      cp "$ONLINE" "$LOCAL_EDITS"
      echo "content/edits.json: the online controller's edits (saved after the last publish) go out, and are now in this repo too."
    elif [ "$EDITS" = local ] || [ "$O" = "$B" ]; then
      echo "content/edits.json: this repo's edits go out."
    else
      echo "content/edits.json was changed online (the controller) and in this repo since the last publish."
      echo "Run again with --edits=online to keep the online edits (and copy them here), or --edits=local to replace them with this repo's."
      exit 1
    fi
  fi
  rm -f "$ONLINE" "$BASE"
fi

git -C "$OUT" rm -rq --ignore-unmatch . 2>/dev/null || true
if [ "$HAVE_MODELS" = 0 ]; then git -C "$OUT" checkout -q HEAD -- vendor models; fi

cp "$APP/index.html" "$APP/manifest.webmanifest" "$OUT/"
for d in src data icons index editor; do copy_dir "$d"; done
mkdir -p "$OUT/models" "$OUT/docs" "$OUT/licenses" "$OUT/content"
cp "$LOCAL_EDITS" "$OUT/content/"
if [ "$HAVE_MODELS" = 1 ]; then
  copy_dir vendor
  for f in "${MODELS[@]}"; do cp "$APP/models/$f" "$OUT/models/"; done
fi
cp "$APP/docs/ladder.png" "$APP/docs/title.png" "$APP/docs/order.png" "$APP/docs/develop-shift1.png" "$APP/docs/unit.png" "$APP/docs/unit-phone.png" "$OUT/docs/"
cp "$HERE/licenses/"* "$OUT/licenses/"
cp "$HERE/README-public.md" "$OUT/README.md"
cp "$HERE/NOTICES.md" "$OUT/NOTICES.md"
touch "$OUT/.nojekyll" # serve every file as-is (no Jekyll build)

git -C "$OUT" add -A
if git -C "$OUT" diff --cached --quiet; then
  echo "Nothing changed since the last publish."
  exit 0
fi
git -C "$OUT" -c user.name="$(git -C "$APP" config user.name)" -c user.email="$(git -C "$APP" config user.email)" \
  commit -q -m "Publish Clearance ($REV)"
echo "Commit: $(git -C "$OUT" ls-files | wc -l | tr -d ' ') files, $(du -sh --exclude=.git "$OUT" 2>/dev/null | cut -f1 || true)"
git -C "$OUT" show --stat --format= HEAD | tail -1

if [ "$DRY" = 1 ]; then
  echo "Dry run: the commit is ready in $OUT (not pushed)"
  exit 0
fi
# The first push is ~50 MB of models and runtimes: a bigger HTTP buffer and HTTP/1.1 avoid
# "RPC failed; HTTP 400" from GitHub on large packs.
git -C "$OUT" -c http.postBuffer=524288000 -c http.version=HTTP/1.1 push -q "$REMOTE" main
echo "Published $REV to $REMOTE."
echo "Live in a minute or two at https://thewilliamyao.github.io/clearance/ (the controller: /clearance/editor/)"
