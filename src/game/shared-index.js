// The shared index: what Recorders filed on shift 5 (SAD, ALONE, DOES NOT BELONG, ...),
// pooled from every unit whose Recorder turned on Settings ▸ SHARE WITH THE INDEX (off by
// default). The server is server/ in this folder (a Cloudflare Worker); the public page is
// index/; the camera shows it on the INDEX screen.
//
// Only the lowest grade of a print leaves the phone: 40x30, two tones (SENSOR I / TONE I,
// made by Developer.bits from the capture), with the label it was filed under. Never the
// 640x480 frame, a sharper print, the CLIP embedding, the time of day, a location or anything
// that identifies the unit. The server answers with a key that withdraws the print later; the
// keys stay on this phone (save.shared), even after starting over.
import { INDEX_API } from '../config.js';
import { LEARNED_LABEL, INDEX_LABELS } from './labels.js';
import { t, fill } from './text.js';

export { INDEX_LABELS };
export const PRINT_W = 40, PRINT_H = 30, PRINT_BYTES = (PRINT_W * PRINT_H) / 8;
const OUTBOX_MAX = 30;

// The heading over each label, in the index's words (text.js: index.heading).
export const heading = (key) => t(key === 'notbelong' ? 'index.headingNotBelong' : 'index.heading', { LABEL: fill(LEARNED_LABEL[key] || key.toUpperCase()) });

// 0/1 pixels (1 = paper), row by row, high bit first.
export function packBits(px) {
  const out = new Uint8Array(PRINT_BYTES);
  for (let i = 0; i < PRINT_W * PRINT_H; i++) if (px[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}
export function unpackBits(bytes) {
  const out = new Uint8Array(PRINT_W * PRINT_H);
  for (let i = 0; i < out.length; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}
export function toB64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
export function fromB64(s) { const t = atob(s); const out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; }

// A print in the viewer's palette: 1200 packed colours.
export function printColors(px, ink, paper, out = new Uint32Array(PRINT_W * PRINT_H)) {
  for (let i = 0; i < px.length; i++) out[i] = px[i] ? paper : ink;
  return out;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function dayText(day) {
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(day || '');
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}
export const indexNo = (id) => String(id).padStart(4, '0');

// Where the index is: ?index=<url> on the page, else the deployed one in config.js.
export function indexBase(search = typeof location !== 'undefined' ? location.search : '') {
  let q = null;
  try { q = new URLSearchParams(search).get('index'); } catch { /* no query */ }
  return String(q || INDEX_API || '').replace(/\/+$/, '');
}

const decode = (e) => ({ id: e.id, label: e.label, day: e.day, px: unpackBits(fromB64(e.bits)) });

export class SharedIndex {
  // g: the Game (anything with save and persist()). fetchFn is for tests.
  constructor(g, { base = indexBase(), fetchFn } = {}) {
    this.g = g; this.base = base;
    // No Referer, no cookies: the index learns nothing about the page that sent a print.
    this.fetch = fetchFn || ((url, opts = {}) => fetch(url, { ...opts, referrerPolicy: 'no-referrer', credentials: 'omit' }));
    this.flushing = null; this.sending = null;
    this.data = null; this.loading = null; this.error = null; this.loadedAt = 0;
  }
  get connected() { return !!this.base; }
  get on() { return this.connected && !!this.g.save.settings.share; }
  get outbox() { return this.g.save.outbox || (this.g.save.outbox = []); }
  get shared() { return this.g.save.shared || (this.g.save.shared = []); }

  // A shift 5 filing: queue its print (when the Recorder shares) and send it.
  file(photo, label, px) {
    if (!this.on || !INDEX_LABELS.includes(label) || !px || px.length !== PRINT_W * PRINT_H) return false;
    this.outbox.push({ photo, label, bits: toB64(packBits(px)) });
    while (this.outbox.length > OUTBOX_MAX) this.outbox.shift();
    this.g.persist();
    this.flush();
    return true;
  }

  // Stop sharing: whatever hasn't gone yet stays on the phone.
  stop() { this.g.save.outbox = []; this.g.persist(); }

  // Send what's queued, oldest first. No connection, 429 or 5xx: keep it for later. Any other
  // refusal: drop it (the index won't take it).
  flush() {
    if (this.flushing) return this.flushing;
    if (!this.on || !this.outbox.length) return Promise.resolve();
    this.flushing = (async () => {
      while (this.on && this.outbox.length) {
        const item = this.outbox[0];
        this.sending = item.photo;
        let res, j = null;
        try {
          res = await this.fetch(`${this.base}/api/entries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: item.label, bits: item.bits }) });
          if (res.status === 201) j = await res.json();
        } catch { break; }
        if (res.status === 429 || res.status >= 500) break;
        if (j && j.id) {
          this.shared.push({ id: j.id, key: j.key, day: j.day, label: item.label, photo: item.photo });
          this.loadedAt = 0; // the next look at the index fetches it again
        } else console.warn('the index refused a print', res.status);
        if (this.outbox[0] === item) this.outbox.shift();
        this.g.persist();
      }
    })().finally(() => { this.flushing = null; this.sending = null; });
    return this.flushing;
  }

  // Where one of this unit's exposures stands: sending, queued, shared (with its index entry).
  statusOf(photo) {
    if (photo == null) return null;
    if (this.sending === photo) return { state: 'sending' };
    if (this.outbox.some((x) => x.photo === photo)) return { state: 'queued' };
    const s = this.shared.find((x) => x.photo === photo);
    return s ? { state: 'shared', entry: s } : null;
  }
  mine(id) { return this.shared.find((x) => x.id === id) || null; }

  // Take one of this unit's prints back out of the index. Resolves true when it's gone.
  async withdraw(entry) {
    const res = await this.fetch(`${this.base}/api/entries/${entry.id}`, { method: 'DELETE', headers: { 'X-Delete-Key': entry.key } });
    if (!res.ok && res.status !== 404) return false; // 404: already gone
    this.g.save.shared = this.shared.filter((x) => x.id !== entry.id);
    this.g.persist();
    if (this.data) for (const l of this.data.labels) {
      const k = l.entries.findIndex((e) => e.id === entry.id);
      if (k >= 0) { l.entries.splice(k, 1); l.n = Math.max(0, l.n - 1); this.data.total = Math.max(0, this.data.total - 1); }
    }
    return true;
  }

  // Every label's count and newest prints (cached for a minute).
  load(force = false) {
    if (!this.connected) return Promise.resolve(null);
    if (this.loading) return this.loading;
    if (!force && this.data && Date.now() - this.loadedAt < 60000) return Promise.resolve(this.data);
    this.error = null;
    this.loading = (async () => {
      try {
        const res = await this.fetch(`${this.base}/api/index?per=42`);
        if (!res.ok) throw new Error(`index ${res.status}`);
        const j = await res.json();
        const labels = j.labels.filter((l) => INDEX_LABELS.includes(l.label)).map((l) => ({ label: l.label, n: l.n, entries: l.entries.map(decode), more: l.n > l.entries.length }));
        this.data = { total: j.total, labels };
        this.loadedAt = Date.now();
      } catch (e) { this.error = (e && e.message) || 'unreachable'; }
      this.loading = null;
      return this.data;
    })();
    return this.loading;
  }

  // The next older prints of one label.
  async more(label) {
    const l = this.data && this.data.labels.find((x) => x.label === label);
    if (!l || !l.more || l.fetching || !l.entries.length) return;
    l.fetching = true;
    try {
      const last = l.entries[l.entries.length - 1];
      const res = await this.fetch(`${this.base}/api/entries?label=${encodeURIComponent(label)}&before=${last.id}&limit=42`);
      if (!res.ok) throw new Error(`index ${res.status}`);
      const j = await res.json();
      const have = new Set(l.entries.map((e) => e.id));
      l.entries.push(...j.entries.filter((e) => !have.has(e.id)).map(decode));
      l.more = j.more;
    } catch (e) { console.warn('index', e); }
    l.fetching = false;
  }
}
