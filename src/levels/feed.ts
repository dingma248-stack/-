import * as THREE from 'three';
import { ctx } from '../core/ctx';

/** Live CCTV feed: renders the scene from a security camera onto monitor screens. */
export class Feed {
  readonly rt = new THREE.WebGLRenderTarget(160, 120, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  readonly cam = new THREE.PerspectiveCamera(70, 4 / 3, 0.1, 40);
  readonly mat: THREE.ShaderMaterial;
  private frame = 0;
  active = true;
  /** where the monitors are; feed only renders when the player is near */
  near: THREE.Vector3;

  constructor(pos: THREE.Vector3, look: THREE.Vector3, near: THREE.Vector3, label = 'CAM 03') {
    this.cam.position.copy(pos);
    this.cam.lookAt(look);
    this.near = near.clone();
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 120;
    const x = c.getContext('2d')!;
    x.font = '10px monospace';
    x.fillStyle = 'rgba(220,255,230,0.9)';
    x.fillText(label, 6, 14);
    x.fillText('● REC', 118, 14);
    x.fillText('2X/10/09  22:4', 6, 112);
    const overlay = new THREE.CanvasTexture(c);
    overlay.magFilter = THREE.NearestFilter;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tFeed: { value: this.rt.texture }, tOver: { value: overlay }, uTime: { value: 0 }, uGlitch: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform sampler2D tFeed; uniform sampler2D tOver; uniform float uTime; uniform float uGlitch; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        void main(){
          vec2 uv = vUv;
          float roll = step(0.97, fract(uTime * 0.13)) * 0.02 + uGlitch * 0.05 * sin(uv.y * 40.0 + uTime * 30.0);
          uv.x += roll * h(vec2(floor(uv.y * 60.0), floor(uTime * 20.0)));
          vec3 c = texture2D(tFeed, uv).rgb;
          float l = dot(c, vec3(0.3, 0.59, 0.11));
          l = pow(l * 2.2, 0.75);
          vec3 col = vec3(0.55, 0.9, 0.7) * l;
          col *= 0.75 + 0.25 * sin(vUv.y * 360.0 + uTime * 8.0);
          col += (h(vUv * 300.0 + uTime) - 0.5) * 0.18;
          vec4 o = texture2D(tOver, vUv);
          col = mix(col, o.rgb, o.a * (0.6 + 0.4 * step(0.5, fract(uTime))));
          vec2 d = vUv - 0.5; col *= 1.0 - dot(d, d) * 1.6;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }

  update(t: number) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uGlitch.value = Math.max(0, this.mat.uniforms.uGlitch.value - 0.02);
    if (!this.active) return;
    if (ctx.player.pos.distanceTo(this.near) > 9) return;
    if (this.frame++ % 2) return;
    const gl = ctx.renderer.gl;
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(this.rt);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    gl.render(ctx.scene, this.cam);
    gl.setRenderTarget(prev);
  }

  glitch() {
    this.mat.uniforms.uGlitch.value = 1;
  }

  dispose() {
    this.rt.dispose();
    this.mat.dispose();
  }
}
