import { describe, expect, it } from 'vitest';
import { ONE, abs, toNumber } from '../src/core/fixed';
import { Course, PointFlag, placeOnCourse } from '../src/core/course';
import { cubeShape, defaultShape, measureShape, pebbleShape } from '../src/core/ballShape';
import { RunState, World } from '../src/core/simulation';
import {
  STAGES,
  courseFor,
  courseMetres,
  pieceFromStored,
  stageById,
  wallsMeaning,
} from '../src/game/stages';
import { runWithAutopilot } from './helpers/autopilot';

describe('the set of courses', () => {
  // Courses come out of a file that the course editor writes, so these check
  // what any course has to be, not how many there happen to be today.
  it('offers at least one, each with its own name', () => {
    expect(STAGES.length).toBeGreaterThan(0);
    const ids = new Set(STAGES.map((s) => s.id));
    const names = new Set(STAGES.map((s) => s.name));
    expect(ids.size).toBe(STAGES.length);
    expect(names.size).toBe(STAGES.length);
  });

  it('gives each one a name, colours and a sensible difficulty', () => {
    for (const stage of STAGES) {
      expect(stage.name.length).toBeGreaterThan(0);
      expect(stage.mood.sky).toMatch(/^#[0-9a-f]{6}$/i);
      expect(stage.difficulty).toBeGreaterThanOrEqual(1);
      expect(stage.difficulty).toBeLessThanOrEqual(3);
    }
  });

  it('finds a course by name, and falls back to the first one', () => {
    expect(stageById('valley').id).toBe('valley');
    expect(stageById('nothing-like-this').id).toBe(STAGES[0].id);
  });

  it('builds each course only once and reuses it', () => {
    expect(courseFor(STAGES[0])).toBe(courseFor(STAGES[0]));
  });
});

describe('how each course is laid out', () => {
  for (const stage of STAGES) {
    it(`${stage.name} is a course somebody could actually run`, () => {
      const metres = courseMetres(stage);
      expect(metres).toBeGreaterThan(20);
      expect(metres).toBeLessThan(600);
    });

    it(`${stage.name} runs downhill the whole way`, () => {
      const course = courseFor(stage);
      expect(toNumber(course.descent)).toBeGreaterThan(6);
      for (let i = 1; i < course.count; i++) {
        // Never uphill: the finish is always the lowest point reached so far.
        expect(course.y[i]).toBeLessThanOrEqual(course.y[i - 1]);
      }
    });

    it(`${stage.name} has a floor wide enough to roll on`, () => {
      const course = courseFor(stage);
      for (let i = 0; i < course.count; i++) {
        expect(toNumber(course.halfWidth[i])).toBeGreaterThan(1.4);
      }
    });

    it(`${stage.name} has somewhere to finish`, () => {
      const course = courseFor(stage);
      let finish = 0;
      for (let i = 0; i < course.count; i++) {
        if (course.flags[i] & PointFlag.Finish) finish++;
      }
      expect(finish).toBeGreaterThan(0);
    });
  }

  it('only puts gaps where there is enough run-up to clear them', () => {
    for (const stage of STAGES) {
      const course = courseFor(stage);
      for (let i = 0; i < course.count; i++) {
        if ((course.flags[i] & PointFlag.Gap) === 0) continue;
        // A gap must never be the first thing on a course.
        expect(course.distance[i]).toBeGreaterThan(10 * ONE);
      }
    }
  });
});

/** The point of the chain nearest a spot, searched from end to end. */
function nearestPoint(course: Course, x: number, y: number, z: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < course.count; i++) {
    const dx = (x - course.x[i]) / ONE;
    const dy = (y - course.y[i]) / ONE;
    const dz = (z - course.z[i]) / ONE;
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

describe('the way ahead is kept clear', () => {
  for (const stage of STAGES) {
    it(`${stage.name} has nothing standing on the floor itself`, () => {
      const course = courseFor(stage);
      const world = new World({
        course,
        seed: stage.seed,
        ball: measureShape(defaultShape()),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      expect(world.scenery.count).toBeGreaterThan(0);

      let closest = Number.POSITIVE_INFINITY;
      for (let i = 0; i < world.scenery.count; i++) {
        const x = world.scenery.x[i];
        const y = world.scenery.y[i];
        const z = world.scenery.z[i];
        const where = placeOnCourse(course, x, y, z, nearestPoint(course, x, y, z));
        // How far past the edge of the floor this piece of scenery sits.
        closest = Math.min(closest, abs(where.sideways) - where.halfWidth);
      }
      // Everything stands clear of the floor, with room for the ball beside it.
      expect(toNumber(closest)).toBeGreaterThan(0.5);
    });
  }
});

describe('every course can actually be finished', () => {
  for (const stage of STAGES) {
    it(`${stage.name} can be cleared by a plain, unclever driver`, () => {
      const world = new World({
        course: courseFor(stage),
        seed: stage.seed,
        ball: measureShape(defaultShape()),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      const result = runWithAutopilot(world);
      expect(result.state).toBe(RunState.Finished);
      expect(result.seconds).toBeGreaterThan(8);
      expect(result.seconds).toBeLessThan(60);
    });
  }

  it('can be cleared with a home-made ball too', () => {
    for (const voxels of [pebbleShape(), cubeShape()]) {
      const stage = STAGES[0];
      const world = new World({
        course: courseFor(stage),
        seed: stage.seed,
        ball: measureShape(voxels),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      const result = runWithAutopilot(world);
      expect(result.state).toBe(RunState.Finished);
    }
  });

  it('sets a suggested time that bears some relation to the course', () => {
    for (const stage of STAGES) {
      const world = new World({
        course: courseFor(stage),
        seed: stage.seed,
        ball: measureShape(defaultShape()),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      const coasting = runWithAutopilot(world, 200).seconds;
      // Coasting straight down the middle is the yardstick. A target far
      // outside this range is a slip of the keyboard rather than a design.
      expect(stage.targetSeconds).toBeGreaterThan(coasting * 0.3);
      expect(stage.targetSeconds).toBeLessThan(coasting * 3);
    }
  });

  it('plays out identically on a second attempt', () => {
    for (const stage of STAGES) {
      const runs = [0, 1].map(() => {
        const world = new World({
          course: courseFor(stage),
          seed: stage.seed,
          ball: measureShape(defaultShape()),
          breeze: stage.breeze,
          countdownSeconds: 0,
        });
        return runWithAutopilot(world);
      });
      expect(runs[1].checksum).toBe(runs[0].checksum);
      expect(runs[1].seconds).toBe(runs[0].seconds);
    }
  });
});

describe('railings written down one edge at a time', () => {
  it('reads true, false and the name of a single edge', () => {
    expect(wallsMeaning(true)).toEqual({ left: true, right: true });
    expect(wallsMeaning(false)).toEqual({ left: false, right: false });
    expect(wallsMeaning('left')).toEqual({ left: true, right: false });
    expect(wallsMeaning('right')).toEqual({ left: false, right: true });
    // Nothing written down means no railings, as it always did.
    expect(wallsMeaning(undefined)).toEqual({ left: false, right: false });
  });

  it('carries that through to the built course', () => {
    const piece = pieceFromStored({ length: 20, width: 8, walls: 'right' });
    expect(piece.wallLeft).toBe(false);
    expect(piece.wallRight).toBe(true);
  });
});
