// Browser test of the recognition modules on still pictures (headless Chrome).
// For each fixture it prints what every module saw and how long it took; then it checks
// the in-browser MobileCLIP embedding against a Node reference (transformers.js) on the
// same pixels, and benchmarks every module.
//   cd tools && node test/e2e.mjs [image ...]
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:8077/';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const defaults = [
  'portfolio/content/about/william-yao-2017-headshot.jpg',
  'portfolio/content/about/william-yao-bw-headshot.jpg',
  'room-watch/ref/1.jpg',
  'room-watch/ref/3.jpg',
  'ancient-cats/Egypt 03 - Gayer-Anderson Cat.jpg',
  'ancient-cats/Japan 01 - Hiroshige cat at the window (1857).jpg',
].map((f) => path.join(REPO, f));
const images = (process.argv.slice(2).length ? process.argv.slice(2) : defaults).filter((f) => existsSync(f));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/^INFO:|^W[0-9]{4} /.test(m.text())) errors.push(m.text()); }); // MediaPipe logs its INFO lines as errors
await page.route('**/__fixture/**', (route) => {
  const f = decodeURIComponent(route.request().url().split('/__fixture/')[1]);
  if (!existsSync(f)) return route.fulfill({ status: 404 });
  route.fulfill({ body: readFileSync(f), contentType: f.endsWith('.png') ? 'image/png' : 'image/jpeg' });
});
const fx = (f) => '/__fixture/' + encodeURIComponent(f);
await page.goto(`${BASE}?image=${encodeURIComponent(fx(images[0]))}`);
await page.waitForFunction(() => window.__clearance && window.__clearance.camera.ready, null, { timeout: 20000 });

console.log('loading modules…');
const load = await page.evaluate(async () => {
  const g = window.__clearance.game;
  const t0 = performance.now();
  const ids = ['objects', 'faces', 'affect', 'intent'];
  await Promise.all(ids.map((id) => g.modules.ensure(id)));
  return { ms: performance.now() - t0, st: Object.fromEntries(ids.map((id) => [id, { state: g.modules.st[id].state, ms: Math.round(g.modules.st[id].ms), error: g.modules.st[id].error }])), delegate: g.modules.mp.delegate };
});
console.log(JSON.stringify(load, null, 1));

const results = [];
for (const f of images) {
  const r = await page.evaluate(async (url) => {
    const { game: g, camera } = window.__clearance;
    await camera.useImage(url);
    g.freeze(1);
    const A = await g.modules.analyze(g.cap, ['chroma', 'form', 'objects', 'faces', 'affect', 'intent']);
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]);
    return {
      ms: Object.fromEntries(Object.entries(A.ms).map(([k, v]) => [k, Math.round(v)])),
      color: top(A.cv.color.frac).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', '),
      shapes: A.cv.shapes.map((s) => `${s.kind} ${s.score.toFixed(2)}`).join(', '),
      sym: +A.cv.sym.score.toFixed(2), blank: +A.cv.blank.score.toFixed(2), light: A.cv.light.ok,
      objects: (A.objects || []).map((o) => `${o.label} ${o.score.toFixed(2)}`).join(', '),
      faces: (A.faces || []).length,
      affect: (A.affect || []).map((x) => `smile ${x.smile.toFixed(2)} yaw ${x.yawDeg}° eyesClosed ${x.eyesClosed.toFixed(2)} read ${JSON.stringify(Object.fromEntries(Object.entries(x.read).map(([k, v]) => [k, +v.toFixed(2)])))}`),
      labels: A.emb ? g.modules.clip.labels(A.emb, 4).map((l) => `${l.label} ${Math.round(l.p * 100)}%`).join(', ') : '',
      profile: (A.profile || []).map((p) => `${p.name} ${Math.round(p.p * 100)}%`).join(', '),
      concepts: A.emb ? Object.fromEntries(['sadness', 'waiting', 'suspicious', 'outofplace', 'notbelong', 'abandoned', 'hiding', 'tired', 'hurry'].map((c) => [c, +g.modules.clip.concept(A.emb, c).p.toFixed(2)])) : null,
      emb: A.emb ? Array.from(A.emb) : null,
      png: g.cap.toDataURL('image/png'),
    };
  }, fx(f));
  results.push({ file: path.basename(f), ...r });
  console.log(`\n== ${path.basename(f)}  (ms ${JSON.stringify(r.ms)})`);
  console.log(`  chroma: ${r.color} | shapes: ${r.shapes || '—'} | sym ${r.sym} blank ${r.blank} light ${r.light}`);
  console.log(`  objects: ${r.objects || '—'}`);
  console.log(`  faces: ${r.faces} | affect: ${r.affect.join(' / ') || '—'}`);
  console.log(`  clip labels: ${r.labels}`);
  console.log(`  profile: ${r.profile}`);
  console.log(`  concepts: ${JSON.stringify(r.concepts)}`);
}

// CLIP parity: the same 640x480 pixels through transformers.js in Node.
if (results[0] && results[0].emb) {
  console.log('\nCLIP parity (browser int8 + our preprocessing vs Node transformers.js):');
  const { AutoProcessor, CLIPVisionModelWithProjection, RawImage } = await import('@huggingface/transformers');
  const processor = await AutoProcessor.from_pretrained('Xenova/mobileclip_s0');
  const models = { fp32: await CLIPVisionModelWithProjection.from_pretrained('Xenova/mobileclip_s0', { dtype: 'fp32' }) };
  for (const r of results) {
    const file = path.join(OUT, `cap-${r.file.replace(/[^a-z0-9.]/gi, '_')}.png`);
    writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
    const image = await RawImage.read(file);
    const inputs = await processor(image);
    const row = [];
    for (const [k, m] of Object.entries(models)) {
      const { image_embeds } = await m(inputs);
      const v = image_embeds.normalize().data;
      let d = 0; for (let i = 0; i < v.length; i++) d += v[i] * r.emb[i];
      row.push(`${k} ${d.toFixed(4)}`);
    }
    console.log(`  ${r.file}: cos vs ${row.join(', ')}`);
  }
  // Image-image similarity between the fixtures (for the CONTINUITY thresholds).
  console.log('\nimage-image similarity:');
  for (let a = 0; a < results.length; a++) for (let b = a + 1; b < results.length; b++) {
    let d = 0; for (let i = 0; i < 512; i++) d += results[a].emb[i] * results[b].emb[i];
    console.log(`  ${results[a].file.slice(0, 24).padEnd(24)} ~ ${results[b].file.slice(0, 24).padEnd(24)} ${d.toFixed(3)}`);
  }
}

// Same picture, shifted crop (the Recorder photographs a subject again).
const again = await page.evaluate(async (url) => {
  const { game: g, camera } = window.__clearance;
  await camera.useImage(url);
  g.freeze(1);
  const a = await g.modules.clip.embed(g.cap, 640, 480);
  g.freeze(1.4);
  const b = await g.modules.clip.embed(g.cap, 640, 480);
  let d = 0; for (let i = 0; i < 512; i++) d += a[i] * b[i];
  return d;
}, fx(images[0]));
console.log(`\nsame subject, 1.4x zoom: sim ${again.toFixed(3)}`);

// Benchmark: ten runs per module on one 640x480 still.
const bench = await page.evaluate(async () => {
  const { game: g } = window.__clearance;
  g.freeze(1);
  const m = g.modules, c = g.cap, out = {};
  const med = async (f) => { const ts = []; for (let k = 0; k < 10; k++) { const t = performance.now(); await f(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return +ts[5].toFixed(1); };
  out.objects = await med(() => m.mp.detectObjects(c, 640, 480));
  out.faces = await med(() => m.mp.detectFaces(c, 640, 480));
  out.affect = await med(() => m.mp.detectAffect(c));
  out.intent = await med(() => m.clip.embed(c, 640, 480));
  return out;
});
console.log(`\nbench (ms, median of 10, headless Chrome on this Mac): ${JSON.stringify(bench)}`);
writeFileSync(path.join(OUT, 'e2e.json'), JSON.stringify({ load, bench, results: results.map(({ emb, png, ...r }) => r) }, null, 1));
console.log(errors.length ? `\npage errors:\n${errors.join('\n')}` : '\nno page errors');
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
process.exit(0);
