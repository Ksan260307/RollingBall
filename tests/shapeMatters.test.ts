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
