/**
 * The shape of a course.
 *
 * A course is written down as a short list of pieces ("30 metres, bending
 * right, 6 metres wide, with walls"). Building it turns that list into a
 * chain of evenly spaced points, each carrying its own set of directions:
 * which way is forward, which way is sideways, and which way is up out of
 * the floor. Physics then only ever has to look at the two points nearest
 * the ball, no matter how long the course is.
 *
 * Everything is built with whole-number arithmetic, so the same list of
 * pieces produces exactly the same course on every device.
 */

import { ONE, cosine, degrees, div, length3, mul, sine } from './fixed';

/** Distance between neighbouring points of the chain, in metres. */
export const POINT_SPACING = 2;

/** What the floor is made of, which changes how the ball behaves on it. */
export const Surface = {
  Normal: 0,
  Slick: 1,
  Rough: 2,
  Boost: 3,
} as const;

export type SurfaceValue = (typeof Surface)[keyof typeof Surface];

/** Extra properties a point of the chain can carry. */
export const PointFlag = {
  Walls: 1 << 0,
  /** A break in the floor: the ball has to fly over it. */
  Gap: 1 << 1,
  /** Marks the finish area. */
  Finish: 1 << 2,
} as const;

/** One stretch of course, written in everyday units. */
export interface CoursePiece {
  /** Length in metres. */
  length: number;
  /** How far it bends over the whole stretch, in degrees. Positive is right. */
  turn?: number;
  /** How steeply it heads downhill, in degrees. */
  drop?: number;
  /** Full width of the floor in metres. */
  width?: number;
  /** Sideways tilt in degrees. Positive raises the right-hand edge. */
  bank?: number;
  /** What the floor is made of. */
  surface?: SurfaceValue;
  /** Whether the stretch has walls that keep the ball on. */
  walls?: boolean;
  /** Whether the floor is missing here. */
  gap?: boolean;
}

/**
 * A finished course: parallel arrays, one entry per point of the chain.
 * Parallel arrays rather than a list of objects because the physics reads
 * the same few fields over and over, and this keeps them close together in
 * memory.
 */
export interface Course {
  readonly count: number;
  /** Where the point is. */
  readonly x: Int32Array;
  readonly y: Int32Array;
  readonly z: Int32Array;
  /** Which way is forward from this point (a unit direction). */
  readonly forwardX: Int32Array;
  readonly forwardY: Int32Array;
  readonly forwardZ: Int32Array;
  /** Which way is right, already tilted by the bank. */
  readonly rightX: Int32Array;
  readonly rightY: Int32Array;
  readonly rightZ: Int32Array;
  /** Which way is up out of the floor, already tilted by the bank. */
  readonly upX: Int32Array;
  readonly upY: Int32Array;
  readonly upZ: Int32Array;
  /** Distance to the next point. */
  readonly spanLength: Int32Array;
  /** Half of the floor width at this point. */
  readonly halfWidth: Int32Array;
  /** Distance from the start line to this point. */
  readonly distance: Int32Array;
  /** What the floor is made of here. */
  readonly surface: Uint8Array;
  /** The extra properties listed in PointFlag. */
  readonly flags: Uint8Array;
  /** Total length of the course. */
  readonly totalLength: number;
  /** Where the ball is placed at the start. */
  readonly startX: number;
  readonly startY: number;
  readonly startZ: number;
  /** Height drop from the start line to the finish, for the course preview. */
  readonly descent: number;
}

/** Rounds a value in metres into the stored whole-number form. */
function metres(value: number): number {
  return Math.round(value * ONE);
}

/**
 * Turns a list of pieces into a course.
 *
 * @param pieces the stretches, in order from start to finish
 * @param startHeight how high above the ground the start line sits, in metres
 */
export function buildCourse(pieces: CoursePiece[], startHeight = 0): Course {
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const headings: number[] = [];
  const banks: number[] = [];
  const halfWidths: number[] = [];
  const surfaces: number[] = [];
  const flagList: number[] = [];

  let x = 0;
  let y = metres(startHeight);
  let z = 0;
  let heading = 0;
  let previousWidth = pieces.length > 0 ? (pieces[0].width ?? 8) : 8;
  let previousBank = pieces.length > 0 ? (pieces[0].bank ?? 0) : 0;

  const push = (
    width: number,
    bank: number,
    surface: number,
    flags: number,
  ): void => {
    px.push(x);
    py.push(y);
    pz.push(z);
    headings.push(heading);
    banks.push(degrees(bank));
    halfWidths.push(metres(width / 2));
    surfaces.push(surface);
    flagList.push(flags);
  };

  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p];
    const steps = Math.max(1, Math.round(piece.length / POINT_SPACING));
    const width = piece.width ?? previousWidth;
    const bank = piece.bank ?? 0;
    const drop = degrees(piece.drop ?? 0);
    const turnPerStep = degrees((piece.turn ?? 0) / steps);
    const surface = piece.surface ?? Surface.Normal;
    let flags = 0;
    if (piece.walls) flags |= PointFlag.Walls;
    if (piece.gap) flags |= PointFlag.Gap;

    for (let s = 0; s < steps; s++) {
      // Width and bank ease from the previous stretch into this one over the
      // first few points, so the ribbon never changes shape abruptly.
      const blendSteps = Math.min(steps, 4);
      const blend = s < blendSteps ? (s + 1) / (blendSteps + 1) : 1;
      const easedWidth = previousWidth + (width - previousWidth) * blend;
      const easedBank = previousBank + (bank - previousBank) * blend;
      push(easedWidth, easedBank, surface, flags);

      heading = (heading + turnPerStep) & 0xffff;
      const forwardFlat = cosine(drop);
      const dx = mul(sine(heading), forwardFlat);
      const dy = -sine(drop);
      const dz = mul(cosine(heading), forwardFlat);
      const span = metres(POINT_SPACING);
      x += mul(dx, span);
      y += mul(dy, span);
      z += mul(dz, span);
    }
    previousWidth = width;
    previousBank = bank;
  }

  // One last point so the final stretch has somewhere to lead to.
  push(previousWidth, previousBank, Surface.Normal, PointFlag.Finish);
  const finishIndex = px.length - 1;
  // The last few points count as the finish area, so the ball can trip the
  // line without having to reach the very last centimetre.
  for (let i = Math.max(0, finishIndex - 2); i <= finishIndex; i++) {
    flagList[i] |= PointFlag.Finish;
  }

  const count = px.length;
  const course = {
    count,
    x: Int32Array.from(px),
    y: Int32Array.from(py),
    z: Int32Array.from(pz),
    forwardX: new Int32Array(count),
    forwardY: new Int32Array(count),
    forwardZ: new Int32Array(count),
    rightX: new Int32Array(count),
    rightY: new Int32Array(count),
    rightZ: new Int32Array(count),
    upX: new Int32Array(count),
    upY: new Int32Array(count),
    upZ: new Int32Array(count),
    spanLength: new Int32Array(count),
    halfWidth: Int32Array.from(halfWidths),
    distance: new Int32Array(count),
    surface: Uint8Array.from(surfaces),
    flags: Uint8Array.from(flagList),
    totalLength: 0,
    startX: px[0],
    startY: py[0],
    startZ: pz[0],
    descent: py[0] - py[count - 1],
  };

  let travelled = 0;
  for (let i = 0; i < count; i++) {
    const next = Math.min(i + 1, count - 1);
    let dx = course.x[next] - course.x[i];
    let dy = course.y[next] - course.y[i];
    let dz = course.z[next] - course.z[i];
    if (i === count - 1) {
      // The final point simply keeps the direction of the one before it.
      dx = course.forwardX[i - 1] ?? 0;
      dy = course.forwardY[i - 1] ?? 0;
      dz = course.forwardZ[i - 1] ?? ONE;
    }
    const span = length3(dx, dy, dz);
    course.spanLength[i] = i === count - 1 ? 0 : span;
    const fx = span > 0 ? div(dx, span) : 0;
    const fy = span > 0 ? div(dy, span) : 0;
    const fz = span > 0 ? div(dz, span) : ONE;
    course.forwardX[i] = fx;
    course.forwardY[i] = fy;
    course.forwardZ[i] = fz;

    // Right, before tilting: level with the ground, square to the forward
    // direction seen from above.
    const flat = length3(fx, 0, fz);
    const hx = flat > 0 ? div(fx, flat) : 0;
    const hz = flat > 0 ? div(fz, flat) : ONE;
    const baseRightX = -hz;
    const baseRightZ = hx;

    // Up, before tilting: right turned into forward (a cross product).
    const rawUpX = -mul(baseRightZ, fy);
    const rawUpY = mul(baseRightZ, fx) - mul(baseRightX, fz);
    const rawUpZ = mul(baseRightX, fy);
    const upLength = length3(rawUpX, rawUpY, rawUpZ);
    const ux = upLength > 0 ? div(rawUpX, upLength) : 0;
    const uy = upLength > 0 ? div(rawUpY, upLength) : ONE;
    const uz = upLength > 0 ? div(rawUpZ, upLength) : 0;

    // Now tilt both directions around the forward axis by the bank angle.
    const bank = banks[i];
    const cb = cosine(bank);
    const sb = sine(bank);
    course.rightX[i] = mul(baseRightX, cb) + mul(ux, sb);
    course.rightY[i] = mul(uy, sb);
    course.rightZ[i] = mul(baseRightZ, cb) + mul(uz, sb);
    course.upX[i] = mul(ux, cb) - mul(baseRightX, sb);
    course.upY[i] = mul(uy, cb);
    course.upZ[i] = mul(uz, cb) - mul(baseRightZ, sb);

    course.distance[i] = travelled;
    travelled += course.spanLength[i];
  }
  course.totalLength = travelled;
  return course;
}

/** Where the ball sits in relation to the course. */
export interface Placement {
  /** Which point of the chain the ball is beside. */
  point: number;
  /** How far past that point it is. */
  ahead: number;
  /** How far to the right of the middle it is; negative means left. */
  sideways: number;
  /** How far above the floor it is. */
  height: number;
  /** Half the floor width right there. */
  halfWidth: number;
  /** Distance from the start line. */
  travelled: number;
  /** What the floor is made of there. */
  surface: number;
  /** The extra properties of that stretch. */
  flags: number;
}

const placement: Placement = {
  point: 0,
  ahead: 0,
  sideways: 0,
  height: 0,
  halfWidth: 0,
  travelled: 0,
  surface: 0,
  flags: 0,
};

/**
 * Works out where the ball is in relation to the course.
 *
 * The search starts from `hint`, the answer from the previous step, and only
 * looks at nearby points. That keeps the cost the same whether the course is
 * a hundred metres or a hundred kilometres long.
 *
 * The returned object is reused between calls, so copy anything you need to
 * keep.
 */
export function placeOnCourse(
  course: Course,
  x: number,
  y: number,
  z: number,
  hint: number,
): Placement {
  const first = Math.max(0, hint - 6);
  const last = Math.min(course.count - 1, hint + 12);
  let best = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = first; i <= last; i++) {
    const dx = (x - course.x[i]) / ONE;
    const dy = (y - course.y[i]) / ONE;
    const dz = (z - course.z[i]) / ONE;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }

  let point = best;
  let ahead = alongAt(course, point, x, y, z);
  if (ahead < 0 && point > 0) {
    point -= 1;
    ahead = alongAt(course, point, x, y, z);
  } else if (ahead > course.spanLength[point] && point < course.count - 1) {
    point += 1;
    ahead = alongAt(course, point, x, y, z);
  }

  const rx = x - course.x[point];
  const ry = y - course.y[point];
  const rz = z - course.z[point];
  placement.point = point;
  placement.ahead = ahead;
  placement.sideways =
    mul(rx, course.rightX[point]) + mul(ry, course.rightY[point]) + mul(rz, course.rightZ[point]);
  placement.height =
    mul(rx, course.upX[point]) + mul(ry, course.upY[point]) + mul(rz, course.upZ[point]);
  placement.halfWidth = course.halfWidth[point];
  placement.travelled = course.distance[point] + ahead;
  placement.surface = course.surface[point];
  placement.flags = course.flags[point];
  return placement;
}

function alongAt(course: Course, i: number, x: number, y: number, z: number): number {
  const rx = x - course.x[i];
  const ry = y - course.y[i];
  const rz = z - course.z[i];
  return mul(rx, course.forwardX[i]) + mul(ry, course.forwardY[i]) + mul(rz, course.forwardZ[i]);
}

/** The point of the chain nearest a given distance from the start. */
export function pointAtDistance(course: Course, travelled: number): number {
  let low = 0;
  let high = course.count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (course.distance[middle] <= travelled) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** A position on the floor, given a distance along and an offset sideways. */
export function positionOnCourse(
  course: Course,
  travelled: number,
  sideways: number,
): { x: number; y: number; z: number } {
  const i = pointAtDistance(course, travelled);
  const ahead = travelled - course.distance[i];
  return {
    x: course.x[i] + mul(course.forwardX[i], ahead) + mul(course.rightX[i], sideways),
    y: course.y[i] + mul(course.forwardY[i], ahead) + mul(course.rightY[i], sideways),
    z: course.z[i] + mul(course.forwardZ[i], ahead) + mul(course.rightZ[i], sideways),
  };
}
