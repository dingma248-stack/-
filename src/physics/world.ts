import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export { RAPIER };

export const G = {
  STATIC: 1,
  PLAYER: 2,
  ENEMY: 4,
  DEBRIS: 8,
  PROP: 16,
  RAGDOLL: 32,
  SENSOR: 64,
} as const;

export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);

export const GROUPS = {
  static: groups(G.STATIC, 0xffff),
  player: groups(G.PLAYER, G.STATIC | G.ENEMY | G.PROP),
  enemy: groups(G.ENEMY, G.STATIC | G.PLAYER | G.PROP),
  debris: groups(G.DEBRIS, G.STATIC | G.PROP),
  prop: groups(G.PROP, G.STATIC | G.PLAYER | G.ENEMY | G.PROP | G.RAGDOLL | G.DEBRIS),
  ragdoll: groups(G.RAGDOLL, G.STATIC | G.PROP),
  /** for bullets / line of sight */
  bullet: groups(0xffff, G.STATIC | G.PROP | G.RAGDOLL),
  sight: groups(0xffff, G.STATIC),
  /** ground probe for character controllers */
  world: groups(0xffff, G.STATIC | G.PROP),
};

/** Data attached to colliders so hit resolution knows what it touched. */
export interface ColliderTag {
  kind: 'static' | 'prop' | 'ragdoll' | 'debris' | 'door' | 'player' | 'enemy';
  surface?: string; // footstep / impact material
  owner?: unknown;
}

export class Physics {
  world!: RAPIER.World;
  private tags = new Map<number, ColliderTag>();
  private acc = 0;
  readonly fixedDt = 1 / 60;
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  /** bodies created for the current level (cleared on unload) */
  private levelBodies: RAPIER.RigidBody[] = [];

  static async init() {
    await RAPIER.init();
  }

  create() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = this.fixedDt;
    this.world.integrationParameters.numSolverIterations = 4;
    this.tags.clear();
    this.levelBodies.length = 0;
  }

  destroy() {
    try {
      this.world?.free();
    } catch (err) {
      // a world left mid-borrow can't be freed; drop it rather than block the next level
      console.error(err);
    }
    this.tags.clear();
    this.levelBodies.length = 0;
  }

  /** How far the accumulator is into the next fixed step (0..1), for render interpolation. */
  get alpha() {
    return this.acc / this.fixedDt;
  }

  /** Steps at a fixed rate; returns number of substeps taken. */
  step(dt: number, onStep?: (h: number) => void) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= this.fixedDt && n < 4) {
      onStep?.(this.fixedDt);
      this.world.step();
      this.acc -= this.fixedDt;
      n++;
    }
    if (n === 4) this.acc = 0;
    return n;
  }

  /** Force broad-phase update so freshly created colliders are queryable. */
  refresh() {
    this.world.step();
  }

  tag(c: RAPIER.Collider, t: ColliderTag) {
    this.tags.set(c.handle, t);
  }
  tagOf(c: RAPIER.Collider): ColliderTag | undefined {
    return this.tags.get(c.handle);
  }

  addStaticBox(center: THREE.Vector3, half: THREE.Vector3, surface = 'concrete', rot?: THREE.Quaternion) {
    const bd = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
    if (rot) bd.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const body = this.world.createRigidBody(bd);
    const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(GROUPS.static).setFriction(0.8), body);
    this.tag(c, { kind: 'static', surface });
    this.levelBodies.push(body);
    return { body, collider: c };
  }

  addStaticCylinder(center: THREE.Vector3, halfH: number, r: number, surface = 'metal') {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    const c = this.world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setCollisionGroups(GROUPS.static), body);
    this.tag(c, { kind: 'static', surface });
    this.levelBodies.push(body);
    return { body, collider: c };
  }

  addDynamicBox(center: THREE.Vector3, half: THREE.Vector3, mass: number, group: number, tag: ColliderTag, rot?: THREE.Quaternion, ccd = false) {
    const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x, center.y, center.z).setLinearDamping(0.3).setAngularDamping(0.6).setCcdEnabled(ccd);
    if (rot) bd.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    const body = this.world.createRigidBody(bd);
    const vol = half.x * half.y * half.z * 8;
    const c = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setDensity(mass / Math.max(vol, 1e-4)).setCollisionGroups(group).setFriction(0.7).setRestitution(0.15),
      body,
    );
    this.tag(c, tag);
    this.levelBodies.push(body);
    return { body, collider: c };
  }

  addKinematicBox(center: THREE.Vector3, half: THREE.Vector3, tag: ColliderTag, group: number = GROUPS.static) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(center.x, center.y, center.z));
    const c = this.world.createCollider(RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setCollisionGroups(group), body);
    this.tag(c, tag);
    this.levelBodies.push(body);
    return { body, collider: c };
  }

  track(body: RAPIER.RigidBody) {
    this.levelBodies.push(body);
  }

  removeBody(body: RAPIER.RigidBody) {
    // check first: touching a removed body panics inside the wasm, which can't be safely caught
    if (body.isValid()) {
      for (let i = 0; i < body.numColliders(); i++) this.tags.delete(body.collider(i).handle);
      this.world.removeRigidBody(body);
    }
    const i = this.levelBodies.indexOf(body);
    if (i >= 0) this.levelBodies.splice(i, 1);
  }

  /** Remove every body created for the current level. */
  clearLevel() {
    for (const b of [...this.levelBodies]) this.removeBody(b);
    this.levelBodies.length = 0;
  }

  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filterGroups: number = GROUPS.bullet, exclude?: RAPIER.Collider) {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filterGroups, exclude);
    if (!hit) return null;
    return {
      dist: hit.timeOfImpact,
      point: origin.clone().addScaledVector(dir, hit.timeOfImpact),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      collider: hit.collider,
      tag: this.tagOf(hit.collider),
    };
  }

  /** True if the straight segment a→b is clear of static geometry. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3, filterGroups: number = GROUPS.sight) {
    const d = b.clone().sub(a);
    const len = d.length();
    if (len < 1e-3) return true;
    d.divideScalar(len);
    this.ray.origin = { x: a.x, y: a.y, z: a.z };
    this.ray.dir = { x: d.x, y: d.y, z: d.z };
    const hit = this.world.castRay(this.ray, len, true, undefined, filterGroups);
    return !hit;
  }

  /** Iterate dynamic bodies within radius (props, ragdolls, debris). */
  bodiesInRadius(center: THREE.Vector3, radius: number, cb: (b: RAPIER.RigidBody, tag: ColliderTag | undefined) => void) {
    const shape = new RAPIER.Ball(radius);
    const seen = new Set<number>();
    const hits: [RAPIER.RigidBody, ColliderTag | undefined][] = [];
    this.world.intersectionsWithShape(
      { x: center.x, y: center.y, z: center.z },
      { x: 0, y: 0, z: 0, w: 1 },
      shape,
      (c) => {
        const b = c.parent();
        if (b && b.isDynamic() && !seen.has(b.handle)) {
          seen.add(b.handle);
          hits.push([b, this.tagOf(c)]);
        }
        return true;
      },
    );
    // Rapier holds the body and collider sets borrowed while the query runs: impulses or
    // adding/removing bodies inside the callback throw and leave the world unusable
    // (it can't even be freed on the next level load), so callers run afterwards.
    for (const [b, tag] of hits) if (b.isValid()) cb(b, tag);
  }
}

export const toV3 = (v: { x: number; y: number; z: number }, out = new THREE.Vector3()) => out.set(v.x, v.y, v.z);
export const toQuat = (q: { x: number; y: number; z: number; w: number }, out = new THREE.Quaternion()) => out.set(q.x, q.y, q.z, q.w);
