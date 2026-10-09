import * as THREE from 'three';
import { TEX } from './textures';

/**
 * Shared uniforms for the PS1-style vertex snapping applied to every lit
 * material. Clip-space positions are quantised to a coarse grid derived from
 * the low-res target.
 */
export const retroUniforms = {
  uSnapRes: { value: new THREE.Vector2(480, 270) },
  uSnapStrength: { value: 0.6 },
  uTime: { value: 0 },
};

function patchSnap(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uSnapRes = retroUniforms.uSnapRes;
  shader.uniforms.uSnapStrength = retroUniforms.uSnapStrength;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec2 uSnapRes;\nuniform float uSnapStrength;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      if (uSnapStrength > 0.001) {
        vec2 g = uSnapRes * 0.5 / (1.0 + uSnapStrength * 2.5);
        vec2 ndc = gl_Position.xy / gl_Position.w;
        ndc = floor(ndc * g + 0.5) / g;
        gl_Position.xy = ndc * gl_Position.w;
      }`,
    );
}

/** Same patch reused across every material so three.js shares one program per material type. */
export function applyRetro<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = patchSnap;
  return m;
}

export interface MatOpts {
  map?: THREE.Texture | null;
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveMap?: THREE.Texture | null;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  repeat?: [number, number];
  depthWrite?: boolean;
}

export function stdMat(o: MatOpts = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: o.map ?? null,
    color: o.color ?? 0xffffff,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0,
    emissive: o.emissive ?? 0x000000,
    emissiveMap: o.emissiveMap ?? null,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: o.transparent ?? false,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    depthWrite: o.depthWrite ?? true,
  });
  return applyRetro(m);
}

/** Named surface materials for level geometry. Footstep sound key included. */
export type Footstep = 'concrete' | 'tile' | 'water' | 'metal' | 'carpet' | 'wood' | 'flesh';

export interface Surface {
  mat: THREE.MeshStandardMaterial;
  scale: number; // world metres per texture repeat
  step: Footstep;
}

const surfaceCache = new Map<string, Surface>();

const SURFACE_DEFS: Record<string, () => Surface> = {
  concrete: () => ({ mat: stdMat({ map: TEX.concrete(), roughness: 0.92 }), scale: 2, step: 'concrete' }),
  concreteDark: () => ({ mat: stdMat({ map: TEX.concreteDark(), roughness: 0.95 }), scale: 2.5, step: 'concrete' }),
  asphalt: () => ({ mat: stdMat({ map: TEX.asphalt(), roughness: 0.32, metalness: 0.15 }), scale: 4, step: 'concrete' }),
  roadLine: () => ({ mat: stdMat({ map: TEX.roadLine(), roughness: 0.32, metalness: 0.15 }), scale: 4, step: 'concrete' }),
  sidewalk: () => ({ mat: stdMat({ map: TEX.sidewalk(), roughness: 0.5, metalness: 0.05 }), scale: 2, step: 'concrete' }),
  brick: () => ({ mat: stdMat({ map: TEX.brick(), roughness: 0.9 }), scale: 2.5, step: 'concrete' }),
  plaster: () => ({ mat: stdMat({ map: TEX.plaster(), roughness: 0.9 }), scale: 3, step: 'concrete' }),
  plasterYellow: () => ({ mat: stdMat({ map: TEX.plaster(), color: 0xd8c68e, roughness: 0.9 }), scale: 3, step: 'concrete' }),
  plasterGreen: () => ({ mat: stdMat({ map: TEX.plaster(), color: 0xa8c4b4, roughness: 0.9 }), scale: 3, step: 'concrete' }),
  wallpaper: () => ({ mat: stdMat({ map: TEX.wallpaper(), roughness: 0.95 }), scale: 2.5, step: 'concrete' }),
  woodPanel: () => ({ mat: stdMat({ map: TEX.woodPanel(), roughness: 0.75 }), scale: 2.4, step: 'wood' }),
  woodFloor: () => ({ mat: stdMat({ map: TEX.woodFloor(), roughness: 0.6 }), scale: 2.5, step: 'wood' }),
  tileWhite: () => ({ mat: stdMat({ map: TEX.tileWhite(), roughness: 0.35 }), scale: 1.6, step: 'tile' }),
  tileGreen: () => ({ mat: stdMat({ map: TEX.tileGreen(), roughness: 0.4 }), scale: 1.6, step: 'tile' }),
  tileFloor: () => ({ mat: stdMat({ map: TEX.tileFloor(), roughness: 0.4 }), scale: 2, step: 'tile' }),
  linoleum: () => ({ mat: stdMat({ map: TEX.linoleum(), roughness: 0.45 }), scale: 3, step: 'tile' }),
  carpet: () => ({ mat: stdMat({ map: TEX.carpet(), roughness: 1 }), scale: 2, step: 'carpet' }),
  metal: () => ({ mat: stdMat({ map: TEX.metal(), roughness: 0.55, metalness: 0.5 }), scale: 2, step: 'metal' }),
  steel: () => ({ mat: stdMat({ map: TEX.steel(), roughness: 0.3, metalness: 0.7 }), scale: 2, step: 'metal' }),
  rust: () => ({ mat: stdMat({ map: TEX.rust(), roughness: 0.85, metalness: 0.3 }), scale: 2, step: 'metal' }),
  grate: () => ({ mat: stdMat({ map: TEX.grate(), roughness: 0.6, metalness: 0.5 }), scale: 1, step: 'metal' }),
  ceilingTile: () => ({ mat: stdMat({ map: TEX.ceilingTile(), roughness: 0.95 }), scale: 1.2, step: 'concrete' }),
  sewer: () => ({ mat: stdMat({ map: TEX.sewer(), roughness: 0.7 }), scale: 2.5, step: 'concrete' }),
  water: () => ({ mat: stdMat({ map: TEX.water(), roughness: 0.08, metalness: 0.4 }), scale: 3, step: 'water' }),
  flesh: () => ({ mat: stdMat({ map: TEX.flesh(), roughness: 0.35, metalness: 0.1, emissive: 0x220406 }), scale: 2.5, step: 'flesh' }),
  facade: () => ({
    mat: stdMat({ map: TEX.facade(), emissiveMap: TEX.facadeEmissive(), emissive: 0xffffff, emissiveIntensity: 0.8, roughness: 0.9 }),
    scale: 8,
    step: 'concrete',
  }),
};

export function surface(name: string): Surface {
  let s = surfaceCache.get(name);
  if (!s) {
    const def = SURFACE_DEFS[name] ?? SURFACE_DEFS.concrete;
    s = def();
    surfaceCache.set(name, s);
  }
  return s;
}

export function disposeSurfaces() {
  for (const s of surfaceCache.values()) s.mat.dispose();
  surfaceCache.clear();
}

/** Small set of shared prop materials. */
const propCache = new Map<string, THREE.Material>();
export function propMat(key: string, make: () => THREE.Material): THREE.Material {
  let m = propCache.get(key);
  if (!m) {
    m = make();
    propCache.set(key, m);
  }
  return m;
}

export const M = {
  dark: () => propMat('dark', () => stdMat({ color: 0x1a1a1c, roughness: 0.7 })),
  black: () => propMat('black', () => stdMat({ color: 0x0b0b0c, roughness: 0.5, metalness: 0.4 })),
  gunmetal: () => propMat('gunmetal', () => stdMat({ color: 0x2a2c2e, roughness: 0.45, metalness: 0.7 })),
  steel: () => propMat('steelP', () => stdMat({ map: TEX.steel(), roughness: 0.3, metalness: 0.75 })),
  metal: () => propMat('metalP', () => stdMat({ map: TEX.metal(), roughness: 0.55, metalness: 0.5 })),
  rust: () => propMat('rustP', () => stdMat({ map: TEX.rust(), roughness: 0.85, metalness: 0.3 })),
  wood: () => propMat('woodP', () => stdMat({ map: TEX.woodFloor(), roughness: 0.7 })),
  crate: () => propMat('crateP', () => stdMat({ map: TEX.crate(), roughness: 0.85 })),
  paper: () => propMat('paper', () => stdMat({ map: TEX.paper(), roughness: 1 })),
  fabric: () => propMat('fabric', () => stdMat({ map: TEX.cloth(), roughness: 1 })),
  car: (tint: number) => propMat('car' + tint, () => stdMat({ map: TEX.car(), color: tint, roughness: 0.35, metalness: 0.45 })),
  glass: () =>
    propMat('glassP', () =>
      stdMat({ map: TEX.glass(), color: 0xaac8d0, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    ),
  tube: () => propMat('tube', () => new THREE.MeshBasicMaterial({ color: 0xfff6dd })),
  red: () => propMat('redP', () => stdMat({ color: 0x7a1414, roughness: 0.6 })),
  yellow: () => propMat('yellowP', () => stdMat({ color: 0xb08a1a, roughness: 0.6 })),
  white: () => propMat('whiteP', () => stdMat({ color: 0xc9c7bd, roughness: 0.7 })),
  green: () => propMat('greenP', () => stdMat({ color: 0x2f4a3a, roughness: 0.7 })),
  rubber: () => propMat('rubber', () => stdMat({ color: 0x111111, roughness: 0.95 })),
  skin: () => propMat('skin', () => stdMat({ map: TEX.skin(), roughness: 0.75 })),
  cloth: () => propMat('cloth', () => stdMat({ map: TEX.cloth(), roughness: 1 })),
  coat: () => propMat('coat', () => stdMat({ map: TEX.coat(), roughness: 0.85 })),
  fur: () => propMat('fur', () => stdMat({ map: TEX.fur(), roughness: 1 })),
  flesh: () => propMat('fleshP', () => stdMat({ map: TEX.flesh(), roughness: 0.35, emissive: 0x2a0508 })),
  bone: () => propMat('bone', () => stdMat({ color: 0xcfc4a8, roughness: 0.6 })),
  glow: (color: number) => propMat('glow' + color, () => new THREE.MeshBasicMaterial({ color, fog: true })),
};

export function disposeProps() {
  for (const m of propCache.values()) m.dispose();
  propCache.clear();
}
