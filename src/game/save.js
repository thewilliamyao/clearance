// Progress lives in localStorage; developed exposures in IndexedDB. Nothing leaves the
// device: photos of strangers stay on the phone that took them. The one exception is opt-in:
// with Settings ▸ SHARE WITH THE INDEX on, each shift 5 filing goes to the shared index as a
// 40x30 two-tone copy (shared-index.js).

const KEY = 'clearance.save.v1';

export function defaultSave() {
  return {
    v: 1,
    day: 1,
    phase: 'new', // new | order | field | report | shop | ended
    merit: 0,
    earned: 0, // all-time merit
    own: { sensor: 0, tone: 0, lens: 0, film: 0, tracking: 0 },
    order: null, // { requests, quota, film, earned, shots, seed }
    exposures: 0,
    history: [],
    citations: 0,
    ending: null,
    selfMisses: 0,
    refusals: 0, // shift 5: times the Recorder answered NO to "YOU SURE?" (ENDINGS.md)
    // share: send shift 5 filings to the shared index as 40x30 two-tone prints (off until the
    // Recorder turns it on; see shared-index.js).
    settings: { theme: 'ledger', body: 'silver', sound: true, haptics: true, tapShoot: true, facing: 'environment', hud: 0, share: false },
    dev: { unlockAll: false },
    outbox: [], // prints waiting to go to the index: [{ photo, label, bits }]
    shared: [], // prints in the index, with the keys that withdraw them: [{ id, key, day, label, photo }]
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const s = JSON.parse(raw);
    const d = defaultSave();
    return { ...d, ...s, own: { ...d.own, ...s.own }, settings: { ...d.settings, ...s.settings }, dev: { ...d.dev, ...s.dev } };
  } catch { return defaultSave(); }
}

export function writeSave(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: play without saving */ }
}

// --- photos -------------------------------------------------------------------------------
export class PhotoStore {
  constructor() { this.mem = []; this.db = null; this.ready = this.open(); }

  open() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open('clearance', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
        req.onsuccess = () => { this.db = req.result; this.all().then((list) => { this.mem = list; resolve(); }); };
        req.onerror = () => resolve();
      } catch { resolve(); }
    });
  }

  tx(mode) { return this.db.transaction('photos', mode).objectStore('photos'); }

  all() {
    if (!this.db) return Promise.resolve(this.mem.slice());
    return new Promise((resolve) => {
      const out = [];
      const req = this.tx('readonly').openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push(c.value); c.continue(); } else resolve(out.sort((a, b) => a.id - b.id)); };
      req.onerror = () => resolve(this.mem.slice());
    });
  }

  put(photo) {
    const i = this.mem.findIndex((p) => p.id === photo.id);
    if (i >= 0) this.mem[i] = photo; else this.mem.push(photo);
    if (this.db) try { this.tx('readwrite').put(photo); } catch (e) { console.warn('photo not saved', e); }
  }

  clear() {
    this.mem = [];
    if (this.db) try { this.tx('readwrite').clear(); } catch {}
  }

  get list() { return this.mem; }
}
