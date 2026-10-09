import * as THREE from 'three';
import { TEX } from './textures';
import { applyRetro } from './materials';

/** Pooled oriented quads for bullet holes, blood and scorch marks. */
export class Decals {
  readonly group = new THREE.Group();
  private items: { mesh: THREE.Mesh; age: number; life: number }[] = [];
  private mats: Record<string, THREE.Material[]> = {};
  private geo = new THREE.PlaneGeometry(1, 1);
  private max = 90;

  constructor() {
    const mk = (map: THREE.Texture, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      applyRetro(
        new THREE.MeshStandardMaterial({
          map,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          roughness: 0.4,
          ...opts,
        }),
      );
    this.mats.hole = [mk(TEX.bulletHole(), { roughness: 1 })];
    this.mats.blood = [0, 1, 2].map((v) => mk(TEX.bloodDecal(v), { roughness: 0.25 }));
    this.mats.scorch = [mk(TEX.scorch(), { roughness: 1 })];
    this.mats.hand = [mk(TEX.handprint(), { roughness: 0.4 })];
    this.mats.drag = [mk(TEX.drag(), { roughness: 0.3 })];
  }

  add(kind: 'hole' | 'blood' | 'scorch' | 'hand' | 'drag', pos: THREE.Vector3, normal: THREE.Vector3, size: number, life = 60, rot = Math.random() * Math.PI * 2) {
    const list = this.mats[kind];
    const mat = list[Math.floor(Math.random() * list.length)];
    let item: { mesh: THREE.Mesh; age: number; life: number };
    if (this.items.length >= this.max) {
      item = this.items.shift()!;
      item.mesh.material = mat;
    } else {
      item = { mesh: new THREE.Mesh(this.geo, mat), age: 0, life };
      this.group.add(item.mesh);
    }
    item.age = 0;
    item.life = life;
    const m = item.mesh;
    m.visible = true;
    m.position.copy(pos).addScaledVector(normal, 0.012);
    m.lookAt(pos.clone().add(normal));
    m.rotateZ(rot);
    m.scale.setScalar(size);
    this.items.push(item);
    return m;
  }

  update(dt: number) {
    for (const it of this.items) {
      it.age += dt;
      if (it.age > it.life) it.mesh.visible = false;
    }
  }

  clear() {
    for (const it of this.items) this.group.remove(it.mesh);
    this.items.length = 0;
  }
}

/** Rain streaks that wrap around the camera. */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private mat: THREE.ShaderMaterial;

  constructor(count = 2200, area = 22, height = 14) {
    const pos = new Float32Array(count * 6);
    const seed = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * area;
      const y = Math.random() * height;
      const z = (Math.random() - 0.5) * area;
      pos.set([x, y, z, x, y, z], i * 6);
      seed.set([0, 1], i * 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(seed, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uArea: { value: area },
        uHeight: { value: height },
        uWind: { value: new THREE.Vector2(0.9, 0.3) },
        uColor: { value: new THREE.Color(0x9fb4c8) },
      },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime, uArea, uHeight;
        uniform vec3 uCam;
        uniform vec2 uWind;
        varying float vA;
        #include <fog_pars_vertex>
        void main() {
          vec3 p = position;
          float speed = 11.0 + fract(p.x * 13.1 + p.z * 7.7) * 4.0;
          p.y = mod(p.y - uTime * speed, uHeight);
          vec3 w = vec3(uWind.x, 0.0, uWind.y) * (uHeight - p.y) * 0.08;
          p += w;
          p.x = mod(p.x - uCam.x + uArea * 0.5, uArea) - uArea * 0.5 + uCam.x;
          p.z = mod(p.z - uCam.z + uArea * 0.5, uArea) - uArea * 0.5 + uCam.z;
          p.y += uCam.y - uHeight * 0.45;
          p += aEnd * vec3(uWind.x * 0.04, 0.38, uWind.y * 0.04);
          vA = 1.0 - aEnd * 0.8;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        #include <fog_pars_fragment>
        void main() {
          gl_FragColor = vec4(uColor, 0.2 * vA);
          #include <fog_fragment>
        }
      `,
    });
    this.mesh = new THREE.LineSegments(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  update(t: number, cam: THREE.Vector3) {
    this.mat.uniforms.uTime.value = t;
    this.mat.uniforms.uCam.value.copy(cam);
  }
}
