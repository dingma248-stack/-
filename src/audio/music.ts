import type { AudioEngine } from './engine';

/**
 * Generative layered score. Layers are cross-faded by the director:
 *   ambient   – low drones + sparse distant piano
 *   tension   – high string cluster + slow heartbeat pulse
 *   combat    – driving percussion and ostinato bass
 *   nightwatch– the stalker's motif: four heavy brass notes + timpani
 *   safe      – music-box rendition of the main theme
 *   theme     – the title theme on piano
 */

export type Layer = 'ambient' | 'tension' | 'combat' | 'nightwatch' | 'safe' | 'theme';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// main theme (A minor), [semitone offset from root, beats]
const THEME: [number, number][] = [
  [12, 2], [7, 1], [8, 1], [7, 2], [5, 1], [3, 1], [2, 2], [3, 1], [-1, 1], [0, 4],
  [12, 2], [15, 1], [14, 1], [12, 2], [10, 1], [8, 1], [7, 3], [3, 1], [5, 4],
];
const CHORDS = [[0, 3, 7], [-4, 0, 3], [-9, -5, 0], [-2, 2, 5]];
const BASS_PATTERN = [0, 0, 12, 0, 1, 0, 12, -2, 0, 0, 12, 0, 3, 1, 0, -5];
const WATCH_MOTIF: [number, number][] = [[0, 2], [3, 2], [2, 3], [-4, 1], [0, 2], [3, 2], [6, 3], [5, 1]];

export class Music {
  private out: GainNode;
  private layers: Record<Layer, GainNode>;
  private targets: Record<Layer, number> = { ambient: 0, tension: 0, combat: 0, nightwatch: 0, safe: 0, theme: 0 };
  private drones: OscillatorNode[] = [];
  private droneFilter!: BiquadFilterNode;
  private clusterFilter!: BiquadFilterNode;
  private timer: number | null = null;
  private noiseBuf: AudioBuffer;
  root = 45; // A2
  private next: Record<string, number> = {};
  private step: Record<string, number> = {};
  private delay: DelayNode;
  private delayFb: GainNode;
  private running = false;

  constructor(private eng: AudioEngine) {
    const ctx = eng.ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(eng.buses.music);
    // shared echo for piano / music box
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.48;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2200;
    this.delay.connect(dlp).connect(this.delayFb).connect(this.delay);
    dlp.connect(this.out);
    this.layers = {} as Record<Layer, GainNode>;
    for (const k of Object.keys(this.targets) as Layer[]) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.out);
      this.layers[k] = g;
    }
    const n = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, n, n);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const ctx = this.eng.ctx;
    // ---- persistent drones (ambient) ----
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 240;
    this.droneFilter.Q.value = 2;
    this.droneFilter.connect(this.layers.ambient);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(this.droneFilter.frequency);
    lfo.start();
    this.drones.push(lfo);
    const mkDrone = (semi: number, detune: number, type: OscillatorType, vol: number, dest: AudioNode) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(this.root + semi);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g).connect(dest);
      o.start();
      (o as any)._semi = semi;
      this.drones.push(o);
    };
    mkDrone(-12, -6, 'sawtooth', 0.22, this.droneFilter);
    mkDrone(-12, 7, 'sawtooth', 0.22, this.droneFilter);
    mkDrone(-5, 0, 'sawtooth', 0.12, this.droneFilter);
    mkDrone(-24, 0, 'sine', 0.35, this.layers.ambient);
    // ---- high string cluster (tension) ----
    this.clusterFilter = ctx.createBiquadFilter();
    this.clusterFilter.type = 'bandpass';
    this.clusterFilter.frequency.value = 1400;
    this.clusterFilter.Q.value = 0.8;
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 5.5;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.25;
    tremLfo.connect(tremDepth).connect(trem.gain);
    tremLfo.start();
    this.drones.push(tremLfo);
    this.clusterFilter.connect(trem).connect(this.layers.tension);
    mkDrone(24, -8, 'sawtooth', 0.05, this.clusterFilter);
    mkDrone(25, 6, 'sawtooth', 0.05, this.clusterFilter);
    mkDrone(31, 0, 'sawtooth', 0.035, this.clusterFilter);
    mkDrone(36, 12, 'sawtooth', 0.02, this.clusterFilter);
    const t = ctx.currentTime + 0.1;
    for (const k of ['piano', 'pulse', 'combat', 'watch', 'box', 'theme']) {
      this.next[k] = t;
      this.step[k] = 0;
    }
    this.timer = window.setInterval(() => this.schedule(), 50);
  }

  stop() {
    this.running = false;
    for (const o of this.drones) {
      try {
        o.stop();
      } catch {
        /* ignored */
      }
    }
    this.drones = [];
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  setRoot(midi: number) {
    this.root = midi;
    const t = this.eng.ctx.currentTime;
    for (const o of this.drones) {
      const semi = (o as any)._semi;
      if (semi !== undefined) o.frequency.setTargetAtTime(mtof(midi + semi), t, 2);
    }
  }

  set(levels: Partial<Record<Layer, number>>, tc = 1.2) {
    const t = this.eng.ctx.currentTime;
    for (const k of Object.keys(levels) as Layer[]) {
      const v = levels[k]!;
      this.targets[k] = v;
      this.layers[k].gain.setTargetAtTime(v, t, tc);
    }
  }

  only(levels: Partial<Record<Layer, number>>, tc = 1.2) {
    const all: Record<Layer, number> = { ambient: 0, tension: 0, combat: 0, nightwatch: 0, safe: 0, theme: 0 };
    this.set({ ...all, ...levels }, tc);
  }

  level(l: Layer) {
    return this.targets[l];
  }

  // ---------------- instruments ----------------
  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private piano(midi: number, t: number, vol: number, dest: AudioNode, decay = 3) {
    const ctx = this.eng.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, decay);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 8, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + decay * 0.6);
    for (const [mul, amp, type] of [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3.01, 0.12, 'sine'], [0.5, 0.15, 'sine']] as [number, number, OscillatorType][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
    lp.connect(g);
    g.connect(dest);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(this.delay);
  }

  private bell(midi: number, t: number, vol: number, dest: AudioNode) {
    const ctx = this.eng.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, 2.2);
    for (const [mul, amp] of [[1, 1], [2.76, 0.3], [5.4, 0.12], [4, 0.1]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = amp;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 2.4);
    }
    g.connect(dest);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    g.connect(send).connect(this.delay);
  }

  private noiseHit(t: number, vol: number, freq: number, q: number, decay: number, dest: AudioNode, type: BiquadFilterType = 'bandpass') {
    const ctx = this.eng.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, 0.002, vol, decay);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + decay + 0.05);
  }

  private kick(t: number, vol: number, dest: AudioNode, f0 = 120, f1 = 42, decay = 0.35) {
    const ctx = this.eng.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.08);
    const g = ctx.createGain();
    this.env(g, t, 0.003, vol, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  private synth(midi: number, t: number, dur: number, vol: number, dest: AudioNode, cutoff: number, type: OscillatorType = 'sawtooth', detune = 8) {
    const ctx = this.eng.ctx;
    const f = mtof(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(cutoff * 0.3, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + Math.min(0.15, dur * 0.4));
    lp.frequency.exponentialRampToValueAtTime(cutoff * 0.25, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    for (const dt of [-detune, detune]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = dt;
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.2);
    }
    lp.connect(g).connect(dest);
  }

  // ---------------- scheduler ----------------
  private schedule() {
    const ctx = this.eng.ctx;
    if (ctx.state !== 'running') return;
    const ahead = ctx.currentTime + 0.25;
    const R = this.root;

    // sparse distant piano on the ambient layer
    while (this.next.piano < ahead) {
      const t = this.next.piano;
      if (this.targets.ambient > 0.02) {
        const scale = [0, 2, 3, 7, 8, 12, 14, 15];
        const n = R + 24 + scale[Math.floor(Math.random() * scale.length)];
        this.piano(n, t, 0.06, this.layers.ambient, 4);
        if (Math.random() < 0.3) this.piano(n - 12, t + 0.01, 0.04, this.layers.ambient, 4);
      }
      this.next.piano += 4 + Math.random() * 6;
    }

    // tension heartbeat pulse
    while (this.next.pulse < ahead) {
      const t = this.next.pulse;
      if (this.targets.tension > 0.02) {
        this.kick(t, 0.32, this.layers.tension, 70, 38, 0.3);
        this.kick(t + 0.28, 0.2, this.layers.tension, 65, 36, 0.3);
        if (Math.random() < 0.18) this.noiseHit(t + 0.5, 0.05, 3000 + Math.random() * 3000, 8, 1.2, this.layers.tension);
      }
      this.next.pulse += 1.35;
    }

    // combat groove: 16th grid @ 104 bpm
    const s16 = 60 / 104 / 4;
    while (this.next.combat < ahead) {
      const t = this.next.combat;
      const i = this.step.combat++ % 32;
      if (this.targets.combat > 0.02) {
        const L = this.layers.combat;
        if (i % 8 === 0 || i === 6 || i === 22) this.kick(t, 0.6, L);
        if (i % 8 === 4) this.noiseHit(t, 0.32, 1800, 0.8, 0.18, L);
        if (i % 2 === 0) this.noiseHit(t, i % 4 === 2 ? 0.07 : 0.035, 8000, 1.5, 0.05, L, 'highpass');
        if (i % 2 === 0) {
          const b = BASS_PATTERN[(i / 2) % 16];
          this.synth(R - 12 + b, t, s16 * 1.6, 0.16, L, 900);
        }
        if (i === 0 || i === 16) this.synth(R + 12 + (i === 16 ? 1 : 0), t, s16 * 6, 0.05, L, 2400, 'sawtooth', 14);
        if (i === 28 || i === 30) this.noiseHit(t, 0.22, 600, 1.2, 0.2, L);
      }
      this.next.combat += s16;
    }

    // nightwatch motif @ 76 bpm (beats)
    const beat = 60 / 76;
    while (this.next.watch < ahead) {
      const t = this.next.watch;
      const st = this.step.watch++;
      if (this.targets.nightwatch > 0.02) {
        const L = this.layers.nightwatch;
        const [semi, len] = WATCH_MOTIF[st % WATCH_MOTIF.length];
        this.synth(R - 12 + semi, t, beat * len * 0.95, 0.24, L, 700, 'sawtooth', 10);
        this.synth(R + semi, t, beat * len * 0.95, 0.07, L, 1200, 'square', 6);
        this.kick(t, 0.75, L, 90, 34, 0.9);
        this.noiseHit(t, 0.18, 200, 0.7, 0.8, L, 'lowpass');
        for (let k = 1; k < len * 2; k++) this.kick(t + (k * beat) / 2, 0.18, L, 70, 40, 0.25);
        this.next.watch += beat * len;
      } else this.next.watch += beat * 2;
    }

    // music box (safe room)
    const boxBeat = 60 / 62;
    while (this.next.box < ahead) {
      const t = this.next.box;
      const st = this.step.box++;
      const [semi, len] = THEME[st % THEME.length];
      if (this.targets.safe > 0.02) {
        this.bell(R + 24 + semi, t, 0.09, this.layers.safe);
        const chord = CHORDS[Math.floor(st / 5) % CHORDS.length];
        if (st % 5 === 0) for (const c of chord) this.piano(R + 12 + c, t, 0.035, this.layers.safe, 5);
      }
      this.next.box += boxBeat * len;
    }

    // title theme on piano
    const themeBeat = 60 / 54;
    while (this.next.theme < ahead) {
      const t = this.next.theme;
      const st = this.step.theme++;
      const [semi, len] = THEME[st % THEME.length];
      if (this.targets.theme > 0.02) {
        this.piano(R + 24 + semi, t, 0.12, this.layers.theme, 5);
        if (st % 5 === 0) {
          const chord = CHORDS[Math.floor(st / 5) % CHORDS.length];
          for (const c of chord) this.piano(R + c, t + 0.02, 0.05, this.layers.theme, 6);
          this.piano(R - 12 + chord[0], t, 0.07, this.layers.theme, 6);
        }
      }
      this.next.theme += themeBeat * len;
    }
  }
}
