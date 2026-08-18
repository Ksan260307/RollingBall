/**
 * Keeps one attempt at a course running.
 *
 * The world only ever moves in fixed steps of 1/120 of a second, but screens
 * refresh at all sorts of rates. This file bridges the two: it works out how
 * many whole steps are owed since the last frame, takes exactly that many,
 * and hands the drawing code a blend factor so the picture stays smooth in
 * between.
 *
 * It also keeps a copy of every control input, which is what a replay is,
 * and is exactly what would be sent to other players in a shared game.
 */

import { Course } from '../core/course';
import { ONE } from '../core/fixed';
import { ControlTrack, Controls, packControls } from '../core/input';
import { ShapeStats } from '../core/ballShape';
import {
  RunState,
  STEPS_PER_SECOND,
  World,
  capture,
  rewind,
  type Snapshot,
} from '../core/simulation';
import { Stage } from './stages';

/** One step, in seconds. */
export const STEP_SECONDS = 1 / STEPS_PER_SECOND;

/** Never take more than this many steps in one frame, however far behind. */
const MAX_CATCH_UP = 10;

export interface SessionOptions {
  stage: Stage;
  course: Course;
  ball: ShapeStats;
  countdownSeconds?: number;
}

export class Session {
  readonly stage: Stage;
  readonly world: World;
  readonly track = new ControlTrack();
  /** Where the ball was at the end of the previous step, for smooth drawing. */
  readonly previous = { x: 0, y: 0, z: 0 };
  /** How far between the previous step and the current one the picture is. */
  alpha = 0;
  paused = false;

  private leftover = 0;
  private startSnapshot: Snapshot;

  constructor(options: SessionOptions) {
    this.stage = options.stage;
    this.world = new World({
      course: options.course,
      seed: options.stage.seed,
      ball: options.ball,
      breeze: options.stage.breeze,
      countdownSeconds: options.countdownSeconds ?? 3,
      players: 1,
    });
    this.previous.x = this.world.x[0];
    this.previous.y = this.world.y[0];
    this.previous.z = this.world.z[0];
    this.startSnapshot = capture(this.world);
  }

  /** True while the ball is still on its way down. */
  get running(): boolean {
    const state = this.world.state[0];
    return state === RunState.Ready || state === RunState.Rolling;
  }

  /** Seconds on the clock. */
  get seconds(): number {
    return this.world.secondsFor(0);
  }

  /** Seconds left of the countdown, rounded up; zero once the ball is loose. */
  get countdownSeconds(): number {
    return Math.ceil(this.world.countdown / STEPS_PER_SECOND);
  }

  /**
   * Moves the world on by however much real time has passed.
   *
   * @param elapsed seconds since the previous frame
   * @param controls what the player is doing right now
   */
  update(elapsed: number, controls: Controls): void {
    if (this.paused || !this.running) {
      this.alpha = 1;
      return;
    }
    // A very long gap (a background tab, say) is treated as a short one so
    // the game never tries to catch up with thousands of steps at once.
    this.leftover += Math.min(elapsed, 0.25);
    const packed = packControls(controls);

    let taken = 0;
    while (this.leftover >= STEP_SECONDS && taken < MAX_CATCH_UP && this.running) {
      this.previous.x = this.world.x[0];
      this.previous.y = this.world.y[0];
      this.previous.z = this.world.z[0];
      this.track.record(this.world.step, 0, packed);
      this.world.advance([packed]);
      this.leftover -= STEP_SECONDS;
      taken++;
    }
    if (taken === MAX_CATCH_UP) this.leftover = 0;
    this.alpha = Math.min(1, this.leftover / STEP_SECONDS);
  }

  /** Starts the same course again from the very beginning. */
  restart(): void {
    rewind(this.world, this.startSnapshot);
    this.track.clear();
    this.leftover = 0;
    this.alpha = 0;
    this.paused = false;
    this.previous.x = this.world.x[0];
    this.previous.y = this.world.y[0];
    this.previous.z = this.world.z[0];
  }

  /**
   * How the attempt ended, or null while it is still going. Going over the
   * edge does not end it: the ball is put back on the start line and the
   * clock keeps running.
   */
  get outcome(): 'finished' | null {
    return this.world.state[0] === RunState.Finished ? 'finished' : null;
  }

  /** How many times the ball has gone over the edge this attempt. */
  get falls(): number {
    return this.world.falls[0];
  }

  /** A summary of the attempt, for the results screen. */
  summary(): RunSummary {
    return {
      stageId: this.stage.id,
      seconds: this.seconds,
      metres: this.world.travelled[0] / ONE,
      topSpeed: this.world.topSpeed[0] / ONE,
      collected: this.world.collected[0],
      falls: this.world.falls[0],
      finished: this.world.state[0] === RunState.Finished,
      checksum: this.world.checksum(),
    };
  }

  /** The whole attempt as a list of packed controls, ready to be replayed. */
  replay(): number[] {
    return this.track.export(0);
  }
}

export interface RunSummary {
  stageId: string;
  seconds: number;
  metres: number;
  topSpeed: number;
  collected: number;
  /** How many times the ball went over the edge and was put back. */
  falls: number;
  finished: boolean;
  checksum: number;
}

/**
 * Plays a saved list of controls back through a brand new world and reports
 * where it ended up. Because the world is built entirely from whole numbers,
 * the result is identical to the original attempt, every time.
 */
export function replayRun(
  options: SessionOptions,
  controls: ArrayLike<number>,
): RunSummary {
  const session = new Session(options);
  const world = session.world;
  for (let step = 0; step < controls.length && session.running; step++) {
    world.advance([controls[step]]);
  }
  return session.summary();
}
