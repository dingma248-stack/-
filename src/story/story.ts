import * as THREE from 'three';
import { ctx } from '../core/ctx';
import { input } from '../core/input';
import { easeInOut, clamp } from '../core/math';

/**
 * Script runtime. Chapter scripts are async functions that await game-time
 * waits; on level unload pending promises are simply never resolved, which
 * cleanly abandons the script.
 */

interface Waiter {
  until: () => boolean;
  resolve: () => void;
}

export interface Line {
  who: string;
  text: string;
  hold?: number;
  radio?: boolean;
}

export class Story {
  private waiters: Waiter[] = [];
  private gen = 0;
  skipping = false;
  inCutscene = false;
  flags: Record<string, unknown> = {};
  private camAnim: { from: THREE.Vector3; to: THREE.Vector3; lookFrom: THREE.Vector3; lookTo: THREE.Vector3; t: number; dur: number } | null = null;
  readonly cutCam = new THREE.PerspectiveCamera(60, 1, 0.05, 200);
  private lineQueue: Promise<void> = Promise.resolve();
  private speaking = 0;

  reset() {
    this.gen++;
    this.waiters = [];
    this.skipping = false;
    this.inCutscene = false;
    this.camAnim = null;
    this.lineQueue = Promise.resolve();
    this.speaking = 0;
  }

  update(dt: number) {
    if (this.inCutscene && (input.codePressed('Enter') || input.codePressed('Space') || input.codePressed('Escape'))) this.skipping = true;
    // advance camera animation
    if (this.camAnim) {
      const a = this.camAnim;
      a.t += dt * (this.skipping ? 50 : 1);
      const k = easeInOut(clamp(a.t / a.dur, 0, 1));
      this.cutCam.position.lerpVectors(a.from, a.to, k);
      const look = a.lookFrom.clone().lerp(a.lookTo, k);
      this.cutCam.lookAt(look);
      if (a.t >= a.dur) this.camAnim = null;
    }
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) {
      if (w.until()) w.resolve();
      else this.waiters.push(w);
    }
  }

  /** Game-time wait (pauses with the game, fast-forwards while skipping cutscenes). */
  wait(sec: number): Promise<void> {
    const g = this.gen;
    let t = 0;
    let last = ctx.time;
    return this.until(() => {
      const now = ctx.time;
      t += (now - last) * (this.skipping ? 60 : 1);
      last = now;
      return g === this.gen && t >= sec;
    });
  }

  until(fn: () => boolean): Promise<void> {
    const g = this.gen;
    return new Promise((resolve) => {
      this.waiters.push({ until: () => g === this.gen && fn(), resolve });
    });
  }

  /** Subtitle with typewriter effect; resolves when the line has been shown. */
  say(who: string, text: string, opts: { hold?: number; radio?: boolean; wait?: boolean } = {}): Promise<void> {
    const g = this.gen;
    const run = async () => {
      if (g !== this.gen) return;
      this.speaking++;
      const dur = ctx.ui.subtitle(who, text, opts.radio ?? false);
      const hold = opts.hold ?? Math.max(1.6, text.length * 0.075);
      await this.wait(dur + hold);
      if (g === this.gen) ctx.ui.subtitle(null, '', false);
      this.speaking--;
      await this.wait(0.15);
    };
    this.lineQueue = this.lineQueue.then(run);
    return this.lineQueue;
  }

  get busy() {
    return this.speaking > 0;
  }

  objective(text: string) {
    if (ctx.level) ctx.level.objective = text;
    ctx.ui.objective(text);
  }

  // ---------------- cutscenes ----------------
  async cutscene(body: () => Promise<void>) {
    const g = this.gen;
    this.inCutscene = true;
    this.skipping = false;
    ctx.player.control = false;
    ctx.ui.letterbox(true);
    this.cutCam.position.copy(ctx.player.camera.position);
    this.cutCam.quaternion.copy(ctx.player.camera.quaternion);
    this.cutCam.fov = ctx.player.camera.fov;
    this.cutCam.aspect = ctx.player.camera.aspect;
    this.cutCam.updateProjectionMatrix();
    await body();
    if (g !== this.gen) return;
    this.inCutscene = false;
    this.skipping = false;
    this.camAnim = null;
    ctx.ui.letterbox(false);
    ctx.ui.subtitle(null, '', false);
    ctx.player.control = true;
  }

  get usingCutCam() {
    return this.inCutscene && this.cutActive;
  }
  cutActive = false;

  /** Move the cutscene camera; resolves when done. */
  camTo(pos: THREE.Vector3, look: THREE.Vector3, dur: number, from?: { pos: THREE.Vector3; look: THREE.Vector3 }) {
    this.cutActive = true;
    const curLook = this.cutCam.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(this.cutCam.quaternion).multiplyScalar(5));
    this.camAnim = {
      from: from?.pos.clone() ?? this.cutCam.position.clone(),
      to: pos.clone(),
      lookFrom: from?.look.clone() ?? curLook,
      lookTo: look.clone(),
      t: 0,
      dur: Math.max(0.001, dur),
    };
    if (dur <= 0.001) {
      this.cutCam.position.copy(pos);
      this.cutCam.lookAt(look);
      this.camAnim = null;
      return Promise.resolve();
    }
    return this.until(() => this.camAnim === null);
  }

  /** Return the camera to the player. */
  camRelease() {
    this.cutActive = false;
    this.camAnim = null;
  }
}
