/**
 * The courses.
 *
 * A course is written as a list of stretches in plain units: how long, how
 * much it bends, how steeply it drops, how wide the floor is and what it is
 * made of. Building it turns that into the point chain the physics uses.
 *
 * The stretches themselves live in courses.json rather than in code, because
 * the course editor under tools/ writes that same file. Designing a course
 * and playing it are then the same data, with nothing to copy across by hand.
 * Everything here reads that file defensively: a hand-edited course with a
 * missing field or a silly number still loads, with sensible values filled in.
 */

import { CoursePiece, Surface, SurfaceValue, buildCourse, type Course } from '../core/course';
import { ONE } from '../core/fixed';
import courseData from './courses.json';
import { dailyCourse } from './daily';

export interface Stage {
  /** The other way down, where the course forks. */
  altPieces?: CoursePiece[];
  /** How far along the choice is made, in metres. */
  forkAt?: number;
  /**
   * How far along the other way rejoins, in metres.
   *
   * Measured along the other way, not the main one, because the two are
   * different lengths — that is the whole point of a shortcut. Between the
   * fork and here is the only stretch where the two ways differ; before and
   * after they are the very same floor in the very same place.
   */
  rejoinAt?: number;
  id: string;
  name: string;
  blurb: string;
  /** One to three, shown as filled dots. */
  difficulty: number;
  /** Colour used for the sky and the lighting mood. */
  mood: {
    sky: string;
    horizon: string;
    ground: string;
    floor: string;
    edge: string;
    fog: number;
  };
  /** How breezy it is, from 0 to ONE. */
  breeze: number;
  /** Fixes the scenery layout so every player sees the same course. */
  seed: number;
  /** A good time to aim for, in seconds. */
  targetSeconds: number;
  pieces: CoursePiece[];
}

/** What a course looks like in the file, before anything is filled in. */
/**
 * A second way down, swapped in for part of the main course.
 *
 * Written as "from this stretch to that one, go this way instead", so a
 * fork is a small edit to a course rather than a whole second course to
 * keep in step with the first.
 */
export interface StoredBranch {
  /** The first stretch replaced, counting from zero. */
  from: number;
  /** The first stretch that is not replaced. */
  to: number;
  /** What to go through instead. */
  pieces: StoredPiece[];
}

export interface StoredCourse {
  /** Whether the course appears in the game. Missing counts as yes. */
  inGame?: boolean;
  id: string;
  name: string;
  blurb: string;
  difficulty: number;
  mood: { sky: string; horizon: string; ground: string; floor: string; edge: string; fog: number };
  /** How breezy it is, from 0 to 1. */
  breeze: number;
  seed: number;
  targetSeconds: number;
  pieces: StoredPiece[];
  /** A second way down, where the course offers a choice. */
  branch?: StoredBranch;
}

/** One stretch as it appears in the file. */
export interface StoredPiece {
  length: number;
  turn?: number;
  drop?: number;
  width?: number;
  bank?: number;
  surface?: SurfaceName;
  walls?: boolean;
  gap?: boolean;
  wind?: number;
}

/** Floor materials, named rather than numbered so the file stays readable. */
export type SurfaceName = 'normal' | 'slick' | 'rough' | 'boost';

export const SURFACE_NAMES: SurfaceName[] = ['normal', 'slick', 'rough', 'boost'];

const SURFACE_BY_NAME: Record<SurfaceName, SurfaceValue> = {
  normal: Surface.Normal,
  slick: Surface.Slick,
  rough: Surface.Rough,
  boost: Surface.Boost,
};

/** What a course falls back to when the file leaves something out. */
export const COURSE_DEFAULTS = {
  difficulty: 1,
  breeze: 0,
  targetSeconds: 20,
  mood: {
    sky: '#8fd3ff',
    horizon: '#e8f7ff',
    ground: '#7fc98a',
    floor: '#f2f6e9',
    edge: '#ffd166',
    fog: 190,
  },
  piece: {
    length: 10,
    turn: 0,
    drop: 6,
    width: 8,
    bank: 0,
    surface: 'normal' as SurfaceName,
    walls: false,
    gap: false,
  },
};

function number(value: unknown, fallback: number, low: number, high: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function colour(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

/** Turns one stretch from the file into the form the course builder wants. */
export function pieceFromStored(stored: StoredPiece): CoursePiece {
  const name = (SURFACE_NAMES as string[]).includes(stored.surface ?? '')
    ? (stored.surface as SurfaceName)
    : 'normal';
  return {
    length: number(stored.length, COURSE_DEFAULTS.piece.length, 1, 200),
    turn: number(stored.turn, 0, -180, 180),
    drop: number(stored.drop, 0, -45, 45),
    width: number(stored.width, COURSE_DEFAULTS.piece.width, 2, 100),
    bank: number(stored.bank, 0, -45, 45),
    surface: SURFACE_BY_NAME[name],
    walls: stored.walls === true,
    gap: stored.gap === true,
    // Nothing said means fully exposed, which is how every course behaved
    // before there was any choice about it.
    wind: number(stored.wind, 1, 0, 1),
  };
}

/** Turns one course from the file into a stage the game can play. */
export function stageFromStored(stored: StoredCourse, index: number): Stage {
  const mood = (stored.mood ?? {}) as Partial<StoredCourse['mood']>;
  const pieces = Array.isArray(stored.pieces) ? stored.pieces : [];
  const built =
    pieces.length > 0 ? pieces.map(pieceFromStored) : [pieceFromStored({ length: 40 })];
  return {
    id: text(stored.id, `course-${index + 1}`),
    name: text(stored.name, `コース ${index + 1}`),
    blurb: text(stored.blurb, ''),
    difficulty: Math.round(number(stored.difficulty, COURSE_DEFAULTS.difficulty, 1, 3)),
    mood: {
      sky: colour(mood.sky, COURSE_DEFAULTS.mood.sky),
      horizon: colour(mood.horizon, COURSE_DEFAULTS.mood.horizon),
      ground: colour(mood.ground, COURSE_DEFAULTS.mood.ground),
      floor: colour(mood.floor, COURSE_DEFAULTS.mood.floor),
      edge: colour(mood.edge, COURSE_DEFAULTS.mood.edge),
      fog: number(mood.fog, COURSE_DEFAULTS.mood.fog, 30, 600),
    },
    breeze: Math.round(number(stored.breeze, COURSE_DEFAULTS.breeze, 0, 1) * ONE),
    seed: Math.round(number(stored.seed, index + 1, 0, 0xffffffff)),
    targetSeconds: number(stored.targetSeconds, COURSE_DEFAULTS.targetSeconds, 1, 600),
    pieces: built,
    ...branchOf(stored, built),
  };
}

/**
 * Where a run of stretches leaves you, starting from nothing.
 *
 * Position, height and which way you are pointing. Used to ask whether two
 * different ways round arrive at the same place, which is the whole
 * difficulty with a fork: a way that never comes back is not a fork, it is
 * a second course with its own finish somewhere else entirely.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  /** Which way it faces at the end, as a direction of unit length. */
  facingX: number;
  facingZ: number;
}

/** Follows a run of stretches and says where it ends up. */
export function poseAfter(pieces: CoursePiece[]): Pose {
  if (pieces.length === 0) return { x: 0, y: 0, z: 0, facingX: 0, facingZ: 1 };
  const course = buildCourse(pieces, 0);
  const last = course.count - 1;
  return {
    x: course.x[last] / ONE,
    y: course.y[last] / ONE,
    z: course.z[last] / ONE,
    facingX: course.forwardX[last] / ONE,
    facingZ: course.forwardZ[last] / ONE,
  };
}

/**
 * How far a branch misses the place it is meant to rejoin.
 *
 * Everything is in metres and degrees, measured between where the replaced
 * stretches would have left you and where the branch actually does.
 */
export interface BranchGap {
  /** How far apart the two ends are, along the ground. */
  apart: number;
  /** How far apart in height. */
  height: number;
  /** How differently they are pointing, in degrees. */
  facing: number;
}

/** How close a branch comes to rejoining the course it left. */
export function branchGap(pieces: CoursePiece[], branch: CoursePiece[], from: number, to: number): BranchGap {
  const was = poseAfter(pieces.slice(from, to));
  const now = poseAfter(branch);
  const dx = now.x - was.x;
  const dz = now.z - was.z;
  // Compared flat, and each side made unit length first. The stored
  // direction points down the hill as well as along it, so its flat part is
  // shorter than one — and comparing two short vectors reports an angle
  // between them even when they point exactly the same way.
  const wasLength = Math.hypot(was.facingX, was.facingZ) || 1;
  const nowLength = Math.hypot(now.facingX, now.facingZ) || 1;
  const dot =
    (was.facingX / wasLength) * (now.facingX / nowLength) +
    (was.facingZ / wasLength) * (now.facingZ / nowLength);
  return {
    apart: Math.sqrt(dx * dx + dz * dz),
    height: Math.abs(now.y - was.y),
    facing: (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI,
  };
}

/**
 * How far out a branch may be and still count as rejoining.
 *
 * A metre or so of slack is invisible once the floor has width, and asking
 * for better than that by hand would make a fork impossible to write.
 */
export const BRANCH_TOLERANCE = { apart: 1.5, height: 1.5, facing: 8, clearance: 0.5 };

/**
 * How far from a junction the two ways are allowed to be on top of each other.
 *
 * Right where a road splits, the two halves are touching — that is what a
 * split looks like. It is further along that they have to be somewhere
 * different from each other.
 *
 * Fourteen metres, because these roads are about ten wide: two of them
 * cannot possibly be clear of one another until they have had at least a
 * stretch's worth of room to get apart in. Measuring closer in would
 * condemn every fork ever drawn.
 */
const JUNCTION = 14;

/**
 * How much room a road needs above it to pass underneath another one.
 *
 * Two floors in the same place on the map are only a problem if they are
 * also at the same height. With enough between them it is not a clash, it
 * is a bridge, and one of the nicer things a fork can do.
 */
const HEADROOM = 2.5;

/**
 * How much daylight there is between the two ways down, at their closest.
 *
 * Zero means their floors touch; below zero means one is inside the other,
 * which on screen is not two roads at all — it is one road with the other
 * buried in it, flickering through.
 *
 * Only the stretch where the two genuinely differ is measured, and only
 * away from either junction.
 */
export function branchClearance(
  pieces: CoursePiece[],
  branch: CoursePiece[],
  from: number,
  to: number,
): number {
  const main = buildCourse(pieces, 0);
  const alt = buildCourse([...pieces.slice(0, from), ...branch, ...pieces.slice(to)], 0);
  const forkAt = pieces.slice(0, from).reduce((sum, piece) => sum + piece.length, 0);
  const mainTo = forkAt + pieces.slice(from, to).reduce((sum, piece) => sum + piece.length, 0);
  const altTo = forkAt + branch.reduce((sum, piece) => sum + piece.length, 0);

  let closest = Number.POSITIVE_INFINITY;
  for (let j = 0; j < alt.count; j++) {
    const ad = alt.distance[j] / ONE;
    if (ad < forkAt + JUNCTION || ad > altTo - JUNCTION) continue;
    for (let i = 0; i < main.count; i++) {
      const md = main.distance[i] / ONE;
      if (md < forkAt + JUNCTION || md > mainTo - JUNCTION) continue;
      const dx = (alt.x[j] - main.x[i]) / ONE;
      const dz = (alt.z[j] - main.z[i]) / ONE;
      const dy = (alt.y[j] - main.y[i]) / ONE;
      const flat =
        Math.sqrt(dx * dx + dz * dz) - (alt.halfWidth[j] + main.halfWidth[i]) / ONE;
      // Far enough to the side, or far enough above or below: either will do.
      closest = Math.min(closest, Math.max(flat, Math.abs(dy) - HEADROOM));
    }
  }
  // Nothing to measure means nothing overlapping, which is as clear as it gets.
  return Number.isFinite(closest) ? closest : Number.POSITIVE_INFINITY;
}

/**
 * How far the two ways down get from each other at their widest.
 *
 * Not overlapping is the floor; this is the ceiling. A branch that shuffles
 * a couple of metres sideways and comes back has not overlapped anything
 * and has not given the player a choice they can see either. Measured
 * between the two floors at the point where the branch is furthest from
 * anything on the main line, which is the moment the fork actually looks
 * like one.
 */
export function branchSpread(
  pieces: CoursePiece[],
  branch: CoursePiece[],
  from: number,
  to: number,
): number {
  const main = buildCourse(pieces, 0);
  const alt = buildCourse([...pieces.slice(0, from), ...branch, ...pieces.slice(to)], 0);
  const forkAt = pieces.slice(0, from).reduce((sum, piece) => sum + piece.length, 0);
  const altTo = forkAt + branch.reduce((sum, piece) => sum + piece.length, 0);

  let widest = 0;
  for (let j = 0; j < alt.count; j++) {
    const ad = alt.distance[j] / ONE;
    if (ad < forkAt || ad > altTo) continue;
    let nearest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < main.count; i++) {
      const dx = (alt.x[j] - main.x[i]) / ONE;
      const dy = (alt.y[j] - main.y[i]) / ONE;
      const dz = (alt.z[j] - main.z[i]) / ONE;
      nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    widest = Math.max(widest, nearest);
  }
  return widest;
}

/** Whether a branch comes back to where it left, near enough. */
export function branchCloses(gap: BranchGap): boolean {
  return (
    gap.apart <= BRANCH_TOLERANCE.apart &&
    gap.height <= BRANCH_TOLERANCE.height &&
    gap.facing <= BRANCH_TOLERANCE.facing
  );
}

/**
 * Works out the other way down, and where the choice is made.
 *
 * The alternative is the main course with a stretch of it swapped out, so
 * both ways share everything before the fork and everything after the join.
 * A branch that names stretches which are not there is quietly dropped:
 * half a fork on the screen would be worse than none.
 */
function branchOf(
  stored: StoredCourse,
  pieces: CoursePiece[],
): { altPieces?: CoursePiece[]; forkAt?: number; rejoinAt?: number } {
  const branch = stored.branch;
  if (!branch || !Array.isArray(branch.pieces) || branch.pieces.length === 0) return {};
  const from = Math.round(number(branch.from, -1, 0, pieces.length));
  const to = Math.round(number(branch.to, -1, 0, pieces.length));
  if (from < 0 || to <= from || to > pieces.length) return {};

  const detour = branch.pieces.map(pieceFromStored);

  // A branch that does not come back is not a branch. Rather than putting a
  // second finish somewhere off in a field, it is simply not used: the
  // course plays as though it had never been written.
  if (!branchCloses(branchGap(pieces, detour, from, to))) return {};

  // Nor is a branch that runs through the middle of the road it left. It
  // closes, and it is drivable, and on screen it is invisible — one floor
  // inside the other. Dropped for the same reason as one that never comes
  // back: a fork you cannot see is not a fork.
  if (branchClearance(pieces, detour, from, to) < BRANCH_TOLERANCE.clearance) return {};

  const altPieces = [...pieces.slice(0, from), ...detour, ...pieces.slice(to)];
  // The choice is made where the two ways part company, and taken back
  // where they meet again. Between those two is all either way has to draw.
  const forkAt = pieces.slice(0, from).reduce((sum, piece) => sum + piece.length, 0);
  const rejoinAt = forkAt + detour.reduce((sum, piece) => sum + piece.length, 0);
  return { altPieces, forkAt, rejoinAt };
}

/** Every course in the file, ready to play. */
/**
 * The courses the game offers.
 *
 * A course made in the editor can be parked rather than deleted: setting
 * `inGame` to false in the course file leaves it there to work on without
 * it turning up in the game. Anything that does not say either way counts
 * as in, so a hand-written file needs no extra ceremony.
 */
export const STAGES: Stage[] = [
  ...((courseData as { courses?: StoredCourse[] }).courses ?? [])
    .filter((course) => course?.inGame !== false)
    .map(stageFromStored),
  // The day's course goes last, so the hand-made ones keep their order.
  stageFromStored(dailyCourse(), 99),
];

/** Every course in the file, in it or not, for the editor to list. */
export const ALL_COURSES: StoredCourse[] =
  (courseData as { courses?: StoredCourse[] }).courses ?? [];

/** Finds a course by its identifier. */
export function stageById(id: string): Stage {
  return STAGES.find((stage) => stage.id === id) ?? STAGES[0];
}

const built = new Map<string, Course>();

/**
 * Builds a course, or hands back the one built earlier. Courses never
 * change once built, so one copy can be shared by every run.
 */
export function courseFor(stage: Stage): Course {
  const existing = built.get(stage.id);
  if (existing) return existing;
  const course = buildCourse(stage.pieces, 0);
  built.set(stage.id, course);
  return course;
}

/** The other way down, where the course forks, or nothing where it does not. */
export function altCourseFor(stage: Stage): Course | null {
  if (!stage.altPieces || stage.altPieces.length === 0) return null;
  const key = `${stage.id}~alt`;
  const existing = built.get(key);
  if (existing) return existing;
  const course = buildCourse(stage.altPieces, 0);
  built.set(key, course);
  return course;
}

/** Total length of a course in metres, rounded for display. */
export function courseMetres(stage: Stage): number {
  return Math.round(courseFor(stage).totalLength / ONE);
}
