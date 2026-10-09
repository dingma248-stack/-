import * as THREE from 'three';

/**
 * Grid navigation (1 cell = 1 m) generated from the level map. Supports
 * height steps (stairs) and dynamic blocking (locked doors, large props).
 */
export class NavGrid {
  readonly walk: Uint8Array;
  readonly height: Float32Array;
  readonly blocked: Uint8Array;
  private gScore: Float32Array;
  private fScore: Float32Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private iter = 1;

  constructor(public w: number, public h: number, public cell = 1) {
    const n = w * h;
    this.walk = new Uint8Array(n);
    this.height = new Float32Array(n);
    this.blocked = new Uint8Array(n);
    this.gScore = new Float32Array(n);
    this.fScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  idx(x: number, z: number) {
    return z * this.w + x;
  }
  cellOf(p: THREE.Vector3): [number, number] {
    return [Math.floor(p.x / this.cell), Math.floor(p.z / this.cell)];
  }
  inside(x: number, z: number) {
    return x >= 0 && z >= 0 && x < this.w && z < this.h;
  }
  ok(x: number, z: number) {
    if (!this.inside(x, z)) return false;
    const i = this.idx(x, z);
    return this.walk[i] === 1 && this.blocked[i] === 0;
  }
  center(x: number, z: number, out = new THREE.Vector3()) {
    return out.set((x + 0.5) * this.cell, this.height[this.idx(x, z)], (z + 0.5) * this.cell);
  }
  heightAt(p: THREE.Vector3) {
    const [x, z] = this.cellOf(p);
    if (!this.inside(x, z)) return 0;
    return this.height[this.idx(x, z)];
  }

  setBlocked(x: number, z: number, b: boolean) {
    if (this.inside(x, z)) this.blocked[this.idx(x, z)] = b ? 1 : 0;
  }

  /** Clearance check between neighbouring cells (step height). */
  private canStep(a: number, b: number) {
    return Math.abs(this.height[a] - this.height[b]) <= 0.45;
  }

  /** Nearest walkable cell to (x,z) within radius r. */
  nearestWalkable(x: number, z: number, r = 4): [number, number] | null {
    if (this.ok(x, z)) return [x, z];
    for (let d = 1; d <= r; d++)
      for (let dz = -d; dz <= d; dz++)
        for (let dx = -d; dx <= d; dx++) {
          if (Math.abs(dx) !== d && Math.abs(dz) !== d) continue;
          if (this.ok(x + dx, z + dz)) return [x + dx, z + dz];
        }
    return null;
  }

  /** Straight walkable line between cells (supercover). */
  clearLine(x0: number, z0: number, x1: number, z1: number) {
    let dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    let x = x0, z = z0;
    const sx = x1 > x0 ? 1 : -1, sz = z1 > z0 ? 1 : -1;
    let err = dx - dz;
    dx *= 2;
    dz *= 2;
    let prev = this.idx(x, z);
    let n = 0;
    while (n++ < 400) {
      if (!this.ok(x, z)) return false;
      const i = this.idx(x, z);
      if (!this.canStep(prev, i)) return false;
      prev = i;
      if (x === x1 && z === z1) return true;
      if (err > 0) {
        x += sx;
        err -= dz;
      } else if (err < 0) {
        z += sz;
        err += dx;
      } else {
        // passing exactly through a corner: both orthogonal cells must be free
        if (!this.ok(x + sx, z) || !this.ok(x, z + sz)) return false;
        x += sx;
        z += sz;
        err += dx - dz;
      }
    }
    return false;
  }

  findPath(from: THREE.Vector3, to: THREE.Vector3, maxIter = 4000): THREE.Vector3[] | null {
    const s0 = this.cellOf(from), g0 = this.cellOf(to);
    const s = this.nearestWalkable(s0[0], s0[1], 2);
    const g = this.nearestWalkable(g0[0], g0[1], 3);
    if (!s || !g) return null;
    const start = this.idx(s[0], s[1]), goal = this.idx(g[0], g[1]);
    if (start === goal) return [to.clone()];
    const it = ++this.iter;
    const heap: number[] = [];
    const push = (i: number) => {
      heap.push(i);
      let c = heap.length - 1;
      while (c > 0) {
        const p = (c - 1) >> 1;
        if (this.fScore[heap[p]] <= this.fScore[heap[c]]) break;
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let c = 0;
        for (;;) {
          const l = c * 2 + 1, r = l + 1;
          let m = c;
          if (l < heap.length && this.fScore[heap[l]] < this.fScore[heap[m]]) m = l;
          if (r < heap.length && this.fScore[heap[r]] < this.fScore[heap[m]]) m = r;
          if (m === c) break;
          [heap[m], heap[c]] = [heap[c], heap[m]];
          c = m;
        }
      }
      return top;
    };
    const hx = g[0], hz = g[1];
    const heur = (i: number) => {
      const x = i % this.w, z = (i / this.w) | 0;
      const dx = Math.abs(x - hx), dz = Math.abs(z - hz);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    this.stamp[start] = it;
    this.gScore[start] = 0;
    this.fScore[start] = heur(start);
    this.came[start] = -1;
    push(start);
    let found = false;
    let n = 0;
    while (heap.length && n++ < maxIter) {
      const cur = pop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closed[cur] === it) continue;
      this.closed[cur] = it;
      const cx = cur % this.w, cz = (cur / this.w) | 0;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!this.ok(nx, nz)) continue;
          if (dx && dz && (!this.ok(cx + dx, cz) || !this.ok(cx, cz + dz))) continue;
          const ni = this.idx(nx, nz);
          if (!this.canStep(cur, ni)) continue;
          if (this.closed[ni] === it) continue;
          const cost = this.gScore[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (this.stamp[ni] !== it || cost < this.gScore[ni]) {
            this.stamp[ni] = it;
            this.gScore[ni] = cost;
            this.fScore[ni] = cost + heur(ni);
            this.came[ni] = cur;
            push(ni);
          }
        }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.came[c]) cells.push(c);
    cells.reverse();
    // string-pull smoothing
    const out: THREE.Vector3[] = [];
    let anchor = 0;
    for (let i = 2; i < cells.length; i++) {
      const a = cells[anchor], b = cells[i];
      if (!this.clearLine(a % this.w, (a / this.w) | 0, b % this.w, (b / this.w) | 0)) {
        const k = cells[i - 1];
        out.push(this.center(k % this.w, (k / this.w) | 0));
        anchor = i - 1;
      }
    }
    out.push(to.clone().setY(this.height[goal]));
    return out;
  }
}
