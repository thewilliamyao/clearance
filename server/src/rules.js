// The shared index's rules, kept apart from the Worker so tests can run them in Node (the
// Workers runtime treats every export of the main module as an entrypoint).
//   tools/test/unit-index.mjs checks them; src/worker.js enforces them.

export const LABELS = ['sadness', 'alone', 'waiting', 'hurry', 'tired', 'notbelong', 'suspicious', 'outofplace', 'abandoned', 'hiding'];
export const PRINT_W = 40, PRINT_H = 30, PRINT_BYTES = (PRINT_W * PRINT_H) / 8; // 150
const B64_LEN = (PRINT_BYTES / 3) * 4; // 200, no padding
export const MAX_BODY = 1024;

// --- validation (pure; tested in Node by tools/test/unit-index.mjs) --------------------------
// A submission is exactly {label, bits}: anything else is refused, so a client can't send
// more than the print even by mistake.
export function parseSubmission(text) {
  if (typeof text !== 'string' || text.length > MAX_BODY) return { error: 'body too large', status: 413 };
  let j;
  try { j = JSON.parse(text); } catch { return { error: 'not JSON', status: 400 }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { error: 'not an object', status: 400 };
  const extra = Object.keys(j).filter((k) => k !== 'label' && k !== 'bits');
  if (extra.length) return { error: `unexpected field: ${extra[0]}`, status: 400 };
  if (!LABELS.includes(j.label)) return { error: 'unknown label', status: 400 };
  if (typeof j.bits !== 'string' || j.bits.length !== B64_LEN || !/^[A-Za-z0-9+/]+$/.test(j.bits)) return { error: `bits must be ${PRINT_BYTES} bytes of base64`, status: 400 };
  return { label: j.label, bits: j.bits };
}

export function originAllowed(origin, env) {
  if (!origin) return true; // not a browser (curl, the admin script): CORS doesn't apply
  const list = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.includes(origin)) return true;
  // William's phone tests run the game through a cloudflared quick tunnel (serve.py --tunnel).
  return env.ALLOW_TUNNELS === '1' && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(origin);
}
