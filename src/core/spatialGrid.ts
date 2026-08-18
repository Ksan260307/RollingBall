/**
 * A lookup that answers "what is near this spot?" without checking every
 * object in the world.
 *
 * Space is chopped into equal cubes. Each object is filed under the cube it
 * sits in, so a search only has to look at the handful of cubes around the
 * point of interest. The same cube numbering is also what a future
 * play-together mode would use to decide which player's device is in charge
 * of which part of the course.
 *
 * All storage is allocated once up front. Nothing is created while the game
 * is running, so there are no pauses for tidying up memory.
 */

import { mix } from './random';

export class SpatialGrid {
  readonly cellSize: number;
  readonly bucketCount: number;
  /** First object filed in each bucket, or -1. */
  private readonly head: Int32Array;
  /** Next object filed in the same bucket, or -1. */
  private next: Int32Array;
  /**
   * Which cube each object is really in. Two different cubes can land in the
   * same bucket, so a search compares these before believing a match. Without
   * that check a search would now and then hand back something on the far
   * side of the course.
   */
  private cellX: Int32Array;
  private cellY: Int32Array;
  private cellZ: Int32Array;
  private filed = 0;

  constructor(cellSize: number, bucketCount = 1024, capacity = 4096) {
    this.cellSize = Math.max(1, Math.floor(cellSize));
    this.bucketCount = bucketCount;
    this.head = new Int32Array(bucketCount).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.cellX = new Int32Array(capacity);
    this.cellY = new Int32Array(capacity);
    this.cellZ = new Int32Array(capacity);
  }

  /** Which cube a single coordinate falls into. */
  cellIndex(value: number): number {
    return Math.floor(value / this.cellSize);
  }

  /** Which bucket a cube is filed under. */
  bucketOf(cx: number, cy: number, cz: number): number {
    return mix(cx, cy, cz) % this.bucketCount;
  }

  /** Files every object afresh. */
  build(x: Int32Array, y: Int32Array, z: Int32Array, count: number): void {
    this.head.fill(-1);
    if (count > this.next.length) {
      this.next = new Int32Array(count).fill(-1);
      this.cellX = new Int32Array(count);
      this.cellY = new Int32Array(count);
      this.cellZ = new Int32Array(count);
    }
    for (let i = 0; i < count; i++) {
      const cx = this.cellIndex(x[i]);
      const cy = this.cellIndex(y[i]);
      const cz = this.cellIndex(z[i]);
      this.cellX[i] = cx;
      this.cellY[i] = cy;
      this.cellZ[i] = cz;
      const bucket = this.bucketOf(cx, cy, cz);
      this.next[i] = this.head[bucket];
      this.head[bucket] = i;
    }
    this.filed = count;
  }

  /** How many objects are currently filed. */
  get size(): number {
    return this.filed;
  }

  /**
   * Calls `visit` once for every object in a cube near the given point.
   * Objects a little outside the radius are still offered, because the search
   * works in whole cubes, so the caller has to check the real distance.
   */
  forEachNear(
    x: number,
    y: number,
    z: number,
    radius: number,
    visit: (index: number) => void,
  ): void {
    const reach = Math.max(1, Math.ceil(radius / this.cellSize));
    const cx = this.cellIndex(x);
    const cy = this.cellIndex(y);
    const cz = this.cellIndex(z);
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        for (let iz = cz - reach; iz <= cz + reach; iz++) {
          let item = this.head[this.bucketOf(ix, iy, iz)];
          while (item !== -1) {
            if (this.cellX[item] === ix && this.cellY[item] === iy && this.cellZ[item] === iz) {
              visit(item);
            }
            item = this.next[item];
          }
        }
      }
    }
  }

  /** Collects nearby object numbers into an array, for tests and tools. */
  near(x: number, y: number, z: number, radius: number): number[] {
    const found: number[] = [];
    this.forEachNear(x, y, z, radius, (i) => found.push(i));
    // Sorted so the answer never depends on the order things were filed.
    return found.sort((a, b) => a - b);
  }
}
