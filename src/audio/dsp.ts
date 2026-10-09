/** Tiny offline DSP toolkit used to synthesise every sound effect into AudioBuffers. */

export class Sig {
  readonly d: Float32Array;
  constructor(public sr: number, public dur: number) {
    this.d = new Float32Array(Math.max(1, Math.floor(sr * dur)));
  }
  get n() {
    return this.d.length;
  }
  /** add another signal starting at time t (seconds) with gain */
  mix(o: Sig, t = 0, g = 1) {
    const off = Math.floor(t * this.sr);
    for (let i = 0; i < o.n && i + off < this.n; i++) if (i + off >= 0) this.d[i + off] += o.d[i] * g;
    return this;
  }
  gain(g: number | ((t: number) => number)) {
    if (typeof g === 'number') for (let i = 0; i < this.n; i++) this.d[i] *= g;
    else for (let i = 0; i < this.n; i++) this.d[i] *= g(i / this.sr);
    return this;
  }
  drive(k: number) {
    const norm = Math.tanh(k);
    for (let i = 0; i < this.n; i++) this.d[i] = Math.tanh(this.d[i] * k) / norm;
    return this;
  }
  normalize(peak = 0.9) {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.abs(this.d[i]));
    if (m > 0) this.gain(peak / m);
    return this;
  }
  fadeEdges(inS = 0.002, outS = 0.01) {
    const a = Math.floor(inS * this.sr), b = Math.floor(outS * this.sr);
    for (let i = 0; i < a && i < this.n; i++) this.d[i] *= i / a;
    for (let i = 0; i < b && i < this.n; i++) this.d[this.n - 1 - i] *= i / b;
    return this;
  }
  reverse() {
    this.d.reverse();
    return this;
  }
  /** biquad filter with optionally time-varying cutoff (Hz) */
  filter(type: 'lp' | 'hp' | 'bp' | 'peak', freq: number | ((t: number) => number), q = 0.707, gainDb = 0) {
    let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const sr = this.sr;
    let lastF = -1;
    const coef = (f: number) => {
      f = Math.max(10, Math.min(sr * 0.45, f));
      const w = (2 * Math.PI * f) / sr;
      const cs = Math.cos(w), sn = Math.sin(w);
      const alpha = sn / (2 * q);
      let a0: number;
      if (type === 'lp') {
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
      } else if (type === 'hp') {
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
      } else if (type === 'bp') {
        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha;
      } else {
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A;
      }
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
    };
    const fixed = typeof freq === 'number';
    if (fixed) coef(freq as number);
    for (let i = 0; i < this.n; i++) {
      if (!fixed && (i & 31) === 0) {
        const f = (freq as (t: number) => number)(i / sr);
        if (f !== lastF) {
          coef(f);
          lastF = f;
        }
      }
      const x = this.d[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      this.d[i] = y;
    }
    return this;
  }
  /** simple feedback comb/echo */
  echo(delay: number, fb: number, wet = 0.5) {
    const dl = Math.floor(delay * this.sr);
    const out = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      out[i] = this.d[i] + (i >= dl ? out[i - dl] * fb : 0);
    }
    for (let i = 0; i < this.n; i++) this.d[i] = this.d[i] * (1 - wet) + out[i] * wet;
    return this;
  }
}

export type Rnd = () => number;

export function noise(sr: number, dur: number, r: Rnd = Math.random, color: 'white' | 'pink' | 'brown' = 'white') {
  const s = new Sig(sr, dur);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < s.n; i++) {
    const w = r() * 2 - 1;
    if (color === 'white') s.d[i] = w;
    else if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      s.d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    } else {
      last = (last + 0.02 * w) / 1.02;
      s.d[i] = last * 3.5;
    }
  }
  return s;
}

export type Wave = 'sine' | 'saw' | 'square' | 'tri';
export function osc(sr: number, dur: number, freq: number | ((t: number) => number), wave: Wave = 'sine', phase0 = 0) {
  const s = new Sig(sr, dur);
  let ph = phase0;
  const fixed = typeof freq === 'number';
  for (let i = 0; i < s.n; i++) {
    const f = fixed ? (freq as number) : (freq as (t: number) => number)(i / sr);
    ph += f / sr;
    ph -= Math.floor(ph);
    let v: number;
    switch (wave) {
      case 'sine': v = Math.sin(ph * Math.PI * 2); break;
      case 'saw': v = ph * 2 - 1; break;
      case 'square': v = ph < 0.5 ? 1 : -1; break;
      default: v = 1 - 4 * Math.abs(ph - 0.5);
    }
    s.d[i] = v;
  }
  return s;
}

/** envelope helpers (return gain functions of t) */
export const env = {
  exp: (decay: number, attack = 0.001) => (t: number) => (t < attack ? t / attack : Math.exp(-(t - attack) / decay)),
  ad: (a: number, d: number) => (t: number) => (t < a ? t / a : Math.max(0, 1 - (t - a) / d)),
  adsr: (a: number, d: number, s: number, hold: number, r: number) => (t: number) => {
    if (t < a) return t / a;
    if (t < a + d) return 1 - ((t - a) / d) * (1 - s);
    if (t < a + d + hold) return s;
    return Math.max(0, s * (1 - (t - a - d - hold) / r));
  },
  swell: (dur: number, pow = 2) => (t: number) => Math.pow(Math.min(1, t / dur), pow),
};

/** Damped inharmonic resonator bank (metal, glass, shells). */
export function ring(sr: number, dur: number, partials: [number, number, number][]) {
  const s = new Sig(sr, dur);
  for (const [f, amp, decay] of partials) {
    const p = osc(sr, dur, f, 'sine', Math.random()).gain(env.exp(decay, 0.0005));
    s.mix(p, 0, amp);
  }
  return s;
}

/** Algorithmic impulse response for the convolver reverb. */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, brightness: number) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const w = Math.random() * 2 - 1;
      const k = brightness * (1 - t * 0.85);
      lp = lp + (w - lp) * k;
      d[i] = lp * Math.pow(1 - t, decay) * (i < sr * 0.004 ? i / (sr * 0.004) : 1);
    }
    // a few early reflections
    for (let e = 0; e < 6; e++) {
      const pos = Math.floor(sr * (0.008 + Math.random() * 0.05));
      if (pos < len) d[pos] += (Math.random() * 2 - 1) * 0.5;
    }
  }
  return buf;
}
