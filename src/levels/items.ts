import * as THREE from 'three';
import { M, stdMat } from '../render/materials';
import { bx, cy } from './props';
import type { ItemId } from '../player/inventory';
import type { WeaponId } from '../config';

/** Small world models for pickups. */
export function itemModel(kind: ItemId | 'key' | 'doc' | 'tape' | WeaponId | 'pouch' | 'vaccine', color = 0xc8b030): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'ammo9':
      bx(g, 0.16, 0.08, 0.1, stdMat({ color: 0x2f3a24, roughness: 0.8 }), 0, 0.04, 0);
      bx(g, 0.1, 0.05, 0.002, stdMat({ color: 0xc0b080, roughness: 0.8 }), 0, 0.045, 0.051);
      break;
    case 'shells':
      bx(g, 0.18, 0.08, 0.1, stdMat({ color: 0x6a1a12, roughness: 0.7 }), 0, 0.04, 0);
      for (let i = 0; i < 4; i++) cy(g, 0.012, 0.06, stdMat({ color: 0x9a2a1a }), -0.06 + i * 0.04, 0.03, 0.08, 6, Math.PI / 2);
      break;
    case 'ammo357':
      bx(g, 0.1, 0.07, 0.08, stdMat({ color: 0x5a3a1a, roughness: 0.7 }), 0, 0.035, 0);
      for (let i = 0; i < 3; i++) cy(g, 0.008, 0.04, stdMat({ color: 0xb08a3a, metalness: 0.9, roughness: 0.3 }), -0.03 + i * 0.03, 0.09, 0, 6);
      break;
    case 'grenade':
      for (let i = 0; i < 2; i++) {
        cy(g, 0.022, 0.1, stdMat({ color: 0x4a5a2a, roughness: 0.6 }), -0.03 + i * 0.06, 0.05, 0, 8);
        cy(g, 0.022, 0.03, stdMat({ color: 0xb08a3a, metalness: 0.8, roughness: 0.3 }), -0.03 + i * 0.06, 0.005, 0, 8);
      }
      break;
    case 'bandage':
      cy(g, 0.05, 0.08, M.white(), 0, 0.04, 0, 10, Math.PI / 2);
      break;
    case 'medkit':
      bx(g, 0.28, 0.1, 0.2, stdMat({ color: 0xd8d4c8, roughness: 0.6 }), 0, 0.05, 0);
      bx(g, 0.1, 0.002, 0.03, M.red(), 0, 0.101, 0);
      bx(g, 0.03, 0.002, 0.1, M.red(), 0, 0.101, 0);
      break;
    case 'battery':
      cy(g, 0.02, 0.09, stdMat({ color: 0x1a1a1a, roughness: 0.4 }), 0, 0.02, 0, 8, 0, Math.PI / 2);
      cy(g, 0.021, 0.03, stdMat({ color: 0xc89020, roughness: 0.4, metalness: 0.4 }), 0.04, 0.02, 0, 8, 0, Math.PI / 2);
      cy(g, 0.02, 0.09, stdMat({ color: 0x1a1a1a, roughness: 0.4 }), 0, 0.02, 0.045, 8, 0, Math.PI / 2);
      break;
    case 'key':
      bx(g, 0.09, 0.004, 0.055, stdMat({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.15 }), 0, 0.003, 0);
      bx(g, 0.03, 0.005, 0.02, stdMat({ color: 0xc8b060, metalness: 0.8, roughness: 0.3 }), -0.02, 0.005, 0);
      break;
    case 'doc':
      bx(g, 0.21, 0.004, 0.29, M.paper(), 0, 0.002, 0, 0.3);
      bx(g, 0.21, 0.004, 0.29, M.paper(), 0.02, 0.006, 0.01, 0.1);
      break;
    case 'tape':
      bx(g, 0.1, 0.015, 0.064, stdMat({ color: 0x1a1a1a, roughness: 0.4 }), 0, 0.008, 0);
      bx(g, 0.06, 0.002, 0.03, stdMat({ color: 0xd8c8a0 }), 0, 0.016, 0);
      break;
    case 'pouch':
      bx(g, 0.3, 0.16, 0.12, stdMat({ color: 0x3a3a2a, roughness: 1 }), 0, 0.08, 0);
      bx(g, 0.3, 0.04, 0.13, stdMat({ color: 0x2a2a1e, roughness: 1 }), 0, 0.15, 0);
      break;
    case 'vaccine':
      cy(g, 0.025, 0.14, stdMat({ color: 0x2a6aaa, emissive: 0x4ab0ff, emissiveIntensity: 0.9, transparent: true, opacity: 0.8 }), 0, 0.07, 0, 8);
      cy(g, 0.026, 0.03, M.steel(), 0, 0.15, 0, 8);
      break;
    case 'pistol':
      bx(g, 0.19, 0.035, 0.032, M.gunmetal(), 0, 0.02, 0);
      bx(g, 0.035, 0.1, 0.03, M.black(), -0.06, 0.02, 0.06, 0, Math.PI / 2 - 0.3);
      break;
    case 'shotgun':
      bx(g, 0.9, 0.04, 0.05, M.gunmetal(), 0, 0.03, 0);
      bx(g, 0.35, 0.06, 0.05, M.wood(), -0.5, 0.03, 0);
      bx(g, 0.22, 0.05, 0.06, M.wood(), 0.2, 0.03, 0.02);
      break;
    case 'magnum':
      bx(g, 0.22, 0.03, 0.03, M.steel(), 0.05, 0.02, 0);
      cy(g, 0.03, 0.05, M.steel(), -0.02, 0.025, 0, 8, 0, Math.PI / 2);
      bx(g, 0.04, 0.1, 0.03, M.wood(), -0.1, 0.02, 0.05, 0, Math.PI / 2 - 0.3);
      break;
    case 'launcher':
      cy(g, 0.05, 0.5, stdMat({ color: 0x3a4230, roughness: 0.6 }), 0, 0.05, 0, 10, 0, Math.PI / 2);
      bx(g, 0.3, 0.05, 0.05, M.black(), -0.35, 0.04, 0);
      break;
    default:
      bx(g, 0.12, 0.12, 0.12, M.crate(), 0, 0.06, 0);
  }
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  return g;
}

let glintTex: THREE.Texture | null = null;
export function glintSprite() {
  if (!glintTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(255,240,200,1)';
    x.fillRect(7, 2, 2, 12);
    x.fillRect(2, 7, 12, 2);
    x.fillStyle = 'rgba(255,255,255,1)';
    x.fillRect(6, 6, 4, 4);
    glintTex = new THREE.CanvasTexture(c);
    glintTex.magFilter = THREE.NearestFilter;
    glintTex.minFilter = THREE.NearestFilter;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: true }));
  s.scale.setScalar(0.12);
  return s;
}
