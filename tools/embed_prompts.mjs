// Computes MobileCLIP-S0 text embeddings for every prompt in src/data/prompts.js and writes
// data/prompt-embeddings.json (int8 per component plus one scale per vector, base64).
// The game loads that file, so the phone never needs the 170 MB text encoder.
//
//   cd tools && npm run embed
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { allPrompts } from '../src/data/prompts.js';

const MODEL = 'Xenova/mobileclip_s0';
const OUT = fileURLToPath(new URL('../data/prompt-embeddings.json', import.meta.url));

const prompts = allPrompts();
console.log(`embedding ${prompts.length} prompts with ${MODEL} (fp32 text encoder)`);
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'fp32' });

const items = [];
const BATCH = 32;
for (let i = 0; i < prompts.length; i += BATCH) {
  const batch = prompts.slice(i, i + BATCH);
  const inputs = tokenizer(batch, { padding: 'max_length', truncation: true });
  const { text_embeds } = await model(inputs);
  const dim = text_embeds.dims[1];
  const data = text_embeds.data;
  for (let b = 0; b < batch.length; b++) {
    const v = data.slice(b * dim, (b + 1) * dim);
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n);
    let max = 0; for (let k = 0; k < dim; k++) { v[k] /= n; max = Math.max(max, Math.abs(v[k])); }
    const q = new Int8Array(dim);
    for (let k = 0; k < dim; k++) q[k] = Math.round((v[k] / max) * 127);
    items.push([batch[b], +(max / 127).toPrecision(6), Buffer.from(q.buffer).toString('base64')]);
  }
  process.stdout.write(`  ${Math.min(i + BATCH, prompts.length)}/${prompts.length}\r`);
}
writeFileSync(OUT, JSON.stringify({ model: MODEL, dim: 512, logitScale: 100, items }));
console.log(`\nwrote ${OUT} (${items.length} prompts)`);
