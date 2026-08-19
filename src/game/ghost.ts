/**
 * Racing the best run you have already done.
 *
 * A run is kept as the list of things the player did, one entry per step,
 * and feeding that list back into a fresh course reproduces the run exactly.
 * That is what a replay is; a ghost is the same thing shown at the same time
 * as the run you are doing now, so you can see where you are winning and
 * where you are throwing it away.
 *
 * Both worlds take the same number of steps as each other every frame, which
 * is what keeps them honest. The ghost cannot be knocked into and cannot
 * knock: it is a picture of something that already happened, and it changes
 * nothing about the run in progress.
 */

import { ONE } from '../core/fixed';
import { RunState, World } from '../core/simulation';
import type { Course } from '../core/course';
import type { ShapeStats } from '../core/ballShape';
import type { Stage } from './stages';

/** How far apart the marks are along the course, in metres. */
const MARK_METRES = 1;

export interface GhostOptions {
  stage: Stage;
  course: Course;
  ball: ShapeStats;
  countdownSeconds: number;
}

export class Ghost {
  readonly world: World;
  /** True while the ghost still has more of its run to show. */
  private at = 0;
  private readonly controls: readonly number[];

  /**
   * When the old run reached each metre, in seconds.
   *
   * Worked out once before the race starts, by running the whole thing
   * through in one go. It costs a few milliseconds and it is what lets the
   * screen say how far ahead or behind you are in seconds rather than in
   * vague terms.
   */
  private readonly marks: number[] = [];

  /**
   * The first mark past the start line.
   *
   * The ball does not begin at zero, so the marks at and below where it
   * starts all carry the time nothing had happened yet. Reading a gap off
   * those would show a difference before either run had moved.
   */
  private firstMark = 0;

  constructor(options: GhostOptions, controls: readonly number[]) {
    this.controls = controls;
    this.world = new World({
      course: options.course,
      seed: options.stage.seed,
      ball: options.ball,
      breeze: options.stage.breeze,
      countdownSeconds: options.countdownSeconds,
      players: 1,
    });
    this.marks = this.readMarks(options);
  }

  /** True once the ghost has finished showing its run. */
  get done(): boolean {
    return this.at >= this.controls.length;
  }

  /** How far the ghost has gone, in metres. */
  get metres(): number {
    return this.world.travelled[0] / ONE;
  }

  /** Takes the given number of steps, the same as the live run just took. */
  advance(steps: number): void {
    for (let i = 0; i < steps && this.at < this.controls.length; i++) {
      this.world.advance([this.controls[this.at]]);
      this.at++;
    }
  }

  /**
   * How far ahead or behind the live run is, in seconds.
   *
   * Positive means slower than the old run, which is the way round a time
   * on a clock works: a bigger number is worse.
   *
   * @param metres how far the live run has got
   * @param seconds how long it has taken to get there
   * @returns the difference, or null if the old run never got this far
   */
  gapAt(metres: number, seconds: number): number | null {
    if (metres <= 0) return null;
    const along = metres / MARK_METRES;
    const mark = Math.floor(along);
    if (mark <= this.firstMark || mark >= this.marks.length) return null;
    const was = this.marks[mark];
    if (was === undefined) return null;

    // Between one mark and the next, guess at the time evenly. Without this
    // the reading drifts by however long a metre took, which at a standing
    // start is well over a second — enough to make the number a lie.
    const next = this.marks[mark + 1];
    const into = along - mark;
    const at = next === undefined ? was : was + (next - was) * into;
    return seconds - at;
  }

  /** Plays the whole stored run through, noting when it passed each mark. */
  private readMarks(options: GhostOptions): number[] {
    const world = new World({
      course: options.course,
      seed: options.stage.seed,
      ball: options.ball,
      breeze: options.stage.breeze,
      countdownSeconds: options.countdownSeconds,
      players: 1,
    });
    const marks: number[] = [];
    let reached = 0;
    for (let step = 0; step < this.controls.length; step++) {
      world.advance([this.controls[step]]);
      const metres = Math.floor(world.travelled[0] / ONE / MARK_METRES);
      if (step === 0) {
        // How far along the ball stands before it has done anything. Marks
        // at or behind this one all carry the time nothing had happened.
        reached = metres;
        this.firstMark = metres;
      }
      // Only ever moving forward: going over the edge and being put back
      // must not rewrite a mark that was already set.
      while (reached < metres) {
        reached++;
        marks[reached] = world.secondsFor(0);
      }
      if (world.state[0] === RunState.Finished) break;
    }
    return marks;
  }
}

/**
 * Whether a stored run is worth racing against.
 *
 * A run that was cut short, or one from a course that has since been
 * changed, would put a ghost on the screen doing something that makes no
 * sense. Better to have none.
 */
export function usableGhost(controls: unknown): controls is number[] {
  return Array.isArray(controls) && controls.length > 60 && controls.every(Number.isInteger);
}
