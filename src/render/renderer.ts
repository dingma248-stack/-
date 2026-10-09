import * as THREE from 'three';
import { settings } from '../core/settings';
import { retroUniforms } from './materials';

/**
 * Retro pipeline:
 *  1. scene + viewmodel render into a low-res target (e.g. 480×270)
 *  2. grading / bloom / grain / dither / damage FX at low res into a second target
 *  3. nearest-neighbour upscale to the canvas, with an optional CRT pass
 */

const POST_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const POST_FS = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform float uTime;
uniform float uGrain;
uniform float uVignette;
uniform float uDamage;
uniform float uLowHealth;
uniform float uFade;
uniform float uFlash;
uniform float uLevels;
uniform float uSat;
uniform float uContrast;
uniform float uBloom;
uniform float uDither;
uniform vec3 uLift;
uniform vec3 uGain;
uniform vec3 uFadeColor;
uniform float uBright;
varying vec2 vUv;

// 4x4 Bayer matrix (0 8 2 10 / 12 4 14 6 / 3 11 1 9 / 15 7 13 5) built from the 2x2 one
// arithmetically: a per-pixel local array with a dynamic index is slow on some GPUs/drivers.
float bayer4(vec2 p) {
  vec2 a = mod(p, 2.0);
  vec2 b = mod(floor(p * 0.5), 2.0);
  return (4.0 * mod(2.0 * a.x + 3.0 * a.y, 4.0) + mod(2.0 * b.x + 3.0 * b.y, 4.0)) / 16.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 px = floor(vUv * uRes);
  vec2 uv = (px + 0.5) / uRes;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // offsets below were tuned in 270p pixels: keep them the same size on screen at 360p / 540p
  vec2 tex = uRes.y / 270.0 / uRes;

  // chromatic aberration grows with damage and towards the edges; faint while unhurt, where its one-pixel
  // red/blue fringes on thin bright lines (tubes, window frames) read as rendering glitches
  float ca = (0.3 + uDamage * 3.5) * r2 * 2.0;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + c * ca * tex * 6.0).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - c * ca * tex * 6.0).b;

  // cheap single-pass bloom: ring of taps around the pixel
  // (offsets are the old loop's vec2(cos(i * 2.39996), sin(i * 2.39996)) * (1.5 + i * 0.55), precomputed)
  vec3 glow = vec3(0.0);
  #define TAP(x, y) glow += max(texture2D(tDiffuse, uv + vec2(x, y) * tex).rgb - 0.55, 0.0);
  TAP(1.5, 0.0) TAP(-1.51160169, 1.38476002) TAP(0.227290154, -2.59004617) TAP(1.91660666, 2.49982381)
  TAP(-3.64344811, -0.644426167) TAP(3.58592319, -2.28115225) TAP(-1.24601078, 4.63545656) TAP(-2.46596003, -4.74779320)
  TAP(5.54204798, 2.02378464) TAP(-5.96195745, 2.46121216) TAP(2.96671724, -6.34023571) TAP(2.25984907, 7.20385885)
  col += glow * uBloom / 12.0 * 1.6;

  // linear -> display (gamma) space; everything below operates perceptually
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  col = pow(col, vec3(1.0 / uBright));

  // grade
  col = col * uGain + uLift * (1.0 - col);
  col = (col - 0.5) * uContrast + 0.5;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat * (1.0 - uLowHealth * 0.8));

  // vignette + damage red edges
  float vig = smoothstep(0.95, 0.25, sqrt(r2) * 1.35);
  col *= mix(1.0, vig, uVignette + uLowHealth * 0.35);
  float edge = smoothstep(0.18, 0.55, sqrt(r2));
  col = mix(col, vec3(0.45, 0.0, 0.02), edge * clamp(uDamage * 0.85 + uLowHealth * 0.25 * (0.6 + 0.4 * sin(uTime * 5.0)), 0.0, 0.85));

  // film grain at low-res pixel scale, strongest in the mid-tones like real film: a flat amount buries the
  // near-black shadows this game lives in under crawling noise
  float g = hash(px + fract(uTime * 13.17) * 91.0) - 0.5;
  col += g * uGrain * (0.35 + 0.65 * smoothstep(0.0, 0.35, l));

  col += uFlash;
  col = mix(col, uFadeColor, uFade);

  // ordered dither + quantise to limited colour depth
  float b = bayer4(px) - 0.5;
  col = floor(col * uLevels + b * uDither + 0.5) / uLevels;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

const BLIT_FS = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uRes;
uniform vec2 uScreen;
uniform float uCrt;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  if (uCrt > 0.5) {
    vec2 c = uv * 2.0 - 1.0;
    c *= 1.0 + dot(c.yx, c.yx) * vec2(0.035, 0.05);
    uv = c * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  vec3 col = texture2D(tDiffuse, uv).rgb;
  if (uCrt > 0.5) {
    float line = sin((uv.y * uRes.y) * 3.14159 * 2.0) * 0.5 + 0.5;
    col *= 0.78 + 0.22 * line;
    float mask = mod(gl_FragCoord.x, 3.0);
    col *= vec3(mask < 1.0 ? 1.08 : 0.94, mask >= 1.0 && mask < 2.0 ? 1.08 : 0.94, mask >= 2.0 ? 1.08 : 0.94);
    vec2 c = uv - 0.5;
    col *= smoothstep(0.75, 0.35, length(c * vec2(0.9, 1.1)));
    col *= 1.12;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface Grade {
  lift: THREE.Color;
  gain: THREE.Color;
  sat: number;
  contrast: number;
  bloom: number;
}

export class RetroRenderer {
  readonly gl: THREE.WebGLRenderer;
  private lowRT!: THREE.WebGLRenderTarget;
  private postRT!: THREE.WebGLRenderTarget;
  private postScene = new THREE.Scene();
  private blitScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly post: THREE.ShaderMaterial;
  readonly blit: THREE.ShaderMaterial;
  lowW = 480;
  lowH = 270;
  /** Extra FX inputs driven by gameplay. */
  fx = { damage: 0, lowHealth: 0, fade: 0, flash: 0, grain: 0.05 };

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.gl.setPixelRatio(1);
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.autoClear = false;

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VS,
      fragmentShader: POST_FS,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2() },
        uTime: { value: 0 },
        uGrain: { value: 0.05 },
        uVignette: { value: 0.55 },
        uDamage: { value: 0 },
        uLowHealth: { value: 0 },
        uFade: { value: 0 },
        uFlash: { value: 0 },
        uLevels: { value: 64 }, // at 40 the dither crosshatch stood out over the dark gradients on 1080p screens
        uSat: { value: 0.9 },
        uContrast: { value: 1.06 },
        uBloom: { value: 0.6 },
        uDither: { value: 1 },
        uLift: { value: new THREE.Color(0.0, 0.0, 0.0) },
        uGain: { value: new THREE.Color(1, 1, 1) },
        uFadeColor: { value: new THREE.Color(0, 0, 0) },
        uBright: { value: 1 },
      },
    });
    this.blit = new THREE.ShaderMaterial({
      vertexShader: POST_VS,
      fragmentShader: BLIT_FS,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new THREE.Vector2() },
        uScreen: { value: new THREE.Vector2() },
        uCrt: { value: 0 },
      },
    });
    const geo = new THREE.PlaneGeometry(2, 2);
    this.postScene.add(new THREE.Mesh(geo, this.post));
    this.blitScene.add(new THREE.Mesh(geo, this.blit));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Without CRT the last pass is a plain nearest-neighbour upscale, so the post pass draws straight into a
   * low-res canvas and CSS (#game { image-rendering: pixelated }) scales it: no full-window blit pass.
   */
  private direct = false;

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.lowH = settings.resScale;
    this.lowW = Math.max(160, Math.round((this.lowH * w) / h));
    this.direct = !settings.crt;
    if (this.direct) this.gl.setSize(this.lowW, this.lowH, false);
    else this.gl.setSize(w, h, false);
    this.gl.domElement.style.width = w + 'px';
    this.gl.domElement.style.height = h + 'px';
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(this.lowW, this.lowH, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        type: THREE.HalfFloatType,
      });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      return rt;
    };
    this.lowRT?.dispose();
    this.postRT?.dispose();
    this.lowRT = mk();
    this.postRT = mk();
    this.postRT.depthBuffer = false;
    this.post.uniforms.uRes.value.set(this.lowW, this.lowH);
    this.blit.uniforms.uRes.value.set(this.lowW, this.lowH);
    this.blit.uniforms.uScreen.value.set(w, h);
    retroUniforms.uSnapRes.value.set(this.lowW, this.lowH);
  }

  setGrade(g: Partial<Grade>) {
    const u = this.post.uniforms;
    if (g.lift) u.uLift.value.copy(g.lift);
    if (g.gain) u.uGain.value.copy(g.gain);
    if (g.sat !== undefined) u.uSat.value = g.sat;
    if (g.contrast !== undefined) u.uContrast.value = g.contrast;
    if (g.bloom !== undefined) u.uBloom.value = g.bloom;
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number, view?: { scene: THREE.Scene; camera: THREE.Camera }) {
    if (this.lowH !== settings.resScale || this.direct === settings.crt) this.resize();
    retroUniforms.uSnapStrength.value = settings.vertexSnap;
    retroUniforms.uTime.value = time;
    const gl = this.gl;
    gl.setRenderTarget(this.lowRT);
    gl.setClearColor(scene.background instanceof THREE.Color ? scene.background : new THREE.Color(0), 1);
    gl.clear(true, true, false);
    gl.render(scene, camera);
    if (view) {
      gl.clearDepth();
      gl.render(view.scene, view.camera);
    }
    const u = this.post.uniforms;
    u.tDiffuse.value = this.lowRT.texture;
    u.uTime.value = time;
    u.uDamage.value = this.fx.damage;
    u.uLowHealth.value = this.fx.lowHealth;
    u.uFade.value = this.fx.fade;
    u.uFlash.value = this.fx.flash;
    u.uGrain.value = this.fx.grain;
    u.uBright.value = settings.brightness;
    if (this.direct) {
      gl.setRenderTarget(null);
      gl.render(this.postScene, this.quadCam);
      return;
    }
    gl.setRenderTarget(this.postRT);
    gl.render(this.postScene, this.quadCam);
    this.blit.uniforms.tDiffuse.value = this.postRT.texture;
    this.blit.uniforms.uCrt.value = settings.crt ? 1 : 0;
    gl.setRenderTarget(null);
    gl.clear(true, true, false);
    gl.render(this.blitScene, this.quadCam);
  }
}
