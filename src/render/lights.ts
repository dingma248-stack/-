import * as THREE from 'three';
import { clamp } from '../core/math';

/**
 * Levels declare any number of light *sources*; a fixed pool of PointLights
 * is assigned each frame to the most relevant ones. The shader light count
 * never changes, so there are no recompiles and the cost stays flat.
 */

export type LightKind = 'steady' | 'flicker' | 'buzz' | 'fire' | 'strobe' | 'beacon' | 'pulse' | 'dying';

export interface LightSource {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  kind: LightKind;
  phase: number;
  on: boolean;
  /** Emissive materials whose brightness follows this light. */
  emissive: THREE.Material[];
  emissiveBase: number;
  /** current computed multiplier (for UI / sound coupling) */
  level: number;
  speed: number;
  /** Optional hook (e.g. rotating beacon mesh). */
  onUpdate?: (level: number, t: number) => void;
}

function hash(n: number) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function flickerValue(kind: LightKind, t: number, phase: number, speed: number): number {
  const tt = t * speed + phase * 10;
  switch (kind) {
    case 'steady':
      return 1;
    case 'flicker': {
      // mostly on, with irregular stuttering drop-outs
      const slot = Math.floor(tt * 7);
      const r = hash(slot + phase * 31);
      if (r > 0.94) return 0.05 + hash(slot * 3.1) * 0.2;
      if (r > 0.88) return 0.55;
      return 0.95 + 0.05 * Math.sin(tt * 90);
    }
    case 'dying': {
      const slot = Math.floor(tt * 9);
      const r = hash(slot + phase * 17);
      const longOff = Math.sin(tt * 0.7 + phase) > 0.55;
      if (longOff) return r > 0.85 ? 0.7 : 0.02;
      return r > 0.6 ? 0.9 : r > 0.4 ? 0.35 : 0.05;
    }
    case 'buzz':
      return 0.88 + 0.12 * Math.sin(tt * 120) * hash(Math.floor(tt * 30));
    case 'fire':
      return 0.7 + 0.18 * Math.sin(tt * 9.3) + 0.12 * Math.sin(tt * 23.7 + 1.3) + 0.1 * (hash(Math.floor(tt * 14)) - 0.5);
    case 'strobe':
      return Math.sin(tt * 3) > 0.6 ? 1 : 0.0;
    case 'beacon':
      return Math.pow(Math.max(0, Math.sin(tt * 4.2)), 3);
    case 'pulse':
      return 0.55 + 0.45 * Math.sin(tt * 2.2);
  }
}

export class LightPool {
  readonly sources: LightSource[] = [];
  private pool: THREE.PointLight[] = [];
  private scored: { s: LightSource; score: number }[] = [];

  constructor(private scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      scene.add(l);
      this.pool.push(l);
    }
  }

  add(o: Omit<Partial<LightSource>, 'color' | 'pos'> & { pos: THREE.Vector3; color: THREE.ColorRepresentation }): LightSource {
    const s: LightSource = {
      pos: o.pos.clone(),
      color: new THREE.Color(o.color),
      intensity: o.intensity ?? 6,
      distance: o.distance ?? 8,
      kind: o.kind ?? 'steady',
      phase: o.phase ?? Math.random(),
      on: o.on ?? true,
      emissive: o.emissive ?? [],
      emissiveBase: o.emissiveBase ?? 1,
      level: 1,
      speed: o.speed ?? 1,
      onUpdate: o.onUpdate,
    };
    this.sources.push(s);
    return s;
  }

  remove(s: LightSource) {
    const i = this.sources.indexOf(s);
    if (i >= 0) this.sources.splice(i, 1);
  }

  clear() {
    this.sources.length = 0;
    for (const l of this.pool) l.intensity = 0;
  }

  dispose() {
    for (const l of this.pool) this.scene.remove(l);
    this.pool.length = 0;
  }

  update(t: number, cam: THREE.Vector3) {
    this.scored.length = 0;
    for (const s of this.sources) {
      const lv = s.on ? clamp(flickerValue(s.kind, t, s.phase, s.speed), 0, 1.3) : 0;
      s.level = lv;
      for (const m of s.emissive) {
        const mm = m as THREE.MeshStandardMaterial & THREE.MeshBasicMaterial;
        if ((mm as THREE.MeshStandardMaterial).emissiveIntensity !== undefined && (mm as any).isMeshStandardMaterial)
          (mm as THREE.MeshStandardMaterial).emissiveIntensity = s.emissiveBase * lv;
        else if ((mm as any).isMeshBasicMaterial) (mm as THREE.MeshBasicMaterial).color.copy(s.color).multiplyScalar(0.15 + lv * s.emissiveBase);
      }
      s.onUpdate?.(lv, t);
      if (lv <= 0.01) continue;
      const d = s.pos.distanceTo(cam);
      const reach = s.distance + 10;
      if (d > reach) continue;
      const fade = clamp((reach - d) / 6, 0, 1);
      const score = (s.intensity * lv * fade) / (1 + (d * d) / (s.distance * s.distance));
      this.scored.push({ s, score });
    }
    this.scored.sort((a, b) => b.score - a.score);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i];
      const e = this.scored[i];
      if (!e) {
        l.intensity = 0;
        continue;
      }
      const s = e.s;
      const d = s.pos.distanceTo(cam);
      const reach = s.distance + 10;
      const fade = clamp((reach - d) / 6, 0, 1);
      l.position.copy(s.pos);
      l.color.copy(s.color);
      l.distance = s.distance;
      l.intensity = s.intensity * s.level * fade;
    }
  }
}
