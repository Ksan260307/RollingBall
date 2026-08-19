/**
 * Watching a run again.
 *
 * A run is stored as nothing more than the list of things the player did,
 * one entry per step. Feeding that list back into a fresh course reproduces
 * the attempt exactly — same line, same bounces, same time — because the
 * rules are built out of whole numbers and never look at the clock or at
 * anything the player's device happens to be doing.
 *
 * That means a replay costs a few kilobytes rather than a video, and it also
 * means we are free to look at it however we like: from the side, from above,
 * from out in front, in slow motion. None of that touches the run itself.
 */

import { unpackControls } from '../core/input';
import type { CameraStyle } from '../render/view';
import { CAMERA_STYLES } from '../render/view';
import { STEP_SECONDS, Session, type SessionOptions } from './session';

/** How long the camera stays in one place before finding a new one. */
const ANGLE_SECONDS = 2.6;

/** How much of the run is left when the camera settles for the finish. */
const HOME_STRAIGHT = 0.88;

/** The speeds on offer, in the order the button steps through them. */
export const PLAYBACK_SPEEDS = [0.35, 1, 2] as const;

/** How slow the good bits go, and for how long. */
const DRAMA_SPEED = 0.3;
const DRAMA_SECONDS = 0.9;

export class Playback {
  readonly session: Session;
  /** How fast time runs, as chosen by the watcher. */
  speed = 1;
  /** Whether the camera moves itself around. */
  wandering = true;

  private readonly controls: readonly number[];
  private readonly options: SessionOptions;
  private at = 0;
  private leftover = 0;
  private held = 0;
  private angleIndex = 0;
  private drama = 0;

  constructor(options: SessionOptions, controls: readonly number[]) {
    this.options = options;
    this.controls = controls;
    // No countdown: nobody wants to watch three seconds of nothing.
    this.session = new Session({ ...options, countdownSeconds: 0 });
  }

  /** Where the camera is watching from. */
  get angle(): CameraStyle {
    return CAMERA_STYLES[this.angleIndex];
  }

  /** How far through the run we are, from nothing to all of it. */
  get progress(): number {
    if (this.controls.length === 0) return 1;
    return Math.min(1, this.at / this.controls.length);
  }

  /** True once there is nothing left to show. */
  get finished(): boolean {
    return this.at >= this.controls.length || !this.session.running;
  }

  /** Seconds on the clock at this point in the run. */
  get seconds(): number {
    return this.session.seconds;
  }

  /** Moves to the next camera position, and stops the camera wandering. */
  nextAngle(): void {
    this.wandering = false;
    this.angleIndex = (this.angleIndex + 1) % CAMERA_STYLES.length;
    this.held = 0;
  }

  /** Steps through the speeds: slow, ordinary, quick. */
  nextSpeed(): number {
    const index = PLAYBACK_SPEEDS.indexOf(this.speed as (typeof PLAYBACK_SPEEDS)[number]);
    this.speed = PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
    return this.speed;
  }

  /** Back to the top of the run. */
  restart(): void {
    this.session.restart();
    this.at = 0;
    this.leftover = 0;
    this.held = 0;
    this.drama = 0;
    this.angleIndex = 0;
    this.wandering = true;
  }

  /**
   * Plays a little more of the run.
   *
   * The stored inputs are fed in one per step, never two, so the ball
   * retraces the original line however fast or slow we are watching.
   *
   * @returns how many steps were played, which is nothing once the run is
   *   over. Sound uses this: what the ball did happened once, and should be
   *   heard once, not on every frame we sit on the ending.
   */
  advance(elapsed: number): number {
    if (this.finished) {
      this.session.alpha = 1;
      return 0;
    }

    // Slow right down for a moment when something worth seeing happens.
    let rate = this.speed;
    if (this.drama > 0) {
      this.drama = Math.max(0, this.drama - elapsed);
      rate = Math.min(rate, DRAMA_SPEED);
    }

    this.leftover += Math.min(elapsed, 0.25) * rate;
    const world = this.session.world;
    let taken = 0;
    while (this.leftover >= STEP_SECONDS && taken < 12 && !this.finished) {
      this.session.previous.x = world.x[0];
      this.session.previous.y = world.y[0];
      this.session.previous.z = world.z[0];
      world.advance([this.controls[this.at]]);
      this.at++;
      this.leftover -= STEP_SECONDS;
      taken++;
      this.noteDrama();
    }
    this.session.alpha = Math.min(1, this.leftover / STEP_SECONDS);

    this.moveCamera(elapsed);
    return taken;
  }

  /** Spots the moments worth lingering on. */
  private noteDrama(): void {
    for (const moment of this.session.world.moments) {
      if (moment.kind === 'fall' || moment.kind === 'finish') {
        this.drama = DRAMA_SECONDS;
      } else if (moment.kind === 'land' && moment.strength > 0) {
        this.drama = Math.max(this.drama, DRAMA_SECONDS * 0.6);
      }
    }
  }

  /**
   * Wanders the camera about, so the same run looks like a different run.
   *
   * The angles come round in a fixed order rather than at random: a replay
   * should be worth watching twice, and a shot that lands well the first
   * time lands well the second.
   */
  private moveCamera(elapsed: number): void {
    if (!this.wandering) return;
    this.held += elapsed;
    // The end deserves a proper look, so hold one angle over the line.
    if (this.progress > HOME_STRAIGHT) {
      this.angleIndex = CAMERA_STYLES.indexOf('side');
      return;
    }
    if (this.held < ANGLE_SECONDS) return;
    this.held = 0;
    this.angleIndex = (this.angleIndex + 1) % CAMERA_STYLES.length;
  }

  /** A fresh playback of the same run, from the top. */
  again(): Playback {
    return new Playback(this.options, this.controls);
  }
}

/** Turns a stored run back into something a person can watch. */
export function watchable(controls: readonly number[]): boolean {
  return controls.length > 0;
}

/** What the player was doing at one point in a stored run, for the tests. */
export function inputAt(controls: readonly number[], step: number) {
  return unpackControls(controls[Math.min(controls.length - 1, Math.max(0, step))] ?? 0);
}
