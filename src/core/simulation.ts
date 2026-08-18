/**
 * The rules of the game.
 *
 * The world moves forward in fixed steps of exactly 1/120 of a second. It
 * never looks at the wall clock, never calls for a random number without a
 * seed, and only ever works with whole numbers. Feed the same course, the
 * same ball and the same controls in, and the identical run comes out, on
 * any device, every time.
 *
 * That property is what makes replays exact, what lets scenery be dropped
 * and rebuilt without changing the outcome, and what would later let up to
 * four people share a course while sending nothing but their controls.
 *
 * Drawing, sound and camera work all live elsewhere. Nothing in this file
 * knows that a screen exists.
 */

import { Course, PointFlag, Surface, placeOnCourse } from './course';
import { ONE, abs, clamp, div, length3, mul, sign } from './fixed';
import {
  EntityStore,
  GroupSummary,
  Kind,
  Stage,
  advanceEntities,
  restoreGroup,
  summarise,
} from './entities';
import { Checksum, Generator, mix } from './random';
import { MAX_PLAYERS, unpackControls } from './input';
import { ShapeStats } from './ballShape';
import { SpatialGrid } from './spatialGrid';
import { Surroundings } from './surroundings';

/** How many steps the world takes per second. Never changes during a run. */
export const STEPS_PER_SECOND = 120;

/** How a run is going. */
export const RunState = {
  /** Counting down before the ball is let go. */
  Ready: 0,
  /** Under way. */
  Rolling: 1,
  /** Off the course. */
  Fallen: 2,
  /** Over the finish line. */
  Finished: 3,
} as const;

export type RunStateValue = (typeof RunState)[keyof typeof RunState];

/** Pull of gravity, in metres per second per second. */
const GRAVITY = Math.round(9.80665 * ONE);

/** How hard the player can push the ball sideways while it is on the floor. */
const STEER_PUSH = Math.round(11.0 * ONE);

/** How hard the player can push the ball forward or hold it back. */
const FORWARD_PUSH = Math.round(5.5 * ONE);

/** How much steering still works while the ball is in the air. */
const AIR_CONTROL = Math.round(2.6 * ONE);

/** How close to the floor still counts as touching it. */
const CONTACT_SLACK = Math.round(0.07 * ONE);

/**
 * How far below the floor the ball may be and still be caught by it. This is
 * what lets the ball land on the far lip of a gap instead of clipping
 * straight through, and it also covers the distance a very fast ball can
 * cover inside a single step.
 */
const CATCH_DEPTH = Math.round(1.6 * ONE);

/** How far below the floor the ball has to drop before the run is over. */
const FALL_LIMIT = Math.round(6.0 * ONE);

/** How much bounce is left after landing. */
const LANDING_BOUNCE = Math.round(0.28 * ONE);

/** How much bounce is left after hitting a wall. */
const WALL_BOUNCE = Math.round(0.45 * ONE);

/** How much the air slows the ball, per unit of speed. */
const AIR_RESISTANCE = Math.round(0.022 * ONE);

/** How much a sideways gust can shift the ball on a breezy course. */
const BREEZE_PUSH = Math.round(3.2 * ONE);

/** Fastest the ball is ever allowed to travel. */
const SPEED_LIMIT = Math.round(34 * ONE);

/** How each kind of floor behaves. */
interface FloorBehaviour {
  /** Steady slowing, in metres per second per second. Negative speeds up. */
  drag: number;
  /** Extra slowing that grows with speed. */
  dragPerSpeed: number;
  /** How well steering bites, where ONE is normal. */
  grip: number;
}

const FLOORS: Record<number, FloorBehaviour> = {
  [Surface.Normal]: {
    drag: Math.round(0.5 * ONE),
    dragPerSpeed: Math.round(0.034 * ONE),
    grip: ONE,
  },
  [Surface.Slick]: {
    drag: Math.round(0.06 * ONE),
    dragPerSpeed: Math.round(0.012 * ONE),
    grip: Math.round(0.34 * ONE),
  },
  [Surface.Rough]: {
    drag: Math.round(2.0 * ONE),
    dragPerSpeed: Math.round(0.06 * ONE),
    grip: Math.round(0.86 * ONE),
  },
  [Surface.Boost]: {
    drag: Math.round(-7.0 * ONE),
    dragPerSpeed: Math.round(0.02 * ONE),
    grip: ONE,
  },
};

/** How the ball handles, worked out once from the player's design. */
export interface BallFeel {
  radius: number;
  weight: number;
  smoothness: number;
  /** Steering strength after the design has been taken into account. */
  steerPush: number;
  /** How much the floor slows this ball down, where ONE is normal. */
  dragScale: number;
}

/** Turns a measured design into the numbers the physics uses. */
export function ballFeelFrom(stats: ShapeStats): BallFeel {
  // A lumpy ball steers a little less crisply and scrubs off more speed.
  const grip = Math.round(0.62 * ONE) + mul(Math.round(0.38 * ONE), stats.smoothness);
  const heaviness = Math.round(0.72 * ONE) + mul(Math.round(0.28 * ONE), stats.weight);
  return {
    radius: stats.radius,
    weight: stats.weight,
    smoothness: stats.smoothness,
    steerPush: div(mul(STEER_PUSH, grip), heaviness),
    dragScale: Math.round(1.34 * ONE) - mul(Math.round(0.34 * ONE), stats.smoothness),
  };
}

/** Something worth showing or hearing about, produced by a step. */
export interface Moment {
  kind: 'collect' | 'land' | 'wall' | 'finish' | 'fall';
  player: number;
  x: number;
  y: number;
  z: number;
  strength: number;
}

/** Everything a run needs to get going. */
export interface WorldOptions {
  course: Course;
  seed: number;
  ball: ShapeStats;
  /** How breezy the course is, from 0 to ONE. */
  breeze?: number;
  /** How many players share the course. Solo play uses one. */
  players?: number;
  /** How long the ball is held before the run starts, in seconds. */
  countdownSeconds?: number;
}

/** One region of scenery, and the note that stands in for it while asleep. */
interface SceneryRegion {
  from: number;
  count: number;
  note: GroupSummary;
  awake: boolean;
}

const ATTENTION_RANGE = Math.round(46 * ONE);
const REGION_SPACING = 8; // metres
const SCENERY_LIMIT = 320;

/** Divides a per-second amount into one step's worth, without drifting. */
function perStep(value: number): number {
  return value >= 0
    ? Math.floor(value / STEPS_PER_SECOND)
    : -Math.floor(-value / STEPS_PER_SECOND);
}

export class World {
  readonly course: Course;
  readonly seed: number;
  readonly feel: BallFeel;
  readonly players: number;
  readonly breeze: number;
  readonly scenery: EntityStore;
  readonly surroundings: Surroundings;
  readonly grid: SpatialGrid;

  /** How many steps have been taken since the world was made. */
  step = 0;
  /** Steps still to go before the ball is let loose. */
  countdown: number;

  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly z: Int32Array;
  readonly velocityX: Int32Array;
  readonly velocityY: Int32Array;
  readonly velocityZ: Int32Array;
  readonly state: Int32Array;
  readonly travelled: Int32Array;
  readonly sideways: Int32Array;
  /** How fast the ball is sliding across the course, rather than along it. */
  readonly sidewaysSpeed: Int32Array;
  /** Half the floor width where the ball is, handy for the display. */
  readonly halfWidth: Int32Array;
  readonly aboveFloor: Int32Array;
  readonly grounded: Uint8Array;
  readonly topSpeed: Int32Array;
  readonly finishStep: Int32Array;
  readonly collected: Int32Array;
  readonly elapsedSteps: Int32Array;
  private readonly hint: Int32Array;

  /** Things worth showing, refreshed every step. */
  readonly moments: Moment[] = [];

  private readonly regions: SceneryRegion[] = [];
  private lastBusy = 0;

  constructor(options: WorldOptions) {
    this.course = options.course;
    this.seed = options.seed >>> 0;
    this.feel = ballFeelFrom(options.ball);
    this.players = Math.min(MAX_PLAYERS, Math.max(1, options.players ?? 1));
    this.breeze = options.breeze ?? 0;
    this.countdown = Math.round((options.countdownSeconds ?? 3) * STEPS_PER_SECOND);

    const slots = MAX_PLAYERS;
    this.x = new Int32Array(slots);
    this.y = new Int32Array(slots);
    this.z = new Int32Array(slots);
    this.velocityX = new Int32Array(slots);
    this.velocityY = new Int32Array(slots);
    this.velocityZ = new Int32Array(slots);
    this.state = new Int32Array(slots);
    this.travelled = new Int32Array(slots);
    this.sideways = new Int32Array(slots);
    this.sidewaysSpeed = new Int32Array(slots);
    this.halfWidth = new Int32Array(slots);
    this.aboveFloor = new Int32Array(slots);
    this.grounded = new Uint8Array(slots);
    this.topSpeed = new Int32Array(slots);
    this.finishStep = new Int32Array(slots).fill(-1);
    this.collected = new Int32Array(slots);
    this.elapsedSteps = new Int32Array(slots);
    this.hint = new Int32Array(slots);

    const along = Math.max(8, Math.min(96, Math.round(this.course.totalLength / ONE / 2)));
    this.surroundings = new Surroundings(along, 16);
    this.scenery = new EntityStore(SCENERY_LIMIT);
    this.grid = new SpatialGrid(Math.round(4 * ONE), 512, SCENERY_LIMIT);

    this.placeBalls();
    this.growScenery();
    this.grid.build(this.scenery.x, this.scenery.y, this.scenery.z, this.scenery.count);
  }

  private placeBalls(): void {
    const c = this.course;
    for (let p = 0; p < this.players; p++) {
      // Players line up side by side, so a shared start would just work.
      const offset =
        this.players > 1 ? Math.round((p - (this.players - 1) / 2) * 1.6 * ONE) : 0;
      const lift = this.feel.radius;
      this.x[p] = c.startX + mul(c.rightX[0], offset) + mul(c.upX[0], lift);
      this.y[p] = c.startY + mul(c.rightY[0], offset) + mul(c.upY[0], lift);
      this.z[p] = c.startZ + mul(c.rightZ[0], offset) + mul(c.upZ[0], lift);
      this.velocityX[p] = 0;
      this.velocityY[p] = 0;
      this.velocityZ[p] = 0;
      // With no countdown asked for, the ball is free from the very first step.
      this.state[p] = this.countdown > 0 ? RunState.Ready : RunState.Rolling;
      this.hint[p] = 0;
      this.travelled[p] = 0;
      this.topSpeed[p] = 0;
      this.finishStep[p] = -1;
      this.collected[p] = 0;
      this.elapsedSteps[p] = 0;
    }
  }

  /**
   * Scatters scenery along the course. Each region is described by a short
   * note, and the note is what actually creates the members, so a region can
   * be thrown away and rebuilt later without anything shifting.
   */
  private growScenery(): void {
    const c = this.course;
    const totalMetres = c.totalLength / ONE;
    const regionCount = Math.max(1, Math.floor(totalMetres / REGION_SPACING));
    for (let r = 0; r < regionCount; r++) {
      const rng = new Generator(mix(this.seed, r, 0x5cee));
      const population = 3 + rng.below(4);
      if (this.scenery.count + population > this.scenery.capacity) break;

      const distance = Math.round(((r + 0.5) * REGION_SPACING) * ONE);
      const pointIndex = Math.min(
        c.count - 1,
        Math.max(0, Math.round(distance / ONE / 2)),
      );
      const side = (rng.signedUnit() * (c.halfWidth[pointIndex] + Math.round(4 * ONE))) >> 16;
      const note: GroupSummary = {
        x: c.x[pointIndex] + mul(c.rightX[pointIndex], side),
        y: c.y[pointIndex] + mul(c.upY[pointIndex], Math.round(1.2 * ONE)),
        z: c.z[pointIndex] + mul(c.rightZ[pointIndex], side),
        population,
        energy: 30000 + rng.below(20000),
        tiredness: rng.below(12000),
        step: 0,
        groupId: r + 1,
      };

      const from = this.scenery.count;
      for (let n = 0; n < population; n++) {
        this.scenery.add(0, 0, 0, Kind.Orb, 0, 0, note.energy);
      }
      restoreGroup(this.scenery, from, population, note, this.seed, Math.round(3.5 * ONE));
      // Give each region one collectable orb and make the rest decoration.
      for (let n = 0; n < population; n++) {
        const slot = from + n;
        const looksRng = new Generator(mix(this.seed, slot, 0x0b1e));
        this.scenery.setKind(slot, n === 0 ? Kind.Orb : 1 + looksRng.below(3));
        this.scenery.setLooks(slot, looksRng.below(256));
      }
      this.regions.push({ from, count: population, note, awake: true });
    }
  }

  /** How many scenery pieces did a full update on the last step. */
  get busyCount(): number {
    return this.lastBusy;
  }

  /** How many scenery pieces are currently being looked after. */
  get awakeCount(): number {
    let n = 0;
    for (const region of this.regions) if (region.awake) n += region.count;
    return n;
  }

  /** Seconds elapsed for a player, as a decimal, for display only. */
  secondsFor(player = 0): number {
    return this.elapsedSteps[player] / STEPS_PER_SECOND;
  }

  /** How far along the course a player is, from 0 to ONE. */
  progressFor(player = 0): number {
    if (this.course.totalLength <= 0) return 0;
    return clamp(div(this.travelled[player], this.course.totalLength), 0, ONE);
  }

  /** Current speed in metres per second, as a stored value. */
  speedFor(player = 0): number {
    return length3(this.velocityX[player], this.velocityY[player], this.velocityZ[player]);
  }

  /**
   * Takes the world forward by exactly one step.
   *
   * @param controls one packed control value per player
   */
  advance(controls: ArrayLike<number>): void {
    this.moments.length = 0;

    const stir = this.breeze > 0 ? this.breeze : Math.round(0.25 * ONE);
    this.surroundings.advance(this.step, this.seed, stir);
    this.lastBusy = advanceEntities(this.scenery, this.surroundings.liveliness);

    if (this.countdown > 0) {
      this.countdown--;
      if (this.countdown === 0) {
        for (let p = 0; p < this.players; p++) {
          if (this.state[p] === RunState.Ready) this.state[p] = RunState.Rolling;
        }
      }
    } else {
      for (let p = 0; p < this.players; p++) {
        if (this.state[p] !== RunState.Rolling) continue;
        this.elapsedSteps[p]++;
        this.moveBall(p, controls[p] ?? 0);
      }
    }

    this.mindAttention();
    this.step++;
  }

  private moveBall(player: number, packed: number): void {
    const controls = unpackControls(packed);
    const c = this.course;
    const where = placeOnCourse(c, this.x[player], this.y[player], this.z[player], this.hint[player]);
    this.hint[player] = where.point;
    const i = where.point;

    const forwardX = c.forwardX[i];
    const forwardY = c.forwardY[i];
    const forwardZ = c.forwardZ[i];
    const rightX = c.rightX[i];
    const rightY = c.rightY[i];
    const rightZ = c.rightZ[i];
    const upX = c.upX[i];
    const upY = c.upY[i];
    const upZ = c.upZ[i];

    const overGap = (where.flags & PointFlag.Gap) !== 0;
    const gapFromFloor = where.height - this.feel.radius;
    const withinFloor = abs(where.sideways) <= where.halfWidth;
    const touching =
      !overGap && withinFloor && gapFromFloor <= CONTACT_SLACK && gapFromFloor > -CATCH_DEPTH;

    let accelX = 0;
    let accelY = -GRAVITY;
    let accelZ = 0;

    if (touching) {
      // The floor holds the ball up: cancel the part of gravity pressing into
      // it, and let the rest pull the ball along the slope.
      const intoFloor = mul(accelX, upX) + mul(accelY, upY) + mul(accelZ, upZ);
      if (intoFloor < 0) {
        accelX -= mul(intoFloor, upX);
        accelY -= mul(intoFloor, upY);
        accelZ -= mul(intoFloor, upZ);
      }

      const floor = FLOORS[where.surface] ?? FLOORS[Surface.Normal];
      const grip = floor.grip;

      // Steering and pushing, both along the course, not along the screen.
      const steer = mul(mul(this.feel.steerPush, controls.steer), grip);
      accelX += mul(rightX, steer);
      accelY += mul(rightY, steer);
      accelZ += mul(rightZ, steer);
      const push = mul(mul(FORWARD_PUSH, controls.push), grip);
      accelX += mul(forwardX, push);
      accelY += mul(forwardY, push);
      accelZ += mul(forwardZ, push);

      // Rolling resistance, always against the direction of travel.
      const speed = this.speedFor(player);
      if (speed > 0) {
        const scaled = mul(floor.drag, this.feel.dragScale) + mul(floor.dragPerSpeed, speed);
        const slow = -scaled;
        accelX += div(mul(this.velocityX[player], slow), speed);
        accelY += div(mul(this.velocityY[player], slow), speed);
        accelZ += div(mul(this.velocityZ[player], slow), speed);
      }

      // Sit the ball exactly on the floor and stop it sinking in.
      if (gapFromFloor < 0) {
        this.x[player] -= mul(upX, gapFromFloor);
        this.y[player] -= mul(upY, gapFromFloor);
        this.z[player] -= mul(upZ, gapFromFloor);
        const intoSurface =
          mul(this.velocityX[player], upX) +
          mul(this.velocityY[player], upY) +
          mul(this.velocityZ[player], upZ);
        if (intoSurface < 0) {
          // Cancel the movement into the floor, and add a little bounce back
          // only when the landing was hard enough to be worth feeling.
          const impact = -intoSurface;
          const springiness = impact > Math.round(1.6 * ONE) ? LANDING_BOUNCE : 0;
          const change = impact + mul(impact, springiness);
          this.velocityX[player] += mul(upX, change);
          this.velocityY[player] += mul(upY, change);
          this.velocityZ[player] += mul(upZ, change);
          if (impact > Math.round(2.0 * ONE)) this.addMoment('land', player, impact);
        }
      }
    } else {
      // In the air: a little steering still helps, but much less.
      const steer = mul(AIR_CONTROL, controls.steer);
      accelX += mul(rightX, steer);
      accelY += mul(rightY, steer);
      accelZ += mul(rightZ, steer);
    }

    // The air itself always resists.
    const speedNow = this.speedFor(player);
    if (speedNow > 0) {
      const resist = mul(AIR_RESISTANCE, speedNow);
      accelX -= mul(this.velocityX[player], resist);
      accelY -= mul(this.velocityY[player], resist);
      accelZ -= mul(this.velocityZ[player], resist);
    }

    // A breeze crossing the course, read straight from the surroundings.
    if (this.breeze > 0) {
      const alongCell = div(where.travelled, Math.round(2 * ONE));
      const acrossFraction = div(
        where.sideways + where.halfWidth,
        Math.max(1, where.halfWidth * 2),
      );
      const acrossCell = mul(acrossFraction, (this.surroundings.across - 1) * ONE);
      const gust = this.surroundings.sample(
        clamp(alongCell, 0, (this.surroundings.along - 1) * ONE),
        clamp(acrossCell, 0, (this.surroundings.across - 1) * ONE),
      );
      const nudge = mul(mul(BREEZE_PUSH, this.breeze), clamp(gust, -ONE, ONE));
      accelX += mul(rightX, nudge);
      accelY += mul(rightY, nudge);
      accelZ += mul(rightZ, nudge);
    }

    this.velocityX[player] += perStep(accelX);
    this.velocityY[player] += perStep(accelY);
    this.velocityZ[player] += perStep(accelZ);

    // Keep the ball inside a sensible top speed.
    const capped = this.speedFor(player);
    if (capped > SPEED_LIMIT) {
      const scale = div(SPEED_LIMIT, capped);
      this.velocityX[player] = mul(this.velocityX[player], scale);
      this.velocityY[player] = mul(this.velocityY[player], scale);
      this.velocityZ[player] = mul(this.velocityZ[player], scale);
    }
    if (capped > this.topSpeed[player]) this.topSpeed[player] = capped;

    this.x[player] += perStep(this.velocityX[player]);
    this.y[player] += perStep(this.velocityY[player]);
    this.z[player] += perStep(this.velocityZ[player]);

    this.settleAgainstWalls(player, (where.flags & PointFlag.Walls) !== 0);
    this.gatherOrbs(player);
    this.judge(player);
  }

  private settleAgainstWalls(player: number, hasWalls: boolean): void {
    if (!hasWalls) return;
    const c = this.course;
    const after = placeOnCourse(c, this.x[player], this.y[player], this.z[player], this.hint[player]);
    const i = after.point;
    const limit = after.halfWidth - this.feel.radius;
    if (abs(after.sideways) <= limit) return;

    const overshoot = abs(after.sideways) - limit;
    const direction = sign(after.sideways);
    this.x[player] -= mul(c.rightX[i], overshoot * direction);
    this.y[player] -= mul(c.rightY[i], overshoot * direction);
    this.z[player] -= mul(c.rightZ[i], overshoot * direction);

    const intoWall =
      mul(this.velocityX[player], c.rightX[i]) +
      mul(this.velocityY[player], c.rightY[i]) +
      mul(this.velocityZ[player], c.rightZ[i]);
    if (intoWall * direction > 0) {
      const change = -intoWall - mul(intoWall, WALL_BOUNCE);
      this.velocityX[player] += mul(c.rightX[i], change);
      this.velocityY[player] += mul(c.rightY[i], change);
      this.velocityZ[player] += mul(c.rightZ[i], change);
      if (abs(intoWall) > Math.round(1.5 * ONE)) this.addMoment('wall', player, abs(intoWall));
    }
  }

  private gatherOrbs(player: number): void {
    const reach = this.feel.radius + Math.round(0.75 * ONE);
    const reachSquared = reach * reach;
    const bx = this.x[player];
    const by = this.y[player];
    const bz = this.z[player];
    this.grid.forEachNear(bx, by, bz, reach, (index) => {
      if (this.scenery.kindOf(index) !== Kind.Orb) return;
      if (this.scenery.stageOf(index) === Stage.Sleeping) return;
      const dx = bx - this.scenery.x[index];
      const dy = by - this.scenery.y[index];
      const dz = bz - this.scenery.z[index];
      if (dx * dx + dy * dy + dz * dz > reachSquared) return;
      this.scenery.setStage(index, Stage.Sleeping);
      this.collected[player]++;
      this.moments.push({
        kind: 'collect',
        player,
        x: this.scenery.x[index],
        y: this.scenery.y[index],
        z: this.scenery.z[index],
        strength: ONE,
      });
    });
  }

  private judge(player: number): void {
    const c = this.course;
    const where = placeOnCourse(c, this.x[player], this.y[player], this.z[player], this.hint[player]);
    this.hint[player] = where.point;
    this.travelled[player] = where.travelled;
    this.sideways[player] = where.sideways;
    this.halfWidth[player] = where.halfWidth;
    this.sidewaysSpeed[player] =
      mul(this.velocityX[player], c.rightX[where.point]) +
      mul(this.velocityY[player], c.rightY[where.point]) +
      mul(this.velocityZ[player], c.rightZ[where.point]);
    this.aboveFloor[player] = where.height - this.feel.radius;
    const overGap = (where.flags & PointFlag.Gap) !== 0;
    this.grounded[player] =
      !overGap &&
      abs(where.sideways) <= where.halfWidth &&
      this.aboveFloor[player] <= CONTACT_SLACK &&
      this.aboveFloor[player] > -CATCH_DEPTH
        ? 1
        : 0;

    if (where.height < -FALL_LIMIT) {
      this.state[player] = RunState.Fallen;
      this.addMoment('fall', player, ONE);
      return;
    }

    const nearEnd = where.travelled >= c.totalLength - Math.round(1.5 * ONE);
    if (nearEnd && (where.flags & PointFlag.Finish) !== 0) {
      this.state[player] = RunState.Finished;
      this.finishStep[player] = this.elapsedSteps[player];
      this.addMoment('finish', player, ONE);
    }
  }

  private addMoment(kind: Moment['kind'], player: number, strength: number): void {
    this.moments.push({
      kind,
      player,
      x: this.x[player],
      y: this.y[player],
      z: this.z[player],
      strength,
    });
  }

  /**
   * Puts far-away scenery to sleep and wakes it again when the ball gets
   * close. A sleeping region is boiled down to a single short note, so the
   * cost of a long course stays flat.
   */
  private mindAttention(): void {
    if (this.step % 15 !== 0) return;
    const focus = this.travelled[0];
    for (const region of this.regions) {
      const distance = abs(Math.round((region.note.groupId - 0.5) * REGION_SPACING * ONE) - focus);
      const shouldBeAwake = distance <= ATTENTION_RANGE;
      if (shouldBeAwake === region.awake) continue;
      if (shouldBeAwake) {
        restoreGroup(
          this.scenery,
          region.from,
          region.count,
          region.note,
          this.seed,
          Math.round(3.5 * ONE),
        );
        region.awake = true;
      } else {
        // Keep only the summary; the members themselves stop being updated.
        const fresh = summarise(
          this.scenery,
          region.from,
          region.from + region.count,
          region.note.step,
          region.note.groupId,
        );
        region.note.energy = fresh.energy;
        region.note.tiredness = fresh.tiredness;
        for (let n = 0; n < region.count; n++) {
          this.scenery.setStage(region.from + n, Stage.Sleeping);
        }
        region.awake = false;
      }
    }
  }

  /**
   * Looks ahead without actually playing the steps in between. Used to draw
   * the scenery a fraction of a step early so motion stays smooth even when
   * the screen refreshes at a different rate from the simulation.
   */
  previewProgress(index: number, stepsAhead: number, speed: number): number {
    return this.scenery.jumpAhead(index, stepsAhead, speed);
  }

  /**
   * The scenery bookkeeping: which groups are awake and what their notes
   * currently say. It is small, but it has to travel with a copy of the
   * world, or winding back would leave distant groups asleep and the next
   * attempt would not match the last one.
   */
  saveAttention(): number[] {
    const packed: number[] = [];
    for (const region of this.regions) {
      packed.push(region.awake ? 1 : 0, region.note.energy, region.note.tiredness);
    }
    packed.push(...this.hint);
    return packed;
  }

  /** Puts the scenery bookkeeping back as it was. */
  loadAttention(packed: number[]): void {
    let at = 0;
    for (const region of this.regions) {
      region.awake = packed[at++] === 1;
      region.note.energy = packed[at++];
      region.note.tiredness = packed[at++];
    }
    for (let p = 0; p < this.hint.length; p++) this.hint[p] = packed[at++] ?? 0;
  }

  /** A single number standing for the entire world, used to compare runs. */
  checksum(): number {
    const sum = new Checksum();
    sum.add(this.step).add(this.countdown);
    for (let p = 0; p < this.players; p++) {
      sum
        .add(this.x[p])
        .add(this.y[p])
        .add(this.z[p])
        .add(this.velocityX[p])
        .add(this.velocityY[p])
        .add(this.velocityZ[p])
        .add(this.state[p])
        .add(this.elapsedSteps[p])
        .add(this.collected[p]);
    }
    this.scenery.checksum(sum);
    this.surroundings.checksum(sum);
    return sum.result;
  }
}

/** A complete copy of a world, kept so it can be wound back. */
export interface Snapshot {
  step: number;
  countdown: number;
  x: Int32Array;
  y: Int32Array;
  z: Int32Array;
  velocityX: Int32Array;
  velocityY: Int32Array;
  velocityZ: Int32Array;
  state: Int32Array;
  travelled: Int32Array;
  topSpeed: Int32Array;
  finishStep: Int32Array;
  collected: Int32Array;
  elapsedSteps: Int32Array;
  scenery: EntityStore;
  surroundings: Surroundings;
  /** Which scenery groups were awake, and what their notes said. */
  attention: number[];
}

/** Takes a copy of a world. */
export function capture(world: World): Snapshot {
  const scenery = new EntityStore(world.scenery.capacity);
  world.scenery.copyTo(scenery);
  const surroundings = new Surroundings(world.surroundings.along, world.surroundings.across);
  world.surroundings.copyTo(surroundings);
  return {
    step: world.step,
    countdown: world.countdown,
    x: world.x.slice(),
    y: world.y.slice(),
    z: world.z.slice(),
    velocityX: world.velocityX.slice(),
    velocityY: world.velocityY.slice(),
    velocityZ: world.velocityZ.slice(),
    state: world.state.slice(),
    travelled: world.travelled.slice(),
    topSpeed: world.topSpeed.slice(),
    finishStep: world.finishStep.slice(),
    collected: world.collected.slice(),
    elapsedSteps: world.elapsedSteps.slice(),
    scenery,
    surroundings,
    attention: world.saveAttention(),
  };
}

/**
 * Winds a world back to a copy taken earlier. Replaying the same controls
 * from there lands on exactly the same result, which is the groundwork a
 * play-together mode needs when a late message arrives.
 */
export function rewind(world: World, snapshot: Snapshot): void {
  world.step = snapshot.step;
  world.countdown = snapshot.countdown;
  world.x.set(snapshot.x);
  world.y.set(snapshot.y);
  world.z.set(snapshot.z);
  world.velocityX.set(snapshot.velocityX);
  world.velocityY.set(snapshot.velocityY);
  world.velocityZ.set(snapshot.velocityZ);
  world.state.set(snapshot.state);
  world.travelled.set(snapshot.travelled);
  world.topSpeed.set(snapshot.topSpeed);
  world.finishStep.set(snapshot.finishStep);
  world.collected.set(snapshot.collected);
  world.elapsedSteps.set(snapshot.elapsedSteps);
  snapshot.scenery.copyTo(world.scenery);
  snapshot.surroundings.copyTo(world.surroundings);
  world.loadAttention(snapshot.attention);
}
