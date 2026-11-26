// INTENT bench: scores real photos on the abstract requests (shifts 5-6) exactly the way the
// game does (same model file, same prompt bank, same Clip.concept code), to set the bars.
// Embeddings are cached, so trying a new formula or bar is instant.
//
//   cd tools
//   node test/intent-bench.mjs embed test/out/intent/list.tsv     # "category<TAB>path" lines
//   node test/intent-bench.mjs calibrate                          # writes data/intent-bars.json
//   node test/intent-bench.mjs report [concept ...]               # pass rates + top photos
//   node test/intent-bench.mjs sheet <concept> [n]                # contact sheet of the top n
//
// The camera's framing is copied: the centre 4:3 crop of the picture, then MobileCLIP's centre
// square. Outputs go to test/out/intent/ (gitignored: the photos are private).
//
// Calibration photos (Nov 21 2026): 339 frames from William's vlogs (one random frame each
// from ~400 of his 1206 VB-1 proxies: friends, rooms, streets, food, selfies), 8 room renders
// and 6 headshots; posters, renders and generated stills are only used to check the top end.
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Clip, normalize } from '../../src/vision/clip.js';
import { CONCEPTS } from '../../src/data/prompts.js';
import { REQUESTS, INTENT_NEED } from '../../src/game/requests.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/intent/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const CACHE = path.join(OUT, 'emb.json');
const SIZE = 256;

export function loadBank() {
  const j = JSON.parse(readFileSync(path.join(ROOT, 'data/prompt-embeddings.json'), 'utf8'));
  const bank = new Map();
  for (const [text, scale, b64] of j.items) {
    const bin = Buffer.from(b64, 'base64'), v = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) { const q = bin[i]; v[i] = (q > 127 ? q - 256 : q) * scale; }
    bank.set(text, normalize(v));
  }
  return bank;
}

// The camera's crop (centre 4:3, zoom 1), then MobileCLIP's centre square, as 0..1 CHW.
async function pixels(file) {
  const img = sharp(file).rotate();
  const { width: vw0, height: vh0, orientation } = await img.metadata();
  const [vw, vh] = orientation >= 5 ? [vh0, vw0] : [vw0, vh0];
  let sw, sh;
  if (vw / vh > 4 / 3) { sh = vh; sw = vh * 4 / 3; } else { sw = vw; sh = vw * 3 / 4; }
  const s = Math.min(sw, sh);
  const left = Math.round((vw - s) / 2), top = Math.round((vh - s) / 2);
  const { data } = await img.extract({ left, top, width: Math.round(s), height: Math.round(s) })
    .resize(SIZE, SIZE, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(3 * SIZE * SIZE), plane = SIZE * SIZE;
  for (let i = 0; i < plane; i++) { out[i] = data[i * 3] / 255; out[plane + i] = data[i * 3 + 1] / 255; out[2 * plane + i] = data[i * 3 + 2] / 255; }
  return out;
}

function readCache() { return existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {}; }

async function embed(listFile) {
  const cache = readCache();
  const session = await ort.InferenceSession.create(path.join(ROOT, 'models/mobileclip_s0_vision.onnx'));
  // Relative paths are from the workspace root.
  const lines = readFileSync(listFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'))
    .map(([cat, f]) => [cat, path.isAbsolute(f) ? f : path.join(ROOT, '..', f)]);
  let n = 0;
  for (const [cat, file] of lines) {
    const key = `${file}|${statSync(file).mtimeMs}`;
    if (cache[key]) { cache[key].cat = cat; continue; }
    try {
      const t = new ort.Tensor('float32', await pixels(file), [1, 3, SIZE, SIZE]);
      const r = await session.run({ pixel_values: t });
      cache[key] = { cat, file, emb: Array.from(normalize(Float32Array.from(r.image_embeds.data)), (x) => +x.toFixed(5)) };
    } catch (e) { console.error(`skip ${file}: ${e.message}`); }
    if (++n % 25 === 0) process.stdout.write(`  ${n}/${lines.length}\r`);
  }
  writeFileSync(CACHE, JSON.stringify(cache));
  console.log(`embedded ${lines.length} photos -> ${CACHE}`);
}

export function photos() {
  return Object.values(readCache()).map((p) => ({ ...p, emb: Float32Array.from(p.emb) }));
}

export function clipWith(bank, bars) {
  const c = new Clip(); c.bank = bank;
  c.bars = bars || (existsSync(BARS) ? JSON.parse(readFileSync(BARS, 'utf8')) : { q: {} });
  return c;
}
const BARS = path.join(ROOT, 'data/intent-bars.json');
const CAL = ['vlog', 'room', 'headshot'];

// Stand-ins for the game's detectors (the bench has no MediaPipe): a person among CLIP's top
// three LAB labels; a close-up face when "a face" is the top one.
const labelsOf = (clip, p) => clip.labels(p.emb, 3).map((l) => l.label);
const hasPerson = (clip, p) => labelsOf(clip, p).some((l) => ['a person', 'a face', 'a crowd of people'].includes(l));
const closeFace = (clip, p) => labelsOf(clip, p)[0] === 'a face';
const usable = (clip, c, p) => (!c.person || hasPerson(clip, p)) && (!c.place || !closeFace(clip, p));

// Where ordinary photos fall on each concept: 21 quantiles (0%, 5%, ... 100%) of the score.
function calibrate() {
  const clip = clipWith(loadBank(), { q: {} });
  const ps = photos().filter((p) => CAL.includes(p.cat));
  const q = {};
  for (const [id, c] of Object.entries(CONCEPTS)) {
    const ds = ps.filter((p) => usable(clip, c, p)).map((p) => clip.concept(p.emb, id).d).sort((a, b) => a - b);
    q[id] = Array.from({ length: 21 }, (_, i) => +ds[Math.round((i / 20) * (ds.length - 1))].toFixed(5));
    console.log(`${id.padEnd(11)} ${String(ds.length).padStart(3)} photos   bar (70%) ${q[id][14]}`);
  }
  const about = 'Score quantiles (0-100% in 5% steps) of ordinary photos on each INTENT concept; made by tools/test/intent-bench.mjs calibrate';
  writeFileSync(BARS, JSON.stringify({ about, made: new Date().toISOString().slice(0, 10), photos: ps.length, q }) + '\n');
  console.log(`wrote ${BARS}`);
}

const q = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };

// What the game would do with each photo (detectors stood in for as above).
function judge(clip, c, id, p) {
  if (!usable(clip, c, p)) return { ok: false, skip: true };
  const r = clip.concept(p.emb, id);
  return { ...r, ok: r.p >= INTENT_NEED && !r.opp, veto: r.p >= INTENT_NEED && !!r.opp };
}

function report(ids) {
  const clip = clipWith(loadBank());
  const ps = photos();
  ids = ids.length ? ids : Object.keys(CONCEPTS);
  for (const id of ids) {
    const c = CONCEPTS[id];
    const sc = ps.map((ph) => ({ ...judge(clip, c, id, ph), ph })).filter((x) => !x.skip);
    const byCat = {};
    for (const x of sc) (byCat[x.ph.cat] ||= []).push(x);
    console.log(`\n${id.toUpperCase()}  filed: ` + Object.entries(byCat).map(([k, v]) => `${k} ${v.filter((x) => x.ok).length}/${v.length}`).join('  ') + `   (opposite won: ${sc.filter((x) => x.veto).length})`);
    for (const x of [...sc].sort((a, b) => b.d - a.d).slice(0, 6)) console.log(`   ${pctS(x.p)} ${x.ph.cat.padEnd(9)} ${path.basename(x.ph.file).slice(0, 36).padEnd(36)} ${x.best}${x.opp ? ` (sees ${x.opp})` : ''}`);
  }
}
const pctS = (p) => `${Math.round(p * 100)}%`.padStart(4);

async function sheet(id, n = 24) {
  const clip = clipWith(loadBank());
  const top = photos().map((p) => ({ p, s: clip.concept(p.emb, id).p })).sort((a, b) => b.s - a.s).slice(0, n);
  const W = 200, H = 150, cols = 6, rows = Math.ceil(top.length / cols);
  const tiles = await Promise.all(top.map(async (x, i) => {
    const img = await sharp(x.p.file).rotate().resize(W, H, { fit: 'cover' }).toBuffer();
    const label = Buffer.from(`<svg width="${W}" height="18"><rect width="${W}" height="18" fill="black" opacity="0.7"/><text x="4" y="13" font-family="Menlo" font-size="11" fill="white">${(x.s * 100).toFixed(0)}% ${x.p.cat} ${path.basename(x.p.file).slice(0, 18).replace(/[<&>]/g, '')}</text></svg>`);
    return [{ input: img, left: (i % cols) * W, top: Math.floor(i / cols) * H }, { input: label, left: (i % cols) * W, top: Math.floor(i / cols) * H + H - 18 }];
  }));
  const file = path.join(OUT, `sheet-${id}.jpg`);
  await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#222' } }).composite(tiles.flat()).jpeg({ quality: 80 }).toFile(file);
  console.log(file);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'embed') await embed(rest[0]);
  else if (cmd === 'calibrate') calibrate();
  else if (cmd === 'report') report(rest);
  else if (cmd === 'sheet') await sheet(rest[0], +(rest[1] || 24));
  else console.log('usage: intent-bench.mjs embed <list.tsv> | calibrate | report [concept ...] | sheet <concept> [n]');
}
