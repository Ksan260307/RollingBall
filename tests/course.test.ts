import { describe, expect, it } from 'vitest';
import {
  Junction,
  PointFlag,
  Surface,
  buildCourse,
  placeOnCourse,
  pointAtDistance,
  positionOnCourse,
} from '../src/core/course';
import { ONE, mul, toNumber } from '../src/core/fixed';

const flat = buildCourse([{ length: 20, width: 8 }]);
const sloped = buildCourse([{ length: 40, drop: 10, width: 6, walls: true }]);

describe('building a course', () => {
  it('comes out about as long as it was asked to be', () => {
    expect(toNumber(flat.totalLength)).toBeGreaterThan(18);
    expect(toNumber(flat.totalLength)).toBeLessThan(23);
  });

  it('goes downhill when told to', () => {
    expect(sloped.descent).toBeGreaterThan(0);
    // Forty metres at ten degrees drops about seven.
    expect(toNumber(sloped.descent)).toBeGreaterThan(5);
    expect(toNumber(sloped.descent)).toBeLessThan(9);
  });

  it('heads away from the start, into the distance', () => {
    expect(flat.z[flat.count - 1]).toBeGreaterThan(flat.z[0]);
  });

  it('keeps its three directions square to each other', () => {
    for (let i = 0; i < sloped.count; i++) {
      const forwardDotRight =
        mul(sloped.forwardX[i], sloped.rightX[i]) +
        mul(sloped.forwardY[i], sloped.rightY[i]) +
        mul(sloped.forwardZ[i], sloped.rightZ[i]);
      const forwardDotUp =
        mul(sloped.forwardX[i], sloped.upX[i]) +
        mul(sloped.forwardY[i], sloped.upY[i]) +
        mul(sloped.forwardZ[i], sloped.upZ[i]);
      expect(Math.abs(toNumber(forwardDotRight))).toBeLessThan(0.02);
      expect(Math.abs(toNumber(forwardDotUp))).toBeLessThan(0.02);
    }
  });

  it('keeps its directions the length of one', () => {
    for (let i = 0; i < sloped.count - 1; i++) {
      const length =
        toNumber(sloped.forwardX[i]) ** 2 +
        toNumber(sloped.forwardY[i]) ** 2 +
        toNumber(sloped.forwardZ[i]) ** 2;
      expect(Math.sqrt(length)).toBeCloseTo(1, 2);
    }
  });

  it('points up out of the floor, never down into it', () => {
    for (let i = 0; i < sloped.count; i++) {
      expect(sloped.upY[i]).toBeGreaterThan(0);
    }
  });

  it('bends the way it was asked to', () => {
    const right = buildCourse([{ length: 30, turn: 90, width: 6 }]);
    const last = right.count - 1;
    // A right turn of a quarter circle should end up heading along +x.
    expect(toNumber(right.forwardX[last])).toBeGreaterThan(0.9);
  });

  it('marks the walls, the gaps and the finish', () => {
    const mixed = buildCourse([
      { length: 10, width: 6, walls: true },
      { length: 4, width: 6, gap: true },
      { length: 10, width: 6 },
    ]);
    let walls = 0;
    let gaps = 0;
    let finish = 0;
    for (let i = 0; i < mixed.count; i++) {
      if (mixed.flags[i] & PointFlag.Walls) walls++;
      if (mixed.flags[i] & PointFlag.Gap) gaps++;
      if (mixed.flags[i] & PointFlag.Finish) finish++;
    }
    expect(walls).toBe(5);
    expect(gaps).toBe(2);
    expect(finish).toBeGreaterThanOrEqual(1);
  });

  it('remembers what each stretch of floor is made of', () => {
    const mixed = buildCourse([
      { length: 6, width: 6 },
      { length: 6, width: 6, surface: Surface.Slick },
    ]);
    expect(mixed.surface[0]).toBe(Surface.Normal);
    expect(mixed.surface[4]).toBe(Surface.Slick);
  });

  it('eases the width from one stretch into the next', () => {
    const narrowing = buildCourse([
      { length: 12, width: 10 },
      { length: 12, width: 4 },
    ]);
    const widths = [...narrowing.halfWidth].map(toNumber);
    // No single step should slam the floor width down.
    for (let i = 1; i < widths.length; i++) {
      expect(Math.abs(widths[i] - widths[i - 1])).toBeLessThan(1.6);
    }
    expect(widths[widths.length - 1]).toBeCloseTo(2, 1);
  });

  it('always produces a course, even from nothing', () => {
    const empty = buildCourse([]);
    expect(empty.count).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(empty.totalLength)).toBe(true);
  });
});

describe('finding the ball on the course', () => {
  it('puts a ball on the middle line at no offset', () => {
    const where = placeOnCourse(flat, flat.x[3], flat.y[3], flat.z[3], 0);
    expect(Math.abs(toNumber(where.sideways))).toBeLessThan(0.02);
    expect(Math.abs(toNumber(where.height))).toBeLessThan(0.02);
  });

  it('measures how far to the side the ball has drifted', () => {
    const i = 4;
    const offset = Math.round(2.5 * ONE);
    const x = flat.x[i] + mul(flat.rightX[i], offset);
    const y = flat.y[i] + mul(flat.rightY[i], offset);
    const z = flat.z[i] + mul(flat.rightZ[i], offset);
    const where = placeOnCourse(flat, x, y, z, i);
    expect(toNumber(where.sideways)).toBeCloseTo(2.5, 1);
  });

  it('measures how high above the floor the ball is', () => {
    const i = 4;
    const lift = Math.round(1.5 * ONE);
    const where = placeOnCourse(
      flat,
      flat.x[i] + mul(flat.upX[i], lift),
      flat.y[i] + mul(flat.upY[i], lift),
      flat.z[i] + mul(flat.upZ[i], lift),
      i,
    );
    expect(toNumber(where.height)).toBeCloseTo(1.5, 1);
  });

  it('reports distance travelled that grows along the course', () => {
    let last = -1;
    for (let i = 0; i < flat.count; i++) {
      const where = placeOnCourse(flat, flat.x[i], flat.y[i], flat.z[i], i);
      expect(where.travelled).toBeGreaterThan(last);
      last = where.travelled;
    }
  });

  it('finds the right spot even when the hint is stale', () => {
    const i = 7;
    const fresh = placeOnCourse(flat, flat.x[i], flat.y[i], flat.z[i], i);
    const point = fresh.point;
    const stale = placeOnCourse(flat, flat.x[i], flat.y[i], flat.z[i], Math.max(0, i - 5));
    expect(stale.point).toBe(point);
  });

  it('looks up the point nearest a distance', () => {
    expect(pointAtDistance(flat, 0)).toBe(0);
    const middle = pointAtDistance(flat, flat.totalLength / 2);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(flat.count - 1);
  });

  it('turns a distance and an offset back into a place', () => {
    const spot = positionOnCourse(flat, Math.round(6 * ONE), Math.round(1 * ONE));
    const back = placeOnCourse(flat, spot.x, spot.y, spot.z, 0);
    expect(toNumber(back.travelled)).toBeCloseTo(6, 0);
    expect(toNumber(back.sideways)).toBeCloseTo(1, 1);
  });
});

/**
 * The pieces that make a road divide, and make it come back together.
 *
 * A junction is written down as a piece like any other, saying which side
 * the other road is on. Everything downstream — what gets a wall built
 * along it, what the ball can bounce off — reads that one fact.
 */
describe('where one road becomes two', () => {
  it('leaves the wall off on the side the other road is on', () => {
    const split = buildCourse([
      { length: 20, drop: 6, width: 10, walls: true },
      { length: 20, drop: 6, width: 10, walls: true, junction: Junction.SplitLeft },
      { length: 20, drop: 6, width: 10, walls: true },
    ]);
    let opened = 0;
    let plain = 0;
    // The very last point of a chain sits past the end of the last piece
    // and carries nothing, so it is left out of this.
    for (let i = 0; i < split.count - 1; i++) {
      // Walls are still asked for everywhere: a junction opens one edge, it
      // does not turn the railings off.
      expect(split.flags[i] & PointFlag.Walls).not.toBe(0);
      expect(split.flags[i] & PointFlag.OpenRight).toBe(0);
      if ((split.flags[i] & PointFlag.OpenLeft) !== 0) opened++;
      else plain++;
    }
    expect(opened).toBeGreaterThan(5);
    expect(plain).toBeGreaterThan(opened);
  });

  it('opens the other edge for a junction the other way round', () => {
    const split = buildCourse([
      { length: 20, drop: 6, width: 10, walls: true, junction: Junction.JoinRight },
    ]);
    let opened = 0;
    for (let i = 0; i < split.count; i++) {
      expect(split.flags[i] & PointFlag.OpenLeft).toBe(0);
      if ((split.flags[i] & PointFlag.OpenRight) !== 0) opened++;
    }
    expect(opened).toBeGreaterThan(5);
  });

  it('leaves an ordinary piece walled on both sides', () => {
    for (let i = 0; i < sloped.count; i++) {
      expect(sloped.flags[i] & PointFlag.OpenLeft).toBe(0);
      expect(sloped.flags[i] & PointFlag.OpenRight).toBe(0);
    }
  });
});

/**
 * Railings asked for one edge at a time.
 *
 * The two edges of a stretch do not always want the same thing. The outside
 * of a bend is what holds the ball on and has to be there; the edge a
 * second road joins along has to not be, or the fork is fenced off.
 */
describe('railings on one edge at a time', () => {
  const edges = (piece: Parameters<typeof buildCourse>[0][number]) => {
    const course = buildCourse([piece]);
    let left = 0;
    let right = 0;
    for (let i = 0; i < course.count - 1; i++) {
      if ((course.flags[i] & PointFlag.Walls) === 0) continue;
      if ((course.flags[i] & PointFlag.OpenLeft) === 0) left++;
      if ((course.flags[i] & PointFlag.OpenRight) === 0) right++;
    }
    return { left, right };
  };

  it('puts one on each edge when the whole stretch asks for them', () => {
    const both = edges({ length: 20, drop: 6, width: 8, walls: true });
    expect(both.left).toBeGreaterThan(5);
    expect(both.right).toBe(both.left);
  });

  it('puts one on the left alone when only the left asks', () => {
    const left = edges({ length: 20, drop: 6, width: 8, wallLeft: true });
    expect(left.left).toBeGreaterThan(5);
    expect(left.right).toBe(0);
  });

  it('puts one on the right alone when only the right asks', () => {
    const right = edges({ length: 20, drop: 6, width: 8, wallRight: true });
    expect(right.right).toBeGreaterThan(5);
    expect(right.left).toBe(0);
  });

  it('lets one edge overrule what the whole stretch said', () => {
    const held = edges({ length: 20, drop: 6, width: 8, walls: true, wallLeft: false });
    expect(held.left).toBe(0);
    expect(held.right).toBeGreaterThan(5);
  });
});
