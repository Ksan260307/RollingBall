/**
 * A race: several balls down one hill at the same time.
 *
 * Everybody's world is their own copy, and the only thing that crosses
 * between them is what each player did on each step. Because the rules are
 * built out of whole numbers and never look at the clock, feeding the same
 * steering into every copy gives every copy the same race, down to the last
 * bump — so nobody has to send positions, and nobody can argue about who hit
 * whom.
 *
 * Steps are taken only once every player's steering for that step has
 * arrived. Each player sends theirs a few steps ahead of where the race has
 * got to, which gives the message time to travel without anybody waiting.
 */

import { MAX_PLAYERS, packControls, unpackControls, type Controls } from '../core/input';
import { ONE } from '../core/fixed';
import { RunState, World } from '../core/simulation';
import { demoControls } from './demoDriver';
import { altCourseFor, courseFor, type Stage } from './stages';
import type { ShapeStats } from '../core/ballShape';

/** How many steps the rules take in a second. */
export const STEPS_PER_SECOND = 120;
const STEP_SECONDS = 1 / STEPS_PER_SECOND;

/**
 * How far ahead of the race each player sends their steering.
 *
 * A twentieth of a second. Long enough for a message to get across and be
 * waiting when it is wanted; short enough that nobody notices the delay
 * between pushing and the ball answering.
 */
export const INPUT_LEAD = 6;

/** Never take more than this many steps in one frame, however far behind. */
const MOST_CATCH_UP = 12;

/**
 * How long a missing player is waited for before the race carries on.
 *
 * Counted in real seconds spent waiting, not in steps: somebody who never
 * says a word would otherwise hold the race at step zero for ever, because
 * the giving-up rule would be waiting for a step that could never arrive.
 */
const PATIENCE_SECONDS = 1.5;

/** Who is in a seat. */
export type SeatKind = 'you' | 'friend' | 'robot';

export interface Seat {
  kind: SeatKind;
  name: string;
  ball: ShapeStats;
  /** How keenly a robot drives, where 1 is flat out. */
  keenness: number;
}

export interface RaceOptions {
  stage: Stage;
  seats: Seat[];
  /** Which seat the person at this screen is in. */
  you: number;
  countdownSeconds?: number;
}

/** How a player finished, for the table at the end. */
export interface Placing {
  seat: number;
  name: string;
  kind: SeatKind;
  finished: boolean;
  seconds: number;
  metres: number;
}

export class Race {
  readonly world: World;
  readonly seats: Seat[];
  readonly you: number;
  /** Where each ball was at the end of the previous step, for smooth drawing. */
  readonly previous: { x: number; y: number; z: number }[] = [];
  /** How far between the previous step and the current one the picture is. */
  alpha = 0;
  paused = false;

  /** What everybody did, by step, one list per seat. */
  private readonly given: Map<number, number>[] = [];
  /** The last step each seat has been heard from on. */
  private readonly heardTo: number[] = [];
  /** How long the race has been held up waiting for somebody, in seconds. */
  private waited = 0;
  /**
   * Seats that have stopped answering.
   *
   * Once given up on, a seat stays given up on until its player speaks
   * again. Without that the race would wait afresh on every single step and
   * crawl along one step per second and a half.
   */
  private readonly gone: boolean[] = [];
  private leftover = 0;

  constructor(options: RaceOptions) {
    this.seats = options.seats.slice(0, MAX_PLAYERS);
    this.you = Math.min(options.you, this.seats.length - 1);
    this.world = new World({
      course: courseFor(options.stage),
      alt: altCourseFor(options.stage),
      forkAt: options.stage.forkAt,
      seed: options.stage.seed,
      ball: this.seats[0].ball,
      balls: this.seats.map((seat) => seat.ball),
      breeze: options.stage.breeze,
      countdownSeconds: options.countdownSeconds ?? 3,
      players: this.seats.length,
    });
    for (let seat = 0; seat < this.seats.length; seat++) {
      this.given.push(new Map());
      this.heardTo.push(-1);
      this.gone.push(false);
      this.previous.push({
        x: this.world.x[seat],
        y: this.world.y[seat],
        z: this.world.z[seat],
      });
    }
  }

  /** True while anybody is still on their way down. */
  get running(): boolean {
    return this.seats.some((_, seat) => {
      const state = this.world.state[seat];
      return state === RunState.Ready || state === RunState.Rolling;
    });
  }

  /** Seconds on the clock for the person at this screen. */
  get seconds(): number {
    return this.world.secondsFor(this.you);
  }

  /** Seconds left of the countdown, rounded up. */
  get countdownSeconds(): number {
    return Math.ceil(this.world.countdown / STEPS_PER_SECOND);
  }

  /** The step everybody's steering is wanted for next. */
  get wantedStep(): number {
    return this.world.step;
  }

  /** Takes in what somebody did, whoever they are and whenever it arrives. */
  hear(seat: number, step: number, packed: number): void {
    if (seat < 0 || seat >= this.seats.length) return;
    if (step < this.world.step) return;
    this.given[seat].set(step, packed);
    if (step > this.heardTo[seat]) this.heardTo[seat] = step;
    // Back in the room.
    this.gone[seat] = false;
  }

  /**
   * Moves the race on by however much real time has passed.
   *
   * @param elapsed seconds since the previous frame
   * @param yours what the person at this screen is doing right now
   * @returns the steps taken, and what this screen said on each of them
   */
  update(elapsed: number, yours: Controls): { steps: number; sent: [number, number][] } {
    const sent: [number, number][] = [];
    if (this.paused || !this.running) {
      this.alpha = 1;
      return { steps: 0, sent };
    }

    this.leftover += Math.min(elapsed, 0.25);
    let taken = 0;
    while (this.leftover >= STEP_SECONDS && taken < MOST_CATCH_UP && this.running) {
      // Say what this screen is doing, a few steps ahead of the race.
      const saying = this.world.step + INPUT_LEAD;
      const packed = packControls(yours);
      if (!this.given[this.you].has(saying)) {
        this.given[this.you].set(saying, packed);
        this.heardTo[this.you] = Math.max(this.heardTo[this.you], saying);
        sent.push([saying, packed]);
      }

      if (!this.ready()) {
        this.waited += STEP_SECONDS;
        if (this.waited > PATIENCE_SECONDS) this.giveUpOnTheQuiet();
        break;
      }
      this.waited = 0;

      for (let seat = 0; seat < this.seats.length; seat++) {
        this.previous[seat].x = this.world.x[seat];
        this.previous[seat].y = this.world.y[seat];
        this.previous[seat].z = this.world.z[seat];
      }
      this.world.advance(this.stepControls());
      this.leftover -= STEP_SECONDS;
      taken++;
    }
    if (taken === MOST_CATCH_UP) this.leftover = 0;
    this.alpha = Math.min(1, this.leftover / STEP_SECONDS);
    return { steps: taken, sent };
  }

  /**
   * Whether everybody's steering for the next step has arrived.
   *
   * A seat nobody is sitting in is always ready. So is one whose player has
   * gone quiet for long enough: waiting for ever on somebody who has walked
   * away would take the race away from everybody who has not.
   */
  private ready(): boolean {
    const step = this.world.step;
    for (let seat = 0; seat < this.seats.length; seat++) {
      if (this.seats[seat].kind === 'robot' || this.gone[seat]) continue;
      if (this.given[seat].has(step)) continue;
      return false;
    }
    return true;
  }

  /** Writes off whoever the race has been waiting on, and carries on. */
  private giveUpOnTheQuiet(): void {
    const step = this.world.step;
    for (let seat = 0; seat < this.seats.length; seat++) {
      if (this.seats[seat].kind === 'robot' || this.gone[seat]) continue;
      if (!this.given[seat].has(step)) this.gone[seat] = true;
    }
    this.waited = 0;
  }

  /** What every seat is doing on the step about to be taken. */
  private stepControls(): number[] {
    const step = this.world.step;
    const out: number[] = [];
    for (let seat = 0; seat < this.seats.length; seat++) {
      const held = this.given[seat].get(step);
      if (held !== undefined) {
        out.push(held);
      } else if (this.seats[seat].kind === 'robot' || this.gone[seat]) {
        out.push(robotControls(this.world, seat, this.seats[seat].keenness));
      } else {
        // Held over from the last step: a message that has not arrived yet
        // is far more likely to be late than never coming.
        out.push(this.given[seat].get(step - 1) ?? robotControls(this.world, seat, 0.8));
      }
      this.given[seat].delete(step - 1);
    }
    return out;
  }

  /** Who got where, in the order they finished. */
  placings(): Placing[] {
    const out: Placing[] = this.seats.map((seat, index) => ({
      seat: index,
      name: seat.name,
      kind: seat.kind,
      finished: this.world.state[index] === RunState.Finished,
      seconds: this.world.secondsFor(index),
      metres: this.world.travelled[index] / ONE,
    }));
    out.sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.seconds - b.seconds;
      return b.metres - a.metres;
    });
    return out;
  }
}

/**
 * How a robot drives.
 *
 * The same driver the title screen uses, held back a little so that a full
 * field is not four identical balls in a line. Keenness only ever takes
 * away, never adds, so a robot can be beaten by driving well.
 */
export function robotControls(world: World, seat: number, keenness: number): number {
  const packed = demoControls(world, seat);
  if (keenness >= 1) return packed;
  const held = unpackControls(packed);
  return packControls({
    steer: Math.round(held.steer * keenness),
    push: Math.round(held.push * keenness),
    buttons: 0,
  });
}
