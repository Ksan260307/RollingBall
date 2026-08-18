/**
 * The small living things scattered along a course: glowing orbs, drifting
 * lanterns, sleepy plants. Each one keeps its whole condition inside two
 * 32-bit slots (64 bits together), which keeps memory tight and makes the
 * checksum of the whole world cheap to compute.
 *
 * Slot layout, low half:
 *   bits  0-15  progress through its rhythm (0 .. 65535, wraps around)
 *   bits 16-31  energy
 * Slot layout, high half:
 *   bits  0-15  tiredness
 *   bits 16-19  stage of life
 *   bit  20     moving (1) or taking a break (0)
 *   bits 21-23  kind
 *   bits 24-31  looks (colour and size variant)
 *
 * Wording shown to the player lives in src/ui/text.ts, never here.
 */

import { Checksum, Generator, mix } from './random';

/** Stages a thing moves through during its life. */
export const Stage = {
  Appearing: 0,
  Growing: 1,
  Full: 2,
  Shifting: 3,
  Done: 4,
  Sleeping: 5,
} as const;

export type StageValue = (typeof Stage)[keyof typeof Stage];

/** What a thing is. */
export const Kind = {
  Orb: 0,
  Lantern: 1,
  Plant: 2,
  Marker: 3,
} as const;

export type KindValue = (typeof Kind)[keyof typeof Kind];

const PROGRESS_MASK = 0xffff;
const ENERGY_SHIFT = 16;
const TIREDNESS_MASK = 0xffff;
const STAGE_SHIFT = 16;
const STAGE_MASK = 0xf;
const MOVING_BIT = 1 << 20;
const KIND_SHIFT = 21;
const KIND_MASK = 0x7;
const LOOKS_SHIFT = 24;
const LOOKS_MASK = 0xff;

/**
 * A fixed-size pool of things. The pool never grows during play, so there is
 * no memory churn and no surprise pauses on weaker phones.
 */
export class EntityStore {
  readonly capacity: number;
  readonly low: Uint32Array;
  readonly high: Uint32Array;
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly z: Int32Array;
  /** How many slots at the front of the pool are in use. */
  count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.low = new Uint32Array(capacity);
    this.high = new Uint32Array(capacity);
    this.x = new Int32Array(capacity);
    this.y = new Int32Array(capacity);
    this.z = new Int32Array(capacity);
  }

  /** Empties the pool without releasing its memory. */
  clear(): void {
    this.low.fill(0);
    this.high.fill(0);
    this.x.fill(0);
    this.y.fill(0);
    this.z.fill(0);
    this.count = 0;
  }

  /** Adds one thing and returns its slot number, or -1 when the pool is full. */
  add(
    x: number,
    y: number,
    z: number,
    kind: number,
    looks: number,
    progress: number,
    energy: number,
  ): number {
    if (this.count >= this.capacity) return -1;
    const index = this.count++;
    this.x[index] = x;
    this.y[index] = y;
    this.z[index] = z;
    this.low[index] = (((energy & 0xffff) << ENERGY_SHIFT) | (progress & PROGRESS_MASK)) >>> 0;
    this.high[index] =
      (((looks & LOOKS_MASK) << LOOKS_SHIFT) |
        ((kind & KIND_MASK) << KIND_SHIFT) |
        MOVING_BIT |
        (Stage.Appearing << STAGE_SHIFT)) >>>
      0;
    return index;
  }

  progressOf(i: number): number {
    return this.low[i] & PROGRESS_MASK;
  }

  energyOf(i: number): number {
    return this.low[i] >>> ENERGY_SHIFT;
  }

  tirednessOf(i: number): number {
    return this.high[i] & TIREDNESS_MASK;
  }

  stageOf(i: number): number {
    return (this.high[i] >>> STAGE_SHIFT) & STAGE_MASK;
  }

  isMoving(i: number): boolean {
    return (this.high[i] & MOVING_BIT) !== 0;
  }

  kindOf(i: number): number {
    return (this.high[i] >>> KIND_SHIFT) & KIND_MASK;
  }

  looksOf(i: number): number {
    return (this.high[i] >>> LOOKS_SHIFT) & LOOKS_MASK;
  }

  setProgress(i: number, value: number): void {
    this.low[i] = ((this.low[i] & ~PROGRESS_MASK) | (value & PROGRESS_MASK)) >>> 0;
  }

  setEnergy(i: number, value: number): void {
    const clamped = value < 0 ? 0 : value > 0xffff ? 0xffff : value;
    this.low[i] = ((this.low[i] & PROGRESS_MASK) | (clamped << ENERGY_SHIFT)) >>> 0;
  }

  setTiredness(i: number, value: number): void {
    const clamped = value < 0 ? 0 : value > 0xffff ? 0xffff : value;
    this.high[i] = ((this.high[i] & ~TIREDNESS_MASK) | clamped) >>> 0;
  }

  setStage(i: number, stage: number): void {
    this.high[i] =
      ((this.high[i] & ~(STAGE_MASK << STAGE_SHIFT)) | ((stage & STAGE_MASK) << STAGE_SHIFT)) >>> 0;
  }

  setKind(i: number, kind: number): void {
    this.high[i] =
      ((this.high[i] & ~(KIND_MASK << KIND_SHIFT)) | ((kind & KIND_MASK) << KIND_SHIFT)) >>> 0;
  }

  setLooks(i: number, looks: number): void {
    this.high[i] =
      ((this.high[i] & ~(LOOKS_MASK << LOOKS_SHIFT)) | ((looks & LOOKS_MASK) << LOOKS_SHIFT)) >>> 0;
  }

  setMoving(i: number, moving: boolean): void {
    if (moving) this.high[i] = (this.high[i] | MOVING_BIT) >>> 0;
    else this.high[i] = (this.high[i] & ~MOVING_BIT) >>> 0;
  }

  /**
   * Where a thing will be any number of steps from now, worked out in one go.
   * Progress simply wraps around when it passes its top value, so looking a
   * thousand steps into the future costs the same as looking one step ahead.
   */
  jumpAhead(i: number, steps: number, speed: number): number {
    return (this.progressOf(i) + steps * speed) & PROGRESS_MASK;
  }

  /** Copies the whole pool into another one, used for rewinding. */
  copyTo(target: EntityStore): void {
    target.low.set(this.low);
    target.high.set(this.high);
    target.x.set(this.x);
    target.y.set(this.y);
    target.z.set(this.z);
    target.count = this.count;
  }

  /** Adds the pool to a checksum so two runs can be compared. */
  checksum(sum: Checksum): void {
    sum.add(this.count);
    for (let i = 0; i < this.count; i++) {
      sum.add(this.low[i]);
      sum.add(this.high[i]);
      sum.add(this.x[i]);
      sum.add(this.y[i]);
      sum.add(this.z[i]);
    }
  }
}

/** How fast each kind of thing goes through its rhythm, per step. */
export const RHYTHM_SPEED = [420, 260, 150, 90];

/** Tiredness at which a thing switches from moving to taking a break. */
export const REST_THRESHOLD = 46000;

/** Tiredness at which a resting thing feels ready to move again. */
export const WAKE_THRESHOLD = 12000;

/**
 * Advances every awake thing by one step.
 *
 * Two kinds of skipping keep this cheap:
 *  - things that are asleep are ignored completely;
 *  - things that are taking a break only recover, and skip the rest.
 *
 * @param liveliness how stirred up the surroundings are, 0 .. 65535
 * @returns how many things did a full update this step
 */
export function advanceEntities(store: EntityStore, liveliness: number): number {
  let busy = 0;
  for (let i = 0; i < store.count; i++) {
    if (store.stageOf(i) === Stage.Sleeping) continue;

    const speed = RHYTHM_SPEED[store.kindOf(i)] ?? 200;

    if (!store.isMoving(i)) {
      // Taking a break: recover, and skip everything else.
      const rested = store.tirednessOf(i) - 900;
      store.setTiredness(i, rested);
      if (rested <= WAKE_THRESHOLD) store.setMoving(i, true);
      continue;
    }

    busy++;
    const progress = (store.progressOf(i) + speed) & PROGRESS_MASK;
    store.setProgress(i, progress);

    store.setTiredness(i, store.tirednessOf(i) + 40 + (liveliness >> 6));
    if (store.tirednessOf(i) >= REST_THRESHOLD) store.setMoving(i, false);

    if (progress < speed) {
      // A rhythm just came round again, so the thing takes a step through life.
      advanceStage(store, i);
    }
  }
  return busy;
}

function advanceStage(store: EntityStore, i: number): void {
  const energy = store.energyOf(i);
  switch (store.stageOf(i)) {
    case Stage.Appearing:
      store.setStage(i, Stage.Growing);
      store.setEnergy(i, energy + 6000);
      break;
    case Stage.Growing:
      if (energy > 45000) store.setStage(i, Stage.Full);
      else store.setEnergy(i, energy + 5000);
      break;
    case Stage.Full:
      if (store.tirednessOf(i) > 30000) store.setStage(i, Stage.Shifting);
      break;
    case Stage.Shifting:
      store.setStage(i, Stage.Done);
      break;
    case Stage.Done:
      store.setStage(i, Stage.Sleeping);
      break;
    default:
      break;
  }
}

/**
 * A short note standing in for a group of things that are out of sight.
 * The members themselves are dropped and rebuilt from this note later.
 */
export interface GroupSummary {
  /** Where the group sits, taken as a whole. */
  x: number;
  y: number;
  z: number;
  /** How many things it stands for. */
  population: number;
  /** Typical energy and tiredness, so the rebuild feels continuous. */
  energy: number;
  tiredness: number;
  /** The step the note was written on; the rebuild starts from it. */
  step: number;
  /** Identifier used to rebuild the very same members again. */
  groupId: number;
}

/**
 * Replaces a run of things with a single note. Used when the player is
 * looking somewhere else, so that faraway scenery costs almost nothing.
 */
export function summarise(
  store: EntityStore,
  from: number,
  to: number,
  step: number,
  groupId: number,
): GroupSummary {
  const end = Math.min(to, store.count);
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let energy = 0;
  let tiredness = 0;
  const population = Math.max(0, end - from);
  for (let i = from; i < end; i++) {
    sx += store.x[i];
    sy += store.y[i];
    sz += store.z[i];
    energy += store.energyOf(i);
    tiredness += store.tirednessOf(i);
  }
  const divisor = population || 1;
  return {
    x: Math.floor(sx / divisor),
    y: Math.floor(sy / divisor),
    z: Math.floor(sz / divisor),
    population,
    energy: Math.floor(energy / divisor),
    tiredness: Math.floor(tiredness / divisor),
    step,
    groupId,
  };
}

/**
 * Wakes a run of things back up, filling their slots in from the note that
 * was left behind. Two devices given the same note always work out exactly
 * the same members again, which is why skipping distant scenery can never
 * change how a run turns out.
 */
export function restoreGroup(
  store: EntityStore,
  from: number,
  count: number,
  note: GroupSummary,
  seed: number,
  spread: number,
): void {
  for (let n = 0; n < count; n++) {
    const slot = from + n;
    if (slot >= store.count) break;
    const rng = new Generator(mix(seed ^ note.groupId, n, note.step));
    store.x[slot] = note.x + ((rng.signedUnit() * spread) >> 16);
    store.y[slot] = note.y + ((rng.signedUnit() * (spread >> 2)) >> 16);
    store.z[slot] = note.z + ((rng.signedUnit() * spread) >> 16);
    store.setProgress(slot, rng.below(65536));
    store.setEnergy(slot, note.energy);
    store.setTiredness(slot, note.tiredness);
    store.setStage(slot, Stage.Full);
    store.setMoving(slot, true);
  }
}

/**
 * Rebuilds a group from its note as brand new entries at the end of the pool.
 */
export function rebuild(
  store: EntityStore,
  note: GroupSummary,
  seed: number,
  spread: number,
): number {
  let added = 0;
  for (let n = 0; n < note.population; n++) {
    const rng = new Generator(mix(seed ^ note.groupId, n, note.step));
    const x = note.x + ((rng.signedUnit() * spread) >> 16);
    const y = note.y + ((rng.signedUnit() * (spread >> 2)) >> 16);
    const z = note.z + ((rng.signedUnit() * spread) >> 16);
    const kind = rng.below(3);
    const looks = rng.below(256);
    const progress = rng.below(65536);
    const index = store.add(x, y, z, kind, looks, progress, note.energy);
    if (index < 0) break;
    store.setTiredness(index, note.tiredness);
    store.setStage(index, Stage.Full);
    added++;
  }
  return added;
}
