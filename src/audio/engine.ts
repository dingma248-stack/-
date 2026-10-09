import * as THREE from 'three';
import { settings, onSettingsChange } from '../core/settings';
import { impulseResponse } from './dsp';
import { RECIPES, LOOPS } from './sfx';

export type Bus = 'sfx' | 'music' | 'voice' | 'ui';
export type ReverbKind = 'room' | 'hall' | 'corridor' | 'sewer' | 'outdoor' | 'none';

export interface PlayOpts {
  pos?: THREE.Vector3;
  vol?: number;
  rate?: number;
  rateVar?: number;
  reverb?: number; // send amount
  bus?: Bus;
  loop?: boolean;
  ref?: number; // panner ref distance
  rolloff?: number;
  delay?: number;
  occlude?: boolean;
  lowpass?: number;
  variant?: number;
}

export interface Voice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  panner?: PannerNode;
  filter: BiquadFilterNode;
  pos?: THREE.Vector3;
  stop(fade?: number): void;
  setPos(p: THREE.Vector3): void;
  setVol(v: number, t?: number): void;
  ended: boolean;
}

const REVERB_PRESETS: Record<ReverbKind, { sec: number; decay: number; bright: number; send: number }> = {
  room: { sec: 1.1, decay: 3.5, bright: 0.35, send: 0.28 },
  hall: { sec: 2.6, decay: 2.6, bright: 0.25, send: 0.38 },
  corridor: { sec: 1.6, decay: 3, bright: 0.45, send: 0.35 },
  sewer: { sec: 3.4, decay: 2.2, bright: 0.3, send: 0.5 },
  outdoor: { sec: 2.2, decay: 4.5, bright: 0.12, send: 0.2 },
  none: { sec: 0.3, decay: 6, bright: 0.2, send: 0 },
};

export class AudioEngine {
  ctx: AudioContext;
  private master: GainNode;
  private comp: DynamicsCompressorNode;
  readonly buses: Record<Bus, GainNode>;
  private reverb: ConvolverNode;
  private reverbIn: GainNode;
  private reverbOut: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private voices = new Set<Voice>();
  private irCache = new Map<ReverbKind, AudioBuffer>();
  reverbKind: ReverbKind = 'room';
  ready = false;
  /** occlusion test supplied by the game (true if blocked) */
  occluder: ((from: THREE.Vector3, to: THREE.Vector3) => boolean) | null = null;
  private listenerPos = new THREE.Vector3();
  private duck: GainNode;

  constructor() {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.2;
    this.duck = this.ctx.createGain();
    this.master.connect(this.comp).connect(this.ctx.destination);
    this.buses = {
      sfx: this.ctx.createGain(),
      music: this.ctx.createGain(),
      voice: this.ctx.createGain(),
      ui: this.ctx.createGain(),
    };
    this.buses.sfx.connect(this.duck).connect(this.master);
    this.buses.music.connect(this.master);
    this.buses.voice.connect(this.master);
    this.buses.ui.connect(this.master);
    this.reverbIn = this.ctx.createGain();
    this.reverb = this.ctx.createConvolver();
    this.reverbOut = this.ctx.createGain();
    this.reverbIn.connect(this.reverb).connect(this.reverbOut).connect(this.duck);
    this.applyVolumes();
    onSettingsChange(() => this.applyVolumes());
    this.setReverb('room');
  }

  applyVolumes() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(settings.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(settings.sfx, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(settings.voice, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(settings.voice, t, 0.05);
  }

  async resume() {
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* ignored */
      }
    }
  }

  /** Bake every recipe into buffers. Yields regularly so the UI stays responsive. */
  async bake(onProgress?: (p: number) => void) {
    const sr = this.ctx.sampleRate;
    const names = Object.keys(RECIPES);
    const loops = Object.keys(LOOPS);
    const total = names.length + loops.length;
    let done = 0;
    let lastYield = performance.now();
    const maybeYield = async () => {
      if (performance.now() - lastYield > 24) {
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    };
    for (const n of names) {
      const r = RECIPES[n];
      const arr: AudioBuffer[] = [];
      for (let v = 0; v < r.variants; v++) {
        const sig = r.make(sr, v);
        const b = this.ctx.createBuffer(1, sig.n, sr);
        b.copyToChannel(sig.d as Float32Array<ArrayBuffer>, 0);
        arr.push(b);
        await maybeYield();
      }
      this.buffers.set(n, arr);
      onProgress?.(++done / total);
    }
    for (const n of loops) {
      const sig = LOOPS[n](sr);
      const b = this.ctx.createBuffer(1, sig.n, sr);
      b.copyToChannel(sig.d as Float32Array<ArrayBuffer>, 0);
      this.buffers.set('loop_' + n, [b]);
      onProgress?.(++done / total);
      await maybeYield();
    }
    for (const k of Object.keys(REVERB_PRESETS) as ReverbKind[]) {
      const p = REVERB_PRESETS[k];
      this.irCache.set(k, impulseResponse(this.ctx, p.sec, p.decay, p.bright));
      await maybeYield();
    }
    this.setReverb(this.reverbKind);
    this.ready = true;
  }

  /** Register an externally loaded buffer (for future CC0 asset replacement). */
  register(name: string, buf: AudioBuffer) {
    this.buffers.set(name, [buf]);
  }

  setReverb(kind: ReverbKind) {
    this.reverbKind = kind;
    const ir = this.irCache.get(kind);
    if (ir) {
      // swap convolver with a short dip to avoid clicks
      const t = this.ctx.currentTime;
      this.reverbOut.gain.setTargetAtTime(0, t, 0.02);
      setTimeout(() => {
        try {
          this.reverb.buffer = ir;
        } catch {
          /* ignored */
        }
        this.reverbOut.gain.setTargetAtTime(1, this.ctx.currentTime, 0.05);
      }, 80);
    }
  }

  setListener(cam: THREE.Camera) {
    const l = this.ctx.listener;
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    cam.getWorldPosition(p);
    cam.getWorldQuaternion(q);
    this.listenerPos.copy(p);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.01);
      l.positionY.setTargetAtTime(p.y, t, 0.01);
      l.positionZ.setTargetAtTime(p.z, t, 0.01);
      l.forwardX.setTargetAtTime(f.x, t, 0.01);
      l.forwardY.setTargetAtTime(f.y, t, 0.01);
      l.forwardZ.setTargetAtTime(f.z, t, 0.01);
      l.upX.setTargetAtTime(u.x, t, 0.01);
      l.upY.setTargetAtTime(u.y, t, 0.01);
      l.upZ.setTargetAtTime(u.z, t, 0.01);
    } else {
      (l as any).setPosition(p.x, p.y, p.z);
      (l as any).setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  }

  has(name: string) {
    return this.buffers.has(name);
  }

  play(name: string, o: PlayOpts = {}): Voice | null {
    const list = this.buffers.get(name);
    if (!list || this.ctx.state !== 'running') return null;
    if (this.voices.size > 64) {
      // steal the oldest non-looping voice
      for (const v of this.voices) {
        if (!v.src.loop) {
          v.stop(0.01);
          break;
        }
      }
    }
    const ctx = this.ctx;
    const buf = list[o.variant ?? Math.floor(Math.random() * list.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!o.loop;
    const rate = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.rateVar ?? 0.06));
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.lowpass ?? 20000;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = o.vol ?? 1;
    src.connect(filter);
    let tail: AudioNode = filter;
    let panner: PannerNode | undefined;
    if (o.pos) {
      panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = o.ref ?? 1.6;
      panner.rolloffFactor = o.rolloff ?? 1.1;
      panner.maxDistance = 80;
      const t = ctx.currentTime;
      if (panner.positionX) {
        panner.positionX.setValueAtTime(o.pos.x, t);
        panner.positionY.setValueAtTime(o.pos.y, t);
        panner.positionZ.setValueAtTime(o.pos.z, t);
      } else (panner as any).setPosition(o.pos.x, o.pos.y, o.pos.z);
      tail.connect(panner);
      tail = panner;
      if (o.occlude !== false && this.occluder && this.occluder(this.listenerPos, o.pos)) {
        filter.frequency.value = Math.min(filter.frequency.value, 700);
        gain.gain.value *= 0.55;
      }
    }
    tail.connect(gain);
    const bus = this.buses[o.bus ?? 'sfx'];
    gain.connect(bus);
    const send = o.reverb ?? REVERB_PRESETS[this.reverbKind].send;
    let sendGain: GainNode | null = null;
    if (send > 0 && (o.bus ?? 'sfx') === 'sfx') {
      sendGain = ctx.createGain();
      sendGain.gain.value = send;
      gain.connect(sendGain).connect(this.reverbIn);
    }
    const when = ctx.currentTime + (o.delay ?? 0);
    src.start(when);
    const voice: Voice = {
      src,
      gain,
      panner,
      filter,
      pos: o.pos?.clone(),
      ended: false,
      stop: (fade = 0.05) => {
        if (voice.ended) return;
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(0, t + fade);
        try {
          src.stop(t + fade + 0.01);
        } catch {
          /* ignored */
        }
      },
      setPos: (p: THREE.Vector3) => {
        if (!panner) return;
        const t = ctx.currentTime;
        if (panner.positionX) {
          panner.positionX.setTargetAtTime(p.x, t, 0.02);
          panner.positionY.setTargetAtTime(p.y, t, 0.02);
          panner.positionZ.setTargetAtTime(p.z, t, 0.02);
        } else (panner as any).setPosition(p.x, p.y, p.z);
        voice.pos?.copy(p);
      },
      setVol: (v: number, tc = 0.1) => gain.gain.setTargetAtTime(v, ctx.currentTime, tc),
    };
    src.onended = () => {
      voice.ended = true;
      this.voices.delete(voice);
      try {
        gain.disconnect();
        sendGain?.disconnect();
      } catch {
        /* ignored */
      }
    };
    this.voices.add(voice);
    return voice;
  }

  loop(name: string, o: PlayOpts = {}) {
    return this.play('loop_' + name, { ...o, loop: true, rateVar: 0 });
  }

  /** Update occlusion for looping positional voices (called a few times per second). */
  updateOcclusion() {
    if (!this.occluder) return;
    for (const v of this.voices) {
      if (!v.src.loop || !v.pos || !v.panner) continue;
      const blocked = this.occluder(this.listenerPos, v.pos);
      v.filter.frequency.setTargetAtTime(blocked ? 700 : 20000, this.ctx.currentTime, 0.15);
    }
  }

  /** Duck world sounds (e.g. during pause or a stinger). */
  setDuck(v: number, tc = 0.2) {
    this.duck.gain.setTargetAtTime(v, this.ctx.currentTime, tc);
  }

  stopAll(fade = 0.3) {
    for (const v of this.voices) v.stop(fade);
  }

  stopWorld(fade = 0.3) {
    for (const v of this.voices) {
      v.stop(fade);
    }
  }
}
