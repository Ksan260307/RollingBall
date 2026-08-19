/**
 * The point of letting people build their own ball is that the shape they
 * build should change how it rolls. These tests hold that promise to
 * account: a properly round ball must be unaffected, and a knobbly one must
 * be genuinely, measurably worse to get down a hill.
 */

import { describe, expect, it } from 'vitest';
import { buildCourse } from '../src/core/course';
import { toNumber } from '../src/core/fixed';
import {
  SHAPE_CELLS,
  SHAPE_CENTRE,
  SHAPE_SIZE,
  cellIndex,
  cubeShape,
  defaultShape,
  measureShape,
  readWeightAt,
  pebbleShape,
  randomShape,
} from '../src/core/ballShape';
import { packControls } from '../src/core/input';
import { RunState, STEPS_PER_SECOND, World, ballFeelFrom } from '../src/core/simulation';
import { STAGES, courseFor } from '../src/game/stages';
import { runWithAutopilot } from './helpers/autopilot';

const NEUTRAL = packControls({ steer: 0, push: 0, buttons: 0 });

/** A round ball with a couple of lumps stuck on the side. */
function lumpyShape(): Uint8Array {
  const voxels = defaultShape();
  for (const [x, y, z] of [
    [17, 9, 9],
    [16, 9, 9],
    [9, 17, 9],
    [9, 16, 9],
    [0, 8, 8],
    [1, 8, 8],
  ] as const) {
    voxels[cellIndex(x, y, z)] = 2;
  }
  return voxels;
}

function runOn(voxels: Uint8Array, drop = 8, seconds = 12): World {
  const world = new World({
    course: buildCourse([{ length: 400, drop, width: 14, walls: true }]),
    seed: 4,
    ball: measureShape(voxels),
    countdownSeconds: 0,
  });
  for (let i = 0; i < STEPS_PER_SECOND * seconds; i++) world.advance([NEUTRAL]);
  return world;
}

describe('how bumpy a shape is', () => {
  it('scores a properly round ball as having no bumps at all', () => {
    expect(ballFeelFrom(measureShape(defaultShape())).bumpiness).toBe(0);
    expect(toNumber(ballFeelFrom(measureShape(pebbleShape())).bumpiness)).toBeLessThan(0.1);
  });

  it('counts more lumps as bumpier than fewer', () => {
    const one = defaultShape();
    one[cellIndex(17, 9, 9)] = 2;
    const many = defaultShape();
    for (const [x, y, z] of [
      [17, 9, 9],
      [9, 17, 9],
      [0, 8, 8],
      [9, 9, 17],
      [8, 0, 8],
      [8, 8, 0],
    ] as const) {
      many[cellIndex(x, y, z)] = 2;
    }
    const oneBump = ballFeelFrom(measureShape(one)).bumpiness;
    const manyBumps = ballFeelFrom(measureShape(many)).bumpiness;
    expect(oneBump).toBeGreaterThan(0);
    expect(manyBumps).toBeGreaterThan(oneBump);
  });

  it('scores a box and a lumpy ball as bumpy', () => {
    const boxy = toNumber(ballFeelFrom(measureShape(cubeShape())).bumpiness);
    const lumpy = toNumber(ballFeelFrom(measureShape(lumpyShape())).bumpiness);
    for (const value of [boxy, lumpy]) {
      expect(value).toBeGreaterThan(0.2);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('scores most chaotic balls as bumpier than a round one', () => {
    // Pinning one seed says nothing useful now there are two dozen styles:
    // some of them (a potato, a stack of discs) are genuinely smooth, and
    // that is the point of having a lot of them. What must hold is that the
    // chaotic ones are bumpier than a proper ball as a rule.
    const round = toNumber(ballFeelFrom(measureShape(defaultShape())).bumpiness);
    const scores: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      scores.push(toNumber(ballFeelFrom(measureShape(randomShape(seed))).bumpiness));
    }
    for (const value of scores) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    const bumpier = scores.filter((value) => value > round).length;
    expect(bumpier).toBeGreaterThan(scores.length * 0.7);
    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    expect(average).toBeGreaterThan(0.2);
  });

  it('makes a bumpy ball drag more and hold on less', () => {
    const round = ballFeelFrom(measureShape(defaultShape()));
    const lumpy = ballFeelFrom(measureShape(lumpyShape()));
    expect(lumpy.dragScale).toBeGreaterThan(round.dragScale);
    expect(lumpy.gripScale).toBeLessThan(round.gripScale);
  });
});

describe('a lump on the side really is worse to roll', () => {
  it('slows the same ball down once lumps are stuck on it', () => {
    const round = runOn(defaultShape());
    const lumpy = runOn(lumpyShape());
    // Same course, same time, same everything but the shape.
    expect(lumpy.travelled[0]).toBeLessThan(round.travelled[0]);
    // And by a margin worth feeling, not a rounding difference.
    expect(lumpy.travelled[0]).toBeLessThan(round.travelled[0] * 0.85);
  });

  it('makes it hop, rather than merely slowing it', () => {
    const round = runOn(defaultShape());
    const lumpy = runOn(lumpyShape());
    // Bumps throw the ball off the floor now and then; a round one stays on.
    let roundAir = 0;
    let lumpyAir = 0;
    for (let i = 0; i < STEPS_PER_SECOND * 6; i++) {
      round.advance([NEUTRAL]);
      lumpy.advance([NEUTRAL]);
      if (!round.grounded[0]) roundAir++;
      if (!lumpy.grounded[0]) lumpyAir++;
    }
    expect(lumpyAir).toBeGreaterThan(roundAir);
  });

  it('leaves a properly round ball exactly as it was', () => {
    // The bump rules must not touch a ball with no bumps: the everyday
    // experience of the game has to stay put while shapes get interesting.
    const world = runOn(defaultShape());
    expect(world.bumpPhase[0]).toBe(0);
    expect(toNumber(world.speedFor(0))).toBeGreaterThan(6);
  });

  it('gets worse the bumpier the ball is', () => {
    const distances = [defaultShape(), lumpyShape(), cubeShape()].map(
      (voxels) => runOn(voxels).travelled[0],
    );
    expect(distances[1]).toBeLessThan(distances[0]);
    expect(distances[2]).toBeLessThan(distances[1]);
  });
});

describe('the chaotic ball', () => {
  it('gives a different shape for every seed, and the same one twice', () => {
    const a = randomShape(11);
    const b = randomShape(11);
    const c = randomShape(12);
    expect([...b]).toEqual([...a]);
    expect([...c]).not.toEqual([...a]);
  });

  it('always comes out as one joined-up lump of a usable size', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const voxels = randomShape(seed);
      const stats = measureShape(voxels);
      expect(stats.cubes).toBeGreaterThan(20);
      expect(toNumber(stats.radius)).toBeGreaterThan(0.05);

      // One lump, not several floating apart.
      const seen = new Uint8Array(SHAPE_CELLS);
      let start = -1;
      for (let i = 0; i < voxels.length; i++) {
        if (voxels[i] !== 0) {
          start = i;
          break;
        }
      }
      expect(start).toBeGreaterThanOrEqual(0);
      const queue = [start];
      seen[start] = 1;
      let reached = 0;
      while (queue.length > 0) {
        const cell = queue.pop() as number;
        reached++;
        const z = cell % SHAPE_SIZE;
        const y = Math.floor(cell / SHAPE_SIZE) % SHAPE_SIZE;
        const x = Math.floor(cell / (SHAPE_SIZE * SHAPE_SIZE));
        for (const [nx, ny, nz] of [
          [x - 1, y, z],
          [x + 1, y, z],
          [x, y - 1, z],
          [x, y + 1, z],
          [x, y, z - 1],
          [x, y, z + 1],
        ]) {
          if (nx < 0 || ny < 0 || nz < 0) continue;
          if (nx >= SHAPE_SIZE || ny >= SHAPE_SIZE || nz >= SHAPE_SIZE) continue;
          const index = cellIndex(nx, ny, nz);
          if (seen[index] || voxels[index] === 0) continue;
          seen[index] = 1;
          queue.push(index);
        }
      }
      expect(reached).toBe(stats.cubes);
    }
  });

  it('stays inside the editing space, and around the middle of it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const voxels = randomShape(seed);
      let sum = 0;
      let count = 0;
      for (let x = 0; x < SHAPE_SIZE; x++) {
        for (let y = 0; y < SHAPE_SIZE; y++) {
          for (let z = 0; z < SHAPE_SIZE; z++) {
            if (voxels[cellIndex(x, y, z)] === 0) continue;
            sum += Math.abs(x - SHAPE_CENTRE);
            count++;
          }
        }
      }
      expect(count).toBeGreaterThan(0);
      expect(sum / count).toBeLessThan(SHAPE_CENTRE);
    }
  });

  it('can be got down the gentler courses whatever shape it comes out', () => {
    // The hardest course asks the ball to jump gaps, and the most chaotic
    // shapes genuinely cannot build the speed for that. The first two must
    // stay winnable with anything, though, or the button is a trap.
    for (let seed = 1; seed <= 12; seed++) {
      const stats = measureShape(randomShape(seed));
      for (const stage of STAGES.slice(0, 2)) {
        const world = new World({
          course: courseFor(stage),
          seed: stage.seed,
          ball: stats,
          breeze: stage.breeze,
          countdownSeconds: 0,
        });
        const result = runWithAutopilot(world, 200);
        expect(result.state).toBe(RunState.Finished);
      }
    }
  });

  it('is slower going than a properly round ball', () => {
    const stage = STAGES[0];
    const runFor = (voxels: Uint8Array): number => {
      const world = new World({
        course: courseFor(stage),
        seed: stage.seed,
        ball: measureShape(voxels),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      return runWithAutopilot(world, 200).seconds;
    };
    const round = runFor(defaultShape());
    for (const seed of [2, 3, 7, 9]) {
      expect(runFor(randomShape(seed))).toBeGreaterThan(round);
    }
  });

  it('costs a boxy ball most of the run again', () => {
    // The shape you build is meant to be the biggest decision you make, not
    // a detail. A box down the gentlest course takes getting on for twice
    // what a proper ball takes; if that ever shrinks back to a few seconds,
    // building a ball has stopped mattering.
    const stage = STAGES[0];
    const runFor = (voxels: Uint8Array): number => {
      const world = new World({
        course: courseFor(stage),
        seed: stage.seed,
        ball: measureShape(voxels),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      return runWithAutopilot(world, 240).seconds;
    };
    const round = runFor(defaultShape());
    const boxy = runFor(cubeShape());
    const pebble = runFor(pebbleShape());

    expect(boxy).toBeGreaterThan(round * 1.8);
    // A small round ball is still a round ball: nearly as quick.
    expect(pebble).toBeLessThan(round * 1.35);
  });
});

describe('the rules stay repeatable with bumps in play', () => {
  it('gives the same run twice for a bumpy ball', () => {
    const a = runOn(lumpyShape(), 9, 10);
    const b = runOn(lumpyShape(), 9, 10);
    expect(b.checksum()).toBe(a.checksum());
    expect(b.bumpPhase[0]).toBe(a.bumpPhase[0]);
  });

  it('notices a bumpy ball drifting out of step', () => {
    const world = runOn(lumpyShape(), 9, 6);
    const before = world.checksum();
    world.bumpPhase[0] += 1;
    expect(world.checksum()).not.toBe(before);
  });

  it('produces only whole numbers', () => {
    const world = runOn(lumpyShape(), 9, 6);
    expect(Number.isInteger(world.bumpPhase[0])).toBe(true);
    expect(Number.isInteger(world.velocityY[0])).toBe(true);
  });
});

describe('a shape that will not roll straight', () => {
  /** How far the ball wanders sideways down a wide, straight slope. */
  function driftOf(voxels: Uint8Array): number {
    // Wide and straight, with no steering at all: anything sideways that
    // happens is the ball's own doing and nothing else's.
    const world = new World({
      course: buildCourse([{ length: 90, drop: 6, width: 24 }], 0),
      seed: 1,
      ball: measureShape(voxels),
      countdownSeconds: 0,
    });
    const straight = packControls({ steer: 0, push: 0, buttons: 0 });
    let drift = 0;
    for (let i = 0; i < 120 * 40 && world.state[0] === RunState.Rolling; i++) {
      world.advance([straight]);
      drift = Math.max(drift, Math.abs(toNumber(world.sideways[0])));
    }
    return drift;
  }

  it('sends a round ball exactly where it is pointed', () => {
    // The one that must not wander. If a properly built ball drifts, the
    // game is fighting the player rather than the shape they chose.
    expect(driftOf(defaultShape())).toBeLessThan(0.05);
    expect(driftOf(pebbleShape())).toBeLessThan(0.3);
  });

  it('will not let a boxy ball hold a line', () => {
    expect(driftOf(cubeShape())).toBeGreaterThan(0.8);
  });

  it('wanders whenever the shape says it should, and only then', () => {
    // Naming seeds would be wrong: the generator can sand a ball round on
    // purpose, and a round ball is meant to go straight whatever seed made
    // it. What must hold is that the wandering follows the shape.
    let wandering = 0;
    for (let seed = 1; seed <= 18; seed++) {
      const shape = randomShape(seed);
      const veer = toNumber(ballFeelFrom(measureShape(shape)).veer);
      const drift = driftOf(shape);
      if (veer > 0.3) {
        expect(drift).toBeGreaterThan(0.3);
        wandering++;
      }
      if (veer < 0.02) expect(drift).toBeLessThan(0.3);
    }
    // And wandering is an ordinary outcome rather than a rare one: getting
    // on for half of them do it. Not most — the generator can sand a ball
    // round on purpose, and those are meant to go straight.
    expect(wandering).toBeGreaterThan(5);
  });

  it('wanders further the more lopsided the ball is', () => {
    // Weight sitting off the middle is the strongest reason of the lot, so
    // the ball with most of it should wander most. The two are picked by
    // measuring rather than by naming seeds: the generator is free to
    // change what any given seed makes, and this must hold regardless.
    let worst = { lopsided: -1, shape: randomShape(1) };
    let best = { lopsided: Number.POSITIVE_INFINITY, shape: randomShape(1) };
    for (let seed = 1; seed <= 40; seed++) {
      const shape = randomShape(seed);
      const lopsided = toNumber(measureShape(shape).lopsided);
      if (lopsided > worst.lopsided) worst = { lopsided, shape };
      if (lopsided < best.lopsided) best = { lopsided, shape };
    }
    expect(worst.lopsided).toBeGreaterThan(best.lopsided);
    expect(driftOf(worst.shape)).toBeGreaterThan(driftOf(best.shape));
  });

  it('measures a ball built evenly as not lopsided at all', () => {
    for (const shape of [defaultShape(), pebbleShape(), cubeShape()]) {
      expect(measureShape(shape).lopsided).toBe(0);
    }
  });

  it('wanders the same way every time', () => {
    // A pull that cannot be learnt is just noise. The same ball on the same
    // slope must wander exactly the same way, or none of it is fair.
    expect(driftOf(randomShape(17))).toBe(driftOf(randomShape(17)));
  });
});

describe('a ball that does not run smoothly', () => {
  /** How unevenly the ball runs down a straight slope, against its speed. */
  function unevenness(voxels: Uint8Array): number {
    const world = new World({
      course: buildCourse([{ length: 90, drop: 6, width: 24 }], 0),
      seed: 1,
      ball: measureShape(voxels),
      countdownSeconds: 0,
    });
    const straight = packControls({ steer: 0, push: 0, buttons: 0 });
    const speeds: number[] = [];
    for (let i = 0; i < 120 * 40 && world.state[0] === RunState.Rolling; i++) {
      world.advance([straight]);
      if (i > 240) speeds.push(toNumber(world.speedFor(0)));
    }
    // Peak to trough over each half second, against the average.
    const span = 60;
    let total = 0;
    let windows = 0;
    for (let i = 0; i + span < speeds.length; i += span) {
      let low = Infinity;
      let high = 0;
      let sum = 0;
      for (let j = i; j < i + span; j++) {
        low = Math.min(low, speeds[j]);
        high = Math.max(high, speeds[j]);
        sum += speeds[j];
      }
      const mean = sum / span;
      if (mean > 1) {
        total += (high - low) / mean;
        windows++;
      }
    }
    return windows > 0 ? total / windows : 0;
  }

  it('measures an evenly built ball as turning the same way round whichever way', () => {
    // Turning a sphere, a cube or a small round ball about any line through
    // the middle is the same job, so there is nothing here to be uneven.
    for (const shape of [defaultShape(), cubeShape(), pebbleShape()]) {
      expect(measureShape(shape).spinSpread).toBe(0);
    }
  });

  it('finds shapes that are far easier to turn one way than another', () => {
    // Weight gathered along one line — a roller, a slab, a ring — should
    // come out plainly uneven, or the measure is not doing its job.
    let most = 0;
    for (let seed = 1; seed <= 60; seed++) {
      most = Math.max(most, toNumber(measureShape(randomShape(seed)).spinSpread));
    }
    expect(most).toBeGreaterThan(0.5);
  });

  it('makes an unevenly turning ball run in surges', () => {
    // The point of measuring it: it has to be felt. A ball that is much
    // easier to turn one way runs visibly less smoothly than a round one.
    const round = unevenness(defaultShape());
    let worst = 0;
    let worstShape = defaultShape();
    for (let seed = 1; seed <= 60; seed++) {
      const shape = randomShape(seed);
      const spread = toNumber(measureShape(shape).spinSpread);
      if (spread > worst) {
        worst = spread;
        worstShape = shape;
      }
    }
    expect(worst).toBeGreaterThan(0.5);
    expect(unevenness(worstShape)).toBeGreaterThan(round * 3);
  });

  it('gives back over a turn what it takes, rather than merely slowing', () => {
    // An uneven ball is meant to run unevenly, not to run slowly: the drag
    // already covers slow. Down a straight slope it should still get going.
    let worst = 0;
    let worstShape = defaultShape();
    for (let seed = 1; seed <= 60; seed++) {
      const shape = randomShape(seed);
      const spread = toNumber(measureShape(shape).spinSpread);
      if (spread > worst) {
        worst = spread;
        worstShape = shape;
      }
    }
    const world = new World({
      course: buildCourse([{ length: 90, drop: 8, width: 24 }], 0),
      seed: 1,
      ball: measureShape(worstShape),
      countdownSeconds: 0,
    });
    for (let i = 0; i < 120 * 12; i++) {
      world.advance([packControls({ steer: 0, push: 0, buttons: 0 })]);
    }
    expect(toNumber(world.travelled[0])).toBeGreaterThan(20);
  });
});

describe('putting a weight inside the ball', () => {
  it('leaves a ball with nothing in it exactly as it was', () => {
    const plain = measureShape(defaultShape());
    const middle = measureShape(defaultShape(), { sideways: 0, up: 0 });
    expect(middle.lopsided).toBe(plain.lopsided);
    expect(middle.lopsided).toBe(0);
  });

  it('unbalances the ball by however far out the weight is put', () => {
    // The whole of the control has to do something: halfway out should be
    // about halfway to as bad as it gets, not already at the limit.
    const at = (sideways: number): number =>
      toNumber(ballFeelFrom(measureShape(defaultShape(), { sideways, up: 0 })).veer);
    expect(at(0)).toBe(0);
    expect(at(0.5)).toBeGreaterThan(0.35);
    expect(at(0.5)).toBeLessThan(0.65);
    expect(at(1)).toBeGreaterThan(0.9);
  });

  it('counts a weight up as much as a weight to the side', () => {
    // Which way it is put decides which way the ball is thrown; how far out
    // it is put decides how hard. The ball is turning over as it goes, so
    // nothing about it stays pointing the same way for long.
    const side = measureShape(defaultShape(), { sideways: 1, up: 0 }).lopsided;
    const up = measureShape(defaultShape(), { sideways: 0, up: 1 }).lopsided;
    expect(up).toBe(side);
  });

  it('makes a properly round ball wander once a weight is in it', () => {
    // This is the point of the control: a round ball is the one that goes
    // where it is sent, and putting a weight in it takes that away.
    const drift = (weightAt: { sideways: number; up: number }): number => {
      const world = new World({
        course: buildCourse([{ length: 90, drop: 6, width: 24 }], 0),
        seed: 1,
        ball: measureShape(defaultShape(), weightAt),
        countdownSeconds: 0,
      });
      let most = 0;
      for (let i = 0; i < 120 * 40 && world.state[0] === RunState.Rolling; i++) {
        world.advance([packControls({ steer: 0, push: 0, buttons: 0 })]);
        most = Math.max(most, Math.abs(toNumber(world.sideways[0])));
      }
      return most;
    };
    expect(drift({ sideways: 0, up: 0 })).toBeLessThan(0.05);
    expect(drift({ sideways: 1, up: 0 })).toBeGreaterThan(1);
  });

  it('ignores a weight position that is not one', () => {
    // Saved balls get hand-edited and come from older versions.
    expect(readWeightAt(undefined)).toEqual({ sideways: 0, up: 0 });
    expect(readWeightAt('over there')).toEqual({ sideways: 0, up: 0 });
    expect(readWeightAt({ sideways: Number.NaN, up: 4 })).toEqual({ sideways: 0, up: 1 });
    expect(readWeightAt({ sideways: -9, up: -0.5 })).toEqual({ sideways: -1, up: -0.5 });
  });
});
