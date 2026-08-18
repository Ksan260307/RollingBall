/**
 * Repeatable randomness.
 *
 * Nothing in the game ever calls Math.random(). Every "random" value is
 * derived from a seed plus the current step number, so the same run always
 * produces the same world. That is what lets the game rebuild scenery that
 * was skipped while it was out of sight, and what will later let several
 * players share one world by exchanging only their button presses.
 */

/** Mixes three whole numbers into one 32-bit value. */
export function mix(a: number, b: number, c: number): number {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = (h + Math.imul(b | 0, 0xc2b2ae35)) | 0;
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h = (h + Math.imul(c | 0, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x2545f491);
  return h >>> 0;
}

/** Turns a piece of text into a seed. */
export function seedFromText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A small counter based generator. Because it is driven by a counter rather
 * than by hidden internal state, any value in the sequence can be produced
 * directly without stepping through the ones before it.
 */
export class Generator {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Next value, from 0 to 4294967295. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Next value from 0 up to (but not including) `limit`. */
  below(limit: number): number {
    if (limit <= 0) return 0;
    return this.next() % limit;
  }

  /** Next value between `low` and `high`, both included. */
  between(low: number, high: number): number {
    if (high <= low) return low;
    return low + this.below(high - low + 1);
  }

  /** Next value as a stored decimal from 0.0 up to 1.0. */
  unit(): number {
    return this.next() >>> 16; // 0 .. 65535, i.e. 0.0 .. almost 1.0
  }

  /** Next value as a stored decimal from -1.0 to 1.0. */
  signedUnit(): number {
    return (this.next() >>> 15) - 65536;
  }
}

/** Builds a generator for one specific thing at one specific moment. */
export function generatorFor(seed: number, id: number, step: number): Generator {
  return new Generator(mix(seed, id, step));
}

/**
 * Running checksum used to confirm that two runs stayed in step.
 * Feed it whole numbers; matching totals mean matching worlds.
 */
export class Checksum {
  private value = 2166136261;

  add(n: number): this {
    let v = n | 0;
    this.value ^= v & 0xff;
    this.value = Math.imul(this.value, 16777619);
    v >>>= 8;
    this.value ^= v & 0xff;
    this.value = Math.imul(this.value, 16777619);
    v >>>= 8;
    this.value ^= v & 0xff;
    this.value = Math.imul(this.value, 16777619);
    v >>>= 8;
    this.value ^= v & 0xff;
    this.value = Math.imul(this.value, 16777619);
    return this;
  }

  addAll(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i++) this.add(values[i]);
    return this;
  }

  get result(): number {
    return this.value >>> 0;
  }
}
