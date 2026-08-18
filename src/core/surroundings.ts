/**
 * The gentle motion of the air and ground around the course.
 *
 * A coarse grid is laid over the course: one axis runs along the track, the
 * other runs across it. Disturbances spread outward from where they start,
 * bounce softly off the edges and fade away, which is what gives the scenery
 * its drifting, breathing look. On the windy course it also gives the ball a
 * small sideways nudge.
 *
 * Everything here is whole-number arithmetic driven by the seed and the step
 * count alone. It never reads the clock, the microphone or the weather, so
 * two devices watching the same run always see the same ripples.
 */

import { Checksum, Generator, mix } from './random';
import { ONE, clamp } from './fixed';

/** How strongly a disturbance spreads to neighbouring cells. */
const SPREAD = 9000; // about 0.14

/** How quickly motion dies down. Slightly under 1.0. */
const FADE = 65100;

/** Largest value a cell may reach, so the numbers can never run away. */
const CEILING = ONE * 4;

export class Surroundings {
  readonly along: number;
  readonly across: number;
  private current: Int32Array;
  private previous: Int32Array;
  private scratch: Int32Array;
  /** A short summary of the whole grid, refreshed every few steps. */
  private summary = 0;

  constructor(along: number, across: number) {
    this.along = along;
    this.across = across;
    const size = along * across;
    this.current = new Int32Array(size);
    this.previous = new Int32Array(size);
    this.scratch = new Int32Array(size);
  }

  /** Clears all motion. */
  reset(): void {
    this.current.fill(0);
    this.previous.fill(0);
    this.scratch.fill(0);
    this.summary = 0;
  }

  private indexOf(a: number, b: number): number {
    return a * this.across + b;
  }

  /** Reads one cell. Positions outside the grid read as still. */
  at(a: number, b: number): number {
    if (a < 0 || b < 0 || a >= this.along || b >= this.across) return 0;
    return this.current[this.indexOf(a, b)];
  }

  /** Starts a disturbance at one cell. */
  disturb(a: number, b: number, strength: number): void {
    if (a < 0 || b < 0 || a >= this.along || b >= this.across) return;
    const i = this.indexOf(a, b);
    this.current[i] = clamp(this.current[i] + strength, -CEILING, CEILING);
  }

  /**
   * Advances the whole grid by one step.
   *
   * @param step  the run's step counter, the only source of timing
   * @param seed  the run's seed
   * @param stir  how much fresh disturbance to add, 0 .. 65536
   */
  advance(step: number, seed: number, stir: number): void {
    if (stir > 0 && step % 24 === 0) {
      const rng = new Generator(mix(seed, step, 0x51ed));
      const a = rng.below(this.along);
      const b = rng.below(this.across);
      const strength = ((rng.signedUnit() * stir) >> 16) >> 1;
      this.disturb(a, b, strength);
    }

    const { along, across, current, previous, scratch } = this;
    for (let a = 0; a < along; a++) {
      const rowBase = a * across;
      for (let b = 0; b < across; b++) {
        const i = rowBase + b;
        const centre = current[i];
        const left = b > 0 ? current[i - 1] : centre;
        const right = b < across - 1 ? current[i + 1] : centre;
        const back = a > 0 ? current[i - across] : centre;
        const front = a < along - 1 ? current[i + across] : centre;
        const pull = left + right + back + front - 4 * centre;
        let next = 2 * centre - previous[i] + ((pull * SPREAD) >> 16);
        next = (next * FADE) >> 16;
        scratch[i] = next < -CEILING ? -CEILING : next > CEILING ? CEILING : next;
      }
    }

    // Rotate the three buffers instead of copying them.
    this.previous = current;
    this.current = scratch;
    this.scratch = previous;

    if (step % 8 === 0) this.refreshSummary();
  }

  /**
   * Boils the whole grid down to a single number describing how stirred up
   * things are, from 0 (still) to 65535 (churning).
   *
   * Only every seventh cell is inspected. That is enough for a mood reading
   * and keeps the cost flat no matter how large the grid grows.
   */
  private refreshSummary(): void {
    const cells = this.current;
    let total = 0;
    let counted = 0;
    for (let i = 0; i < cells.length; i += 7) {
      const v = cells[i];
      total += v < 0 ? -v : v;
      counted++;
    }
    if (counted === 0) {
      this.summary = 0;
      return;
    }
    const average = Math.floor(total / counted);
    this.summary = clamp(average * 8, 0, 65535);
  }

  /** How stirred up the surroundings are, 0 .. 65535. */
  get liveliness(): number {
    return this.summary;
  }

  /**
   * Reads the grid at a smooth position rather than a whole cell, blending
   * the four cells around it.
   *
   * @param a position along the course, where ONE means one cell
   * @param b position across the course, in the same unit
   */
  sample(a: number, b: number): number {
    const ai = Math.floor(a / ONE);
    const bi = Math.floor(b / ONE);
    const af = a - ai * ONE;
    const bf = b - bi * ONE;
    const c00 = this.at(ai, bi);
    const c10 = this.at(ai + 1, bi);
    const c01 = this.at(ai, bi + 1);
    const c11 = this.at(ai + 1, bi + 1);
    const top = c00 + (((c10 - c00) * af) >> 16);
    const bottom = c01 + (((c11 - c01) * af) >> 16);
    return top + (((bottom - top) * bf) >> 16);
  }

  /** Copies this grid into another one of the same size, used for rewinding. */
  copyTo(target: Surroundings): void {
    target.current.set(this.current);
    target.previous.set(this.previous);
    target.summary = this.summary;
  }

  /** Adds the grid to a checksum so two runs can be compared. */
  checksum(sum: Checksum): void {
    // Every eleventh cell is plenty to catch a drift between two devices.
    for (let i = 0; i < this.current.length; i += 11) sum.add(this.current[i]);
    sum.add(this.summary);
  }

  /** The live cells, for drawing. Do not modify. */
  get cells(): Int32Array {
    return this.current;
  }
}
