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

export interface Stage {
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
  };
}

/** Turns one course from the file into a stage the game can play. */
export function stageFromStored(stored: StoredCourse, index: number): Stage {
  const mood = (stored.mood ?? {}) as Partial<StoredCourse['mood']>;
  const pieces = Array.isArray(stored.pieces) ? stored.pieces : [];
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
    pieces: pieces.length > 0 ? pieces.map(pieceFromStored) : [pieceFromStored({ length: 40 })],
  };
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
export const STAGES: Stage[] = ((courseData as { courses?: StoredCourse[] }).courses ?? [])
  .filter((course) => course?.inGame !== false)
  .map(stageFromStored);

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

/** Total length of a course in metres, rounded for display. */
export function courseMetres(stage: Stage): number {
  return Math.round(courseFor(stage).totalLength / ONE);
}
