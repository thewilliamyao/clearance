// Every sound is synthesised with WebAudio: no audio files to load or port.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.noiseBuf = null;
    this.printing = 0;
  }

  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.55;
        this.master.connect(this.ctx.destination);
        const n = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, n, n);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { this.ctx = null; }
  }

  get ok() { return this.on && this.ctx && this.ctx.state === 'running'; }

  tone(freq, dur, { type = 'square', vol = 0.12, at = 0, slide = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + at;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, freq = 2000, q = 0.8, at = 0, type = 'bandpass' } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + at;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  move() { this.tone(1046, 0.025, { vol: 0.05 }); }
  blip() { this.tone(1568, 0.03, { vol: 0.06 }); }
  confirm() { this.tone(784, 0.05, { vol: 0.08 }); this.tone(1175, 0.09, { vol: 0.08, at: 0.06 }); }
  deny() { this.tone(160, 0.2, { type: 'sawtooth', vol: 0.1, slide: 110 }); }
  shutter() {
    this.noise(0.018, { vol: 0.7, freq: 5200, q: 0.6 });
    this.tone(2200, 0.012, { vol: 0.1 });
    this.noise(0.05, { vol: 0.45, freq: 1400, q: 1.2, at: 0.075 });
    this.tone(90, 0.06, { type: 'sine', vol: 0.2, at: 0.075 });
  }
  // Dot-matrix chatter while a photo develops.
  printLine() { if (Math.random() < 0.7) this.tone(1600 + Math.random() * 1800, 0.012, { vol: 0.035 }); }
  scan() { this.tone(2637, 0.018, { vol: 0.05 }); }
  type() { this.noise(0.012, { vol: 0.12, freq: 3500, q: 2 }); }
  stamp() {
    this.tone(95, 0.18, { type: 'sine', vol: 0.5, slide: 45 });
    this.noise(0.07, { vol: 0.5, freq: 700, q: 0.7 });
    this.noise(0.03, { vol: 0.25, freq: 3000, q: 1, at: 0.01 });
  }
  alarm() { this.tone(880, 0.12, { vol: 0.07 }); this.tone(660, 0.16, { vol: 0.07, at: 0.14 }); }
  install() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.07, { vol: 0.05, at: i * 0.07 })); }
  burn() { this.noise(1.6, { vol: 0.5, freq: 900, q: 0.3, type: 'lowpass' }); this.tone(60, 1.4, { type: 'sine', vol: 0.3, slide: 30 }); }
}
