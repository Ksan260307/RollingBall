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
import { ONE, abs, clamp, div, length3, mul, sign, sine } from './fixed';
import {
  Triple,
  dot,
  gripShare,
  magnitude,
  rollingSpinInto,
  slipInto,
  spinChangeInto,
  triple,
} from './rolling';
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
  /** Stopped getting anywhere for too long, so the run is over. */
  Stuck: 2,
  /** Over the finish line. */
  Finished: 3,
} as const;

export type RunStateValue = (typeof RunState)[keyof typeof RunState];

/** Pull of gravity, in metres per second per second. */
const GRAVITY = Math.round(9.80665 * ONE);

/**
 * How far the world tips when the player drags all the way across.
 *
 * The controls tilt the whole course rather than shoving the ball directly.
 * That is what makes the ball's own shape matter: a tilted floor can only
 * move the ball as fast as the ground can spin it up, so a ball with its
 * weight out at the rim is genuinely more sluggish, without any extra rule
 * being written to say so.
 */
const TILT_SIDEWAYS = Math.round(8.2 * ONE);

/** The same, for dragging forwards. */
const TILT_AHEAD = Math.round(4.6 * ONE);

/** How hard dragging back slows the ball down. */
const BRAKING = Math.round(6.0 * ONE);

/**
 * How far in from the start line the ball is placed.
 *
 * The floor stops at the start line, exactly where it is drawn, so the ball
 * is set down a little way inside it rather than balanced on the very edge.
 */
const START_INSET = Math.round(1.2 * ONE);

/** How much steering still works while the ball is off the ground. */
const AIR_CONTROL = Math.round(2.2 * ONE);

/** How close to the floor still counts as touching it. */
const CONTACT_SLACK = Math.round(0.07 * ONE);

/**
 * How far below the floor the ball may be and still be caught by it. This is
 * what lets the ball land on the far lip of a gap instead of clipping
 * straight through, and it also covers the distance a very fast ball can
 * cover inside a single step.
 */
const CATCH_DEPTH = Math.round(1.6 * ONE);

/** How far below the floor the ball has to drop before it is fetched back. */
const FALL_LIMIT = Math.round(6.0 * ONE);

/**
 * How far to the side of the floor the ball has to be before going over the
 * edge counts as gone, rather than as leaning out over it.
 *
 * Measured from the edge, so the ball has to have cleared it entirely.
 */
const EDGE_CLEARANCE = Math.round(0.15 * ONE);

/**
 * How long the ball is held at the start after a fall, in steps.
 *
 * Falling does not end a run: the ball is put back at the start and carries
 * on. The clock never stops, so the trip back up the hill is the whole cost
 * of going over the edge.
 */
const RECOVERY_HOLD = Math.round(0.7 * STEPS_PER_SECOND);

/**
 * How long the ball may get nowhere before the run is called off.
 *
 * A ball that is too knobbly, or wedged against a wall, or simply out of
 * hill, will otherwise sit there for ever. Ten seconds of no progress ends
 * it, and the player watches the count so they know what is happening.
 */
const STALL_LIMIT = 10 * STEPS_PER_SECOND;

/** How much further along the course counts as actually getting somewhere. */
const PROGRESS_STEP = Math.round(1.0 * ONE);

/** How much bounce is left after landing. */
const LANDING_BOUNCE = Math.round(0.26 * ONE);

/**
 * How much bounce is left after hitting a railing.
 *
 * Higher than the bounce off the floor on purpose: a railing is there to be
 * hit, and one that swallowed the knock would feel like running into wet
 * sand. This throws the ball back into the course rather than letting it
 * grind along the barrier.
 */
const WALL_BOUNCE = Math.round(0.75 * ONE);

/** How much a wall scrubs at the ball as it slides along it. */
const WALL_GRIP = Math.round(0.4 * ONE);

/**
 * How tall the railings stand, and how far up they can be hit.
 *
 * A railing only stops the ball while the ball is low enough to strike it.
 * Without that the railings would carry on invisibly into the sky, and a
 * ball sailing well above one would still be shoved back as though it had
 * hit something.
 *
 * The drawing reads this same number, so what you can see and what you can
 * hit are the same thing by construction and cannot drift apart.
 */
export const WALL_HEIGHT = Math.round(0.9 * ONE);

/** How much the air slows the ball, per unit of speed. */
const AIR_RESISTANCE = Math.round(0.0062 * ONE);

/** How much of its spin the ball keeps each step while off the ground. */
const AIR_SPIN_KEEP = Math.round(0.9985 * ONE);

/** How much a sideways gust can shift the ball on a breezy course. */
const BREEZE_PUSH = Math.round(3.2 * ONE);

/** Fastest the ball is ever allowed to travel. */
const SPEED_LIMIT = Math.round(34 * ONE);

/** Fastest the ball is ever allowed to spin, in turns of a radian a second. */
const SPIN_LIMIT = Math.round(90 * ONE);

/** A skid has to be this fast before it is worth telling anyone about. */
const SKID_NOTICE = Math.round(1.4 * ONE);

/**
 * How evenly a ball has to be shaped before the bumps stop mattering.
 *
 * Below this the ball starts catching on its own corners; a properly round
 * one sits comfortably above it.
 */
const EVEN_ENOUGH = Math.round(0.55 * ONE);

/** The range over which a ball goes from catching badly to rolling cleanly. */
const EVEN_RANGE = Math.round(0.4 * ONE);

/**
 * How much each lump standing proud of the body adds to the bumpiness.
 *
 * The unevenness of the outline already covers how far the worst lump
 * sticks out. This covers how many there are, which is what decides how
 * often the ball trips as it goes round.
 */
const PROUD_WEIGHT = Math.round(26 * ONE);

/** How far the ball rolls between one bump landing and the next. */
const BUMP_SPACING = Math.round(1.5 * ONE);

/** How hard a bump throws the ball up, per unit of bumpiness and speed. */
const BUMP_LIFT = Math.round(0.19 * ONE);

/** How much speed each bump costs, as a share of the throw. */
const BUMP_LOSS = Math.round(0.28 * ONE);

/** Below this speed the ball rolls over its bumps rather than tripping on them. */
const BUMP_FLOOR = Math.round(1.5 * ONE);

/**
 * How much the weight sitting off-centre counts towards wandering.
 *
 * Being off-centre is measured as a share of the ball's reach, and even a
 * badly lopsided design only lands around a tenth of that, so it is worth a
 * good deal each.
 */
const LEAN_WEIGHT = Math.round(4.5 * ONE);

/** How much being generally knobbly counts towards it as well. */
const KNOBBLY_WEIGHT = Math.round(0.55 * ONE);

/** How hard a wandering ball is thrown off its line, per unit of speed. */
const VEER_PUSH = Math.round(0.014 * ONE);

/**
 * How far the ball travels for one full swing of the wander, in metres.
 *
 * Slow enough to read as the ball pulling off its line and having to be
 * caught, rather than as a shiver.
 */
const VEER_WAVELENGTH = Math.round(9 * ONE);

/**
 * How hard the weight inside a lopsided ball drives it along, per unit of
 * speed, as that weight falls and climbs again.
 */
const SURGE_PUSH = Math.round(0.05 * ONE);

/**
 * How much a ball that turns unevenly fights part of every turn.
 *
 * It holds the ball back through the hard part of every turn and lets it
 * away through the easy part, so the ball comes round in surges rather than
 * at a steady rate. Over a whole turn it costs nothing.
 */
const FIGHT_DRAG = Math.round(0.03 * ONE);

/**
 * How far a ball travels in one turn, as a multiple of what it rests on.
 *
 * The distance round the outside, which is what a rolling ball lays down on
 * the floor in one revolution.
 */
const TURN_DISTANCE = Math.round(2 * Math.PI * ONE);

/** How each kind of floor behaves. */
interface FloorBehaviour {
  /** How hard the floor can hold the ball before it starts to skid. */
  grip: number;
  /** Steady slowing while rolling, as a share of how hard the ball presses. */
  rollingDrag: number;
  /** A steady shove along the course, for the speed-up strips. */
  shove: number;
}

const FLOORS: Record<number, FloorBehaviour> = {
  [Surface.Normal]: {
    grip: Math.round(0.9 * ONE),
    rollingDrag: Math.round(0.03 * ONE),
    shove: 0,
  },
  [Surface.Slick]: {
    // Low enough that the ball cannot quite spin itself up on the steeper
    // stretches, so it visibly skids there while still rolling on gentle
    // ones. That is how a real slippery slope behaves.
    grip: Math.round(0.045 * ONE),
    rollingDrag: Math.round(0.008 * ONE),
    shove: 0,
  },
  [Surface.Rough]: {
    grip: Math.round(1.1 * ONE),
    rollingDrag: Math.round(0.085 * ONE),
    shove: 0,
  },
  [Surface.Boost]: {
    grip: Math.round(0.9 * ONE),
    rollingDrag: Math.round(0.02 * ONE),
    shove: Math.round(6.5 * ONE),
  },
};

/** How the ball handles, worked out once from the player's design. */
export interface BallFeel {
  /** What the ball rests on: middle to floor. */
  radius: number;
  weight: number;
  smoothness: number;
  /** How hard the ball is to spin up, from where its cubes sit. */
  spinResistance: number;
  /**
   * How much of a skid one shove from the ground can take out. A ball that
   * is easy to spin up gives up more of its skid at once.
   */
  gripShare: number;
  /** How well this ball holds the floor, where ONE is an even, round one. */
  gripScale: number;
  /** How much this ball scrubs off while rolling, where ONE is normal. */
  dragScale: number;
  /**
   * How badly the ball catches on its own shape, from 0 for a properly round
   * one up towards ONE for something spiky. This is what makes a lump on the
   * side genuinely worse to roll rather than merely different.
   */
  bumpiness: number;
  /**
   * How badly the ball throws itself off a straight line, from 0 to ONE.
   *
   * A ball whose weight sits off the middle swings that weight around as it
   * rolls, and each turn pushes it a little to one side. A knobbly one does
   * the same by meeting the floor on a different corner each time. Either
   * way it will not hold the line you put it on, and has to be steered.
   */
  veer: number;
  /**
   * How hard the ball lurches along as it turns, from 0 to ONE.
   *
   * The weight inside a lopsided ball falls through the bottom of every
   * turn and has to be lifted back over the top. Falling drives the ball
   * on; climbing holds it back. It averages out over a turn and is felt the
   * whole way: the ball surges rather than running smoothly.
   */
  surge: number;
  /**
   * How unevenly the ball comes round, from 0 to ONE.
   *
   * Weight gathered along one line makes a ball easy to turn one way and
   * hard the others, so it fights part of every turn. Twice per turn, not
   * once: turning about a line is the same job whichever end is up.
   */
  spinSpread: number;
}

/** Turns a measured design into the numbers the physics uses. */
export function ballFeelFrom(stats: ShapeStats): BallFeel {
  // How close to properly round the design is, stretched so that a ball worth
  // calling round scores full marks and anything knobbly drops away quickly.
  const evenness = clamp(div(stats.smoothness - EVEN_ENOUGH, EVEN_RANGE), 0, ONE);
  const bumpiness = clamp(ONE - evenness + mul(PROUD_WEIGHT, stats.proudShare), 0, ONE);

  // A lumpy ball meets the floor unevenly: it holds on less well, scrubs off
  // more speed, and trips over its own corners as it goes. How quickly it
  // gets going is not fiddled with here at all — that already falls out of
  // where its cubes sit.
  return {
    radius: stats.radius,
    weight: stats.weight,
    smoothness: stats.smoothness,
    spinResistance: stats.spinResistance,
    gripShare: gripShare(stats.spinResistance),
    gripScale: Math.round(0.32 * ONE) + mul(Math.round(0.68 * ONE), evenness),
    dragScale: ONE + mul(Math.round(1.3 * ONE), bumpiness),
    bumpiness,
    veer: clamp(mul(LEAN_WEIGHT, stats.lopsided) + mul(KNOBBLY_WEIGHT, bumpiness), 0, ONE),
    surge: clamp(mul(LEAN_WEIGHT, stats.lopsided), 0, ONE),
    spinSpread: stats.spinSpread,
  };
}

/** Something worth showing or hearing about, produced by a step. */
export interface Moment {
  kind: 'land' | 'wall' | 'skid' | 'finish' | 'fall' | 'stuck';
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
  /** Which side of the course this group sits on: -1 for left, 1 for right. */
  facing: number;
  /** Which point of the course it is beside. */
  pointIndex: number;
}

const ATTENTION_RANGE = Math.round(46 * ONE);
const REGION_SPACING = 8; // metres
const SCENERY_LIMIT = 320;

/** How far past the edge of the floor the scenery starts. */
const SIDE_CLEARANCE = Math.round(3.4 * ONE);

/** How much further out than that it may wander. */
const SIDE_SPREAD = Math.round(5.0 * ONE);

/** How far the members of one group spread around their group. */
const MEMBER_SPREAD = Math.round(1.8 * ONE);

/** Working space for the rolling maths, reused so nothing is thrown away. */
const slipScratch: Triple = triple();
const spinScratch: Triple = triple();

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
  /** How fast the ball is turning, and about which way. */
  readonly spinX: Int32Array;
  readonly spinY: Int32Array;
  readonly spinZ: Int32Array;
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
  readonly elapsedSteps: Int32Array;
  /** How many times the ball has gone over the edge and been fetched back. */
  readonly falls: Int32Array;
  /** Steps left of the pause after a fall, while the ball is put back. */
  readonly recovering: Int32Array;
  /** How far through the gap between one bump and the next the ball is. */
  readonly bumpPhase: Int32Array;
  /** Steps left before a ball that is getting nowhere ends the run. */
  readonly stallCountdown: Int32Array;
  /** The furthest the ball has been since it last made real progress. */
  private readonly progressMark: Int32Array;
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
    this.spinX = new Int32Array(slots);
    this.spinY = new Int32Array(slots);
    this.spinZ = new Int32Array(slots);
    this.state = new Int32Array(slots);
    this.travelled = new Int32Array(slots);
    this.sideways = new Int32Array(slots);
    this.sidewaysSpeed = new Int32Array(slots);
    this.halfWidth = new Int32Array(slots);
    this.aboveFloor = new Int32Array(slots);
    this.grounded = new Uint8Array(slots);
    this.topSpeed = new Int32Array(slots);
    this.finishStep = new Int32Array(slots).fill(-1);
    this.elapsedSteps = new Int32Array(slots);
    this.falls = new Int32Array(slots);
    this.recovering = new Int32Array(slots);
    this.bumpPhase = new Int32Array(slots);
    this.stallCountdown = new Int32Array(slots).fill(STALL_LIMIT);
    this.progressMark = new Int32Array(slots);
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
      this.x[p] =
        c.startX + mul(c.rightX[0], offset) + mul(c.upX[0], lift) + mul(c.forwardX[0], START_INSET);
      this.y[p] =
        c.startY + mul(c.rightY[0], offset) + mul(c.upY[0], lift) + mul(c.forwardY[0], START_INSET);
      this.z[p] =
        c.startZ + mul(c.rightZ[0], offset) + mul(c.upZ[0], lift) + mul(c.forwardZ[0], START_INSET);
      this.velocityX[p] = 0;
      this.velocityY[p] = 0;
      this.velocityZ[p] = 0;
      this.spinX[p] = 0;
      this.spinY[p] = 0;
      this.spinZ[p] = 0;
      // With no countdown asked for, the ball is free from the very first step.
      this.state[p] = this.countdown > 0 ? RunState.Ready : RunState.Rolling;
      this.hint[p] = 0;
      this.travelled[p] = 0;
      this.topSpeed[p] = 0;
      this.finishStep[p] = -1;
      this.elapsedSteps[p] = 0;
      this.falls[p] = 0;
      this.recovering[p] = 0;
      this.bumpPhase[p] = 0;
      this.stallCountdown[p] = STALL_LIMIT;
      this.progressMark[p] = 0;
    }
  }

  /**
   * Puts one ball back on the start line, still, and leaves everything else
   * about the run alone: the clock, the falls so far, the scenery.
   */
  private returnToStart(player: number): void {
    const c = this.course;
    const offset =
      this.players > 1 ? Math.round((player - (this.players - 1) / 2) * 1.6 * ONE) : 0;
    const lift = this.feel.radius;
    this.x[player] =
      c.startX + mul(c.rightX[0], offset) + mul(c.upX[0], lift) + mul(c.forwardX[0], START_INSET);
    this.y[player] =
      c.startY + mul(c.rightY[0], offset) + mul(c.upY[0], lift) + mul(c.forwardY[0], START_INSET);
    this.z[player] =
      c.startZ + mul(c.rightZ[0], offset) + mul(c.upZ[0], lift) + mul(c.forwardZ[0], START_INSET);
    this.velocityX[player] = 0;
    this.velocityY[player] = 0;
    this.velocityZ[player] = 0;
    this.spinX[player] = 0;
    this.spinY[player] = 0;
    this.spinZ[player] = 0;
    this.hint[player] = 0;
    this.bumpPhase[player] = 0;
    // Going over the edge is a fresh attempt, not more of the same standing
    // still, so the count starts again from the top.
    this.stallCountdown[player] = STALL_LIMIT;
    this.progressMark[player] = 0;
    this.travelled[player] = 0;
    this.sideways[player] = 0;
    this.sidewaysSpeed[player] = 0;
    this.aboveFloor[player] = 0;
    this.grounded[player] = 1;
  }

  /**
   * Scatters scenery along the course, always to the side of it and never
   * over it. The way ahead is kept completely clear: nothing the player has
   * to steer around, and nothing hanging at ball height over the floor.
   *
   * Each region is described by a short note, and the note is what actually
   * creates the members, so a region can be thrown away and rebuilt later
   * without anything shifting.
   */
  private growScenery(): void {
    const c = this.course;
    const totalMetres = c.totalLength / ONE;
    const regionCount = Math.max(1, Math.floor(totalMetres / REGION_SPACING));
    for (let r = 0; r < regionCount; r++) {
      const rng = new Generator(mix(this.seed, r, 0x5cee));
      const population = 3 + rng.below(4);
      if (this.scenery.count + population > this.scenery.capacity) break;

      const distance = Math.round((r + 0.5) * REGION_SPACING * ONE);
      const pointIndex = Math.min(c.count - 1, Math.max(0, Math.round(distance / ONE / 2)));

      // Well clear of the edge of the floor, on one side or the other.
      const facing = rng.below(2) === 0 ? -1 : 1;
      const clearance = c.halfWidth[pointIndex] + SIDE_CLEARANCE;
      const side = facing * (clearance + ((rng.unit() * SIDE_SPREAD) >> 16));

      const note: GroupSummary = {
        x: c.x[pointIndex] + mul(c.rightX[pointIndex], side),
        y: c.y[pointIndex] + mul(c.upY[pointIndex], Math.round(0.9 * ONE)),
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
      for (let n = 0; n < population; n++) {
        const slot = from + n;
        const looksRng = new Generator(mix(this.seed, slot, 0x0b1e));
        this.scenery.setKind(slot, looksRng.below(4));
        this.scenery.setLooks(slot, looksRng.below(256));
      }
      const region: SceneryRegion = { from, count: population, note, awake: true, facing, pointIndex };
      this.placeRegion(region);
      this.regions.push(region);
    }
  }

  /**
   * Puts a region back where it belongs, whether it is being made for the
   * first time or woken up again after being set aside.
   */
  private placeRegion(region: SceneryRegion): void {
    restoreGroup(this.scenery, region.from, region.count, region.note, this.seed, MEMBER_SPREAD);
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

  /** How fast the ball is turning, however it happens to be pointed. */
  spinFor(player = 0): number {
    return length3(this.spinX[player], this.spinY[player], this.spinZ[player]);
  }

  /**
   * How much of the ball is sliding rather than rolling, from 0 (rolling
   * cleanly) upwards. The picture uses this to show a skid.
   */
  skidFor(player = 0): number {
    if (!this.grounded[player]) return 0;
    const point = this.hintFor(player);
    const c = this.course;
    slipInto(
      slipScratch,
      this.velocityX[player],
      this.velocityY[player],
      this.velocityZ[player],
      this.spinX[player],
      this.spinY[player],
      this.spinZ[player],
      c.upX[point],
      c.upY[point],
      c.upZ[point],
      this.feel.radius,
    );
    return magnitude(slipScratch.x, slipScratch.y, slipScratch.z);
  }

  /** Which point of the course the ball was last found beside. */
  hintFor(player = 0): number {
    return this.hint[player];
  }

  /** Seconds left before a ball that is getting nowhere ends the run. */
  stallSecondsFor(player = 0): number {
    return this.stallCountdown[player] / STEPS_PER_SECOND;
  }

  /** True once the ball has been getting nowhere long enough to say so. */
  isStalling(player = 0): boolean {
    return this.stallCountdown[player] < STALL_LIMIT - STEPS_PER_SECOND;
  }

  /** The progress marks, for taking a copy of the world. */
  saveProgressMarks(): Int32Array {
    return this.progressMark.slice();
  }

  /** Puts the progress marks back from a copy. */
  loadProgressMarks(marks: Int32Array): void {
    this.progressMark.set(marks);
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
        // The clock runs through a recovery as well: that is what a fall costs.
        this.elapsedSteps[p]++;
        if (this.recovering[p] > 0) {
          this.recovering[p]--;
          continue;
        }
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
    const pastTheEnds = where.pastEnd > 0;
    const gapFromFloor = where.height - this.feel.radius;
    const withinFloor = abs(where.sideways) <= where.halfWidth;
    const touching =
      !overGap &&
      !pastTheEnds &&
      withinFloor &&
      gapFromFloor <= CONTACT_SLACK &&
      gapFromFloor > -CATCH_DEPTH;
    const floor = FLOORS[where.surface] ?? FLOORS[Surface.Normal];

    // The player tips the course; gravity does the rest of the work. Off the
    // ground there is nothing to push against, so only a token amount of
    // steering is allowed through.
    const sideways = touching
      ? mul(TILT_SIDEWAYS, controls.steer)
      : mul(AIR_CONTROL, controls.steer);
    // Dragging forwards tips the course down the hill. Dragging back does not
    // tip it the other way: it brakes. A downhill run only goes one way, and
    // being able to drive the ball back out through the start line was never
    // meant to be part of it.
    const ahead = touching && controls.push > 0 ? mul(TILT_AHEAD, controls.push) : 0;

    let accelX = mul(rightX, sideways) + mul(forwardX, ahead);
    let accelY = -GRAVITY + mul(rightY, sideways) + mul(forwardY, ahead);
    let accelZ = mul(rightZ, sideways) + mul(forwardZ, ahead);

    if (touching && controls.push < 0) {
      // Braking, and never harder than it takes to come to a stop, so the
      // ball cannot be driven backwards down the course.
      const alongCourse = dot(
        this.velocityX[player],
        this.velocityY[player],
        this.velocityZ[player],
        forwardX,
        forwardY,
        forwardZ,
      );
      if (alongCourse > 0) {
        const wanted = mul(BRAKING, -controls.push);
        const enoughToStop = alongCourse * STEPS_PER_SECOND;
        const braking = wanted < enoughToStop ? wanted : enoughToStop;
        accelX -= mul(forwardX, braking);
        accelY -= mul(forwardY, braking);
        accelZ -= mul(forwardZ, braking);
      }
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

    // How hard the ball presses onto the floor. Everything the ground can do
    // to the ball, whether hold it, spin it or slow it, is measured against
    // this one number.
    let pressing = 0;
    if (touching) {
      const intoFloor = dot(accelX, accelY, accelZ, upX, upY, upZ);
      if (intoFloor < 0) {
        pressing = -intoFloor;
        accelX -= mul(upX, intoFloor);
        accelY -= mul(upY, intoFloor);
        accelZ -= mul(upZ, intoFloor);
      }
      if (floor.shove !== 0) {
        accelX += mul(forwardX, floor.shove);
        accelY += mul(forwardY, floor.shove);
        accelZ += mul(forwardZ, floor.shove);
      }
    }

    // The air always resists, and a heavier ball shrugs it off better.
    const speedNow = this.speedFor(player);
    if (speedNow > 0) {
      const resist = div(mul(AIR_RESISTANCE, speedNow), Math.max(1, this.feel.weight));
      accelX -= mul(this.velocityX[player], resist);
      accelY -= mul(this.velocityY[player], resist);
      accelZ -= mul(this.velocityZ[player], resist);
    }

    this.velocityX[player] += perStep(accelX);
    this.velocityY[player] += perStep(accelY);
    this.velocityZ[player] += perStep(accelZ);

    if (touching) {
      this.settleOnFloor(player, upX, upY, upZ, gapFromFloor);
      // The ground grips the ball at the one point where they touch. That
      // grip is what turns sliding into rolling, and a slippery floor is
      // simply one that runs out of grip too soon.
      const hold = perStep(mul(mul(floor.grip, this.feel.gripScale), pressing));
      this.applyGrip(player, upX, upY, upZ, hold, true);
      this.applyRollingDrag(player, upX, upY, upZ, floor, pressing);
      this.tripOverBumps(player, upX, upY, upZ, where.travelled);
      this.wanderOffLine(player, upX, upY, upZ, where.travelled);
      this.turnUnevenly(player, where.travelled);
    } else {
      // Off the ground the spin simply carries on.
      this.spinX[player] = mul(this.spinX[player], AIR_SPIN_KEEP);
      this.spinY[player] = mul(this.spinY[player], AIR_SPIN_KEEP);
      this.spinZ[player] = mul(this.spinZ[player], AIR_SPIN_KEEP);
    }

    this.capSpeeds(player);

    this.x[player] += perStep(this.velocityX[player]);
    this.y[player] += perStep(this.velocityY[player]);
    this.z[player] += perStep(this.velocityZ[player]);

    this.settleAgainstWalls(player, (where.flags & PointFlag.Walls) !== 0);
    this.judge(player);
  }

  /** Sits the ball on the floor and stops it sinking in. */
  private settleOnFloor(
    player: number,
    upX: number,
    upY: number,
    upZ: number,
    gapFromFloor: number,
  ): void {
    if (gapFromFloor >= 0) return;
    this.x[player] -= mul(upX, gapFromFloor);
    this.y[player] -= mul(upY, gapFromFloor);
    this.z[player] -= mul(upZ, gapFromFloor);
    const intoSurface = dot(
      this.velocityX[player],
      this.velocityY[player],
      this.velocityZ[player],
      upX,
      upY,
      upZ,
    );
    if (intoSurface >= 0) return;
    // Cancel the movement into the floor, and add a little bounce back only
    // when the landing was hard enough to be worth feeling.
    const impact = -intoSurface;
    const springiness = impact > Math.round(1.6 * ONE) ? LANDING_BOUNCE : 0;
    const change = impact + mul(impact, springiness);
    this.velocityX[player] += mul(upX, change);
    this.velocityY[player] += mul(upY, change);
    this.velocityZ[player] += mul(upZ, change);
    if (impact > Math.round(2.0 * ONE)) this.addMoment('land', player, impact);
  }

  /**
   * The ground takes a bite out of however fast the ball is sliding, and the
   * same bite turns the ball, because it lands at the bottom of the ball
   * rather than through the middle.
   *
   * When the ground can take out the whole skid, the ball rolls cleanly. When
   * it cannot, on ice or under hard steering, what is left over is a visible
   * skid, which is how a real ball behaves.
   *
   * @param allowance the largest change in travel this surface can manage
   * @param report    whether a bad skid is worth mentioning to the player
   */
  private applyGrip(
    player: number,
    normalX: number,
    normalY: number,
    normalZ: number,
    allowance: number,
    report: boolean,
  ): void {
    if (allowance <= 0) return;
    slipInto(
      slipScratch,
      this.velocityX[player],
      this.velocityY[player],
      this.velocityZ[player],
      this.spinX[player],
      this.spinY[player],
      this.spinZ[player],
      normalX,
      normalY,
      normalZ,
      this.feel.radius,
    );
    const skid = magnitude(slipScratch.x, slipScratch.y, slipScratch.z);
    if (skid <= 0) return;

    const wanted = mul(this.feel.gripShare, skid);
    const change = wanted < allowance ? wanted : allowance;
    const changeX = -div(mul(slipScratch.x, change), skid);
    const changeY = -div(mul(slipScratch.y, change), skid);
    const changeZ = -div(mul(slipScratch.z, change), skid);

    this.velocityX[player] += changeX;
    this.velocityY[player] += changeY;
    this.velocityZ[player] += changeZ;

    spinChangeInto(
      spinScratch,
      changeX,
      changeY,
      changeZ,
      normalX,
      normalY,
      normalZ,
      this.feel.spinResistance,
      this.feel.radius,
    );
    this.spinX[player] += spinScratch.x;
    this.spinY[player] += spinScratch.y;
    this.spinZ[player] += spinScratch.z;

    // A long skid would otherwise report itself on every single step, so it
    // is mentioned now and then rather than constantly.
    if (report && wanted > allowance && skid > SKID_NOTICE && this.step % 8 === 0) {
      this.addMoment('skid', player, skid);
    }
  }

  /**
   * The steady cost of rolling along. It comes out of the travel and the
   * spin together, so that slowing down does not by itself tip the ball into
   * a skid.
   */
  private applyRollingDrag(
    player: number,
    upX: number,
    upY: number,
    upZ: number,
    floor: FloorBehaviour,
    pressing: number,
  ): void {
    const speed = this.speedFor(player);
    if (speed <= 0 || pressing <= 0) return;
    const slow = perStep(mul(mul(floor.rollingDrag, this.feel.dragScale), pressing));
    const drop = slow < speed ? slow : speed;
    if (drop <= 0) return;
    const changeX = -div(mul(this.velocityX[player], drop), speed);
    const changeY = -div(mul(this.velocityY[player], drop), speed);
    const changeZ = -div(mul(this.velocityZ[player], drop), speed);
    this.velocityX[player] += changeX;
    this.velocityY[player] += changeY;
    this.velocityZ[player] += changeZ;

    rollingSpinInto(spinScratch, changeX, changeY, changeZ, upX, upY, upZ, this.feel.radius);
    this.spinX[player] += spinScratch.x;
    this.spinY[player] += spinScratch.y;
    this.spinZ[player] += spinScratch.z;
  }

  /**
   * Lets a knobbly ball catch on its own corners.
   *
   * A ball that is not round does not roll on one steady radius: every so
   * often a lump comes round to the bottom, hits the floor, throws the ball
   * up a little and takes some speed with it. How often that happens depends
   * on how far it has rolled, so it stays in step with what is drawn, and how
   * hard depends on how uneven the ball is and how fast it is going.
   *
   * A properly round ball has no bumpiness at all, so this does nothing to it.
   */
  private tripOverBumps(
    player: number,
    upX: number,
    upY: number,
    upZ: number,
    travelled: number,
  ): void {
    if (this.feel.bumpiness <= 0) return;
    const speed = this.speedFor(player);
    if (speed <= BUMP_FLOOR) return;

    const spacing = Math.max(1, mul(this.feel.radius, BUMP_SPACING));
    const phase = div(travelled, spacing);
    const crossed = Math.floor(phase / ONE) !== Math.floor(this.bumpPhase[player] / ONE);
    this.bumpPhase[player] = phase;
    if (!crossed) return;

    const jolt = mul(mul(BUMP_LIFT, this.feel.bumpiness), speed);
    this.velocityX[player] += mul(upX, jolt);
    this.velocityY[player] += mul(upY, jolt);
    this.velocityZ[player] += mul(upZ, jolt);

    // Hitting a corner costs speed as well as sending the ball up.
    const loss = mul(jolt, BUMP_LOSS);
    const drop = loss < speed ? loss : speed;
    this.velocityX[player] -= div(mul(this.velocityX[player], drop), speed);
    this.velocityY[player] -= div(mul(this.velocityY[player], drop), speed);
    this.velocityZ[player] -= div(mul(this.velocityZ[player], drop), speed);
  }

  /**
   * Pushes the ball off the line it is on, by however much its shape says.
   *
   * The push swings from one side to the other as the ball travels, because
   * that is what the weight inside it is doing: coming round, pulling one
   * way, going over the top, pulling the other. A properly round ball has
   * nothing to swing and goes exactly where it is sent.
   *
   * It is a push, not a steer: the ball can be held on line by working at
   * it, which is the whole point of building an awkward one.
   */
  private wanderOffLine(
    player: number,
    upX: number,
    upY: number,
    upZ: number,
    travelled: number,
  ): void {
    if (this.feel.veer <= 0) return;
    const speed = this.speedFor(player);
    if (speed <= BUMP_FLOOR) return;

    // Sideways is across the way it is going and across the way up.
    const vx = this.velocityX[player];
    const vy = this.velocityY[player];
    const vz = this.velocityZ[player];
    let sideX = mul(upY, vz) - mul(upZ, vy);
    let sideY = mul(upZ, vx) - mul(upX, vz);
    let sideZ = mul(upX, vy) - mul(upY, vx);
    const sideLength = length3(sideX, sideY, sideZ);
    if (sideLength <= 0) return;
    sideX = div(sideX, sideLength);
    sideY = div(sideY, sideLength);
    sideZ = div(sideZ, sideLength);

    // Where the weight has got to in its swing, from how far the ball has
    // come. The same ball on the same course always swings the same way.
    const phase = div(travelled, VEER_WAVELENGTH) & 0xffff;
    const swing = sine(phase);

    const push = mul(mul(mul(VEER_PUSH, this.feel.veer), speed), swing);
    this.velocityX[player] += mul(sideX, push);
    this.velocityY[player] += mul(sideY, push);
    this.velocityZ[player] += mul(sideZ, push);
  }

  /**
   * Drives the ball on and holds it back as its own weight goes round.
   *
   * Two things happen here, and they happen at different rates on purpose.
   * The weight inside a lopsided ball comes round once per turn: falling on
   * the way down, climbing on the way up. How hard the ball is to turn goes
   * round twice per turn, because turning about a line is the same work
   * whichever end of it is uppermost.
   *
   * Neither adds energy over a whole turn. What they do is stop the ball
   * running smoothly, which is what an awkward shape does.
   */
  private turnUnevenly(player: number, travelled: number): void {
    const feel = this.feel;
    if (feel.surge <= 0 && feel.spinSpread <= 0) return;
    const speed = this.speedFor(player);
    if (speed <= BUMP_FLOOR) return;

    // Where the ball has got to in its own turn. One turn carries it the
    // distance round its outside, so this is the same for any size of ball.
    const roll = Math.max(1, mul(feel.radius, TURN_DISTANCE));
    const turn = div(travelled, roll) & 0xffff;

    let along = 0;
    if (feel.surge > 0) {
      // The weight falling and climbing, once per turn.
      along += mul(mul(mul(SURGE_PUSH, feel.surge), speed), sine(turn));
    }
    if (feel.spinSpread > 0) {
      // Coming round easily on one part of the turn and fighting the next,
      // twice per turn. It gives back what it takes: the ball ends the turn
      // where it would have been, having got there unevenly.
      const fight = sine((turn * 2) & 0xffff);
      along += mul(mul(mul(FIGHT_DRAG, feel.spinSpread), speed), fight);
    }
    if (along === 0) return;

    this.velocityX[player] += div(mul(this.velocityX[player], along), speed);
    this.velocityY[player] += div(mul(this.velocityY[player], along), speed);
    this.velocityZ[player] += div(mul(this.velocityZ[player], along), speed);
  }

  /** Keeps travel and spin inside sensible limits. */
  private capSpeeds(player: number): void {
    const speed = this.speedFor(player);
    if (speed > SPEED_LIMIT) {
      const scale = div(SPEED_LIMIT, speed);
      this.velocityX[player] = mul(this.velocityX[player], scale);
      this.velocityY[player] = mul(this.velocityY[player], scale);
      this.velocityZ[player] = mul(this.velocityZ[player], scale);
    }
    if (speed > this.topSpeed[player]) this.topSpeed[player] = speed;

    const spin = this.spinFor(player);
    if (spin > SPIN_LIMIT) {
      const scale = div(SPIN_LIMIT, spin);
      this.spinX[player] = mul(this.spinX[player], scale);
      this.spinY[player] = mul(this.spinY[player], scale);
      this.spinZ[player] = mul(this.spinZ[player], scale);
    }
  }

  private settleAgainstWalls(player: number, hasWalls: boolean): void {
    if (!hasWalls) return;
    const c = this.course;
    const after = placeOnCourse(c, this.x[player], this.y[player], this.z[player], this.hint[player]);
    const i = after.point;
    const limit = after.halfWidth - this.feel.radius;
    if (abs(after.sideways) <= limit) return;
    // Sailing over the top of the wall rather than into it.
    if (after.height - this.feel.radius > WALL_HEIGHT) return;
    if (after.pastEnd > 0) return;

    const overshoot = abs(after.sideways) - limit;
    const direction = sign(after.sideways);
    this.x[player] -= mul(c.rightX[i], overshoot * direction);
    this.y[player] -= mul(c.rightY[i], overshoot * direction);
    this.z[player] -= mul(c.rightZ[i], overshoot * direction);

    // The wall pushes back along its own face, so its outward direction
    // points away from whichever edge the ball has run into.
    const wallX = -c.rightX[i] * direction;
    const wallY = -c.rightY[i] * direction;
    const wallZ = -c.rightZ[i] * direction;
    const intoWall = dot(
      this.velocityX[player],
      this.velocityY[player],
      this.velocityZ[player],
      wallX,
      wallY,
      wallZ,
    );
    if (intoWall >= 0) return;

    const impact = -intoWall;
    const change = impact + mul(impact, WALL_BOUNCE);
    this.velocityX[player] += mul(wallX, change);
    this.velocityY[player] += mul(wallY, change);
    this.velocityZ[player] += mul(wallZ, change);

    // Scrubbing along the wall also sets the ball spinning, by no more than
    // the knock itself can account for.
    this.applyGrip(player, wallX, wallY, wallZ, mul(WALL_GRIP, change), false);
    if (impact > Math.round(1.5 * ONE)) this.addMoment('wall', player, impact);
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
      where.pastEnd === 0 &&
      abs(where.sideways) <= where.halfWidth &&
      this.aboveFloor[player] <= CONTACT_SLACK &&
      this.aboveFloor[player] > -CATCH_DEPTH
        ? 1
        : 0;

    // Off the side of the floor entirely, and sinking below it. Waiting for
    // the ball to drop a full six metres let it slip off a narrow stretch,
    // dip below the edge and be picked up again where the floor widened out,
    // which looked for all the world like falling off and getting away with it.
    const clearOfEdge =
      abs(where.sideways) > where.halfWidth + this.feel.radius + EDGE_CLEARANCE;
    const sinking = where.height < 0;

    if (where.height < -FALL_LIMIT || (clearOfEdge && sinking)) {
      // Over the edge. Note where it happened for the picture, then put the
      // ball back on the start line and let the run carry on.
      this.addMoment('fall', player, ONE);
      this.falls[player]++;
      this.returnToStart(player);
      this.recovering[player] = RECOVERY_HOLD;
      return;
    }

    const nearEnd = where.travelled >= c.totalLength - Math.round(1.5 * ONE);
    if (nearEnd && (where.flags & PointFlag.Finish) !== 0) {
      this.state[player] = RunState.Finished;
      this.finishStep[player] = this.elapsedSteps[player];
      this.addMoment('finish', player, ONE);
      return;
    }

    // Getting somewhere refills the count; standing still runs it down.
    if (where.travelled > this.progressMark[player] + PROGRESS_STEP) {
      this.progressMark[player] = where.travelled;
      this.stallCountdown[player] = STALL_LIMIT;
      return;
    }
    this.stallCountdown[player]--;
    if (this.stallCountdown[player] <= 0) {
      this.stallCountdown[player] = 0;
      this.state[player] = RunState.Stuck;
      this.addMoment('stuck', player, ONE);
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
        this.placeRegion(region);
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
        .add(this.spinX[p])
        .add(this.spinY[p])
        .add(this.spinZ[p])
        .add(this.state[p])
        .add(this.elapsedSteps[p])
        .add(this.falls[p])
        .add(this.recovering[p])
        .add(this.bumpPhase[p])
        .add(this.stallCountdown[p])
        .add(this.progressMark[p]);
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
  spinX: Int32Array;
  spinY: Int32Array;
  spinZ: Int32Array;
  state: Int32Array;
  travelled: Int32Array;
  topSpeed: Int32Array;
  finishStep: Int32Array;
  elapsedSteps: Int32Array;
  falls: Int32Array;
  recovering: Int32Array;
  bumpPhase: Int32Array;
  stallCountdown: Int32Array;
  progressMark: Int32Array;
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
    spinX: world.spinX.slice(),
    spinY: world.spinY.slice(),
    spinZ: world.spinZ.slice(),
    state: world.state.slice(),
    travelled: world.travelled.slice(),
    topSpeed: world.topSpeed.slice(),
    finishStep: world.finishStep.slice(),
    elapsedSteps: world.elapsedSteps.slice(),
    falls: world.falls.slice(),
    recovering: world.recovering.slice(),
    bumpPhase: world.bumpPhase.slice(),
    stallCountdown: world.stallCountdown.slice(),
    progressMark: world.saveProgressMarks(),
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
  world.spinX.set(snapshot.spinX);
  world.spinY.set(snapshot.spinY);
  world.spinZ.set(snapshot.spinZ);
  world.state.set(snapshot.state);
  world.travelled.set(snapshot.travelled);
  world.topSpeed.set(snapshot.topSpeed);
  world.finishStep.set(snapshot.finishStep);
  world.elapsedSteps.set(snapshot.elapsedSteps);
  world.falls.set(snapshot.falls);
  world.recovering.set(snapshot.recovering);
  world.bumpPhase.set(snapshot.bumpPhase);
  world.stallCountdown.set(snapshot.stallCountdown);
  world.loadProgressMarks(snapshot.progressMark);
  snapshot.scenery.copyTo(world.scenery);
  snapshot.surroundings.copyTo(world.surroundings);
  world.loadAttention(snapshot.attention);
}
