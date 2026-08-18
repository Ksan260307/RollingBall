/**
 * The three courses.
 *
 * A course is written as a list of stretches in plain units: how long, how
 * much it bends, how steeply it drops, how wide the floor is and what it is
 * made of. Building it turns that into the point chain the physics uses.
 *
 * Each course is a little over one hundred metres from the start line to the
 * finish.
 */

import { CoursePiece, Surface, buildCourse, type Course } from '../core/course';
import { ONE } from '../core/fixed';

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

export const STAGES: Stage[] = [
  {
    id: 'meadow',
    name: 'はじまりの丘',
    blurb: '幅の広いゆるやかな坂道。まずはここで転がりに慣れよう。',
    difficulty: 1,
    mood: {
      sky: '#8fd3ff',
      horizon: '#e8f7ff',
      ground: '#7fc98a',
      floor: '#f2f6e9',
      edge: '#ffd166',
      fog: 190,
    },
    breeze: 0,
    seed: 0x51a9e1,
    targetSeconds: 24,
    pieces: [
      { length: 12, drop: 6, width: 10, walls: true },
      { length: 14, turn: -20, drop: 7, width: 9, bank: -5, walls: true },
      { length: 16, turn: 26, drop: 7, width: 9, bank: 6, walls: true },
      { length: 12, drop: 9, width: 8 },
      { length: 14, turn: -16, drop: 6, width: 8, bank: -4, walls: true },
      { length: 10, drop: 5, width: 8, surface: Surface.Boost },
      { length: 12, turn: 14, drop: 7, width: 9, walls: true },
      { length: 12, drop: 4, width: 10, walls: true },
    ],
  },
  {
    id: 'valley',
    name: '風わたる谷',
    blurb: 'すべりやすい路面と横風。カーブのふくらみに気をつけて。',
    difficulty: 2,
    mood: {
      sky: '#5a7fd6',
      horizon: '#ffd9a8',
      ground: '#3f6b7d',
      floor: '#dfeaf5',
      edge: '#7ce0ff',
      fog: 150,
    },
    breeze: Math.round(0.55 * ONE),
    seed: 0x2c77b3,
    targetSeconds: 26,
    pieces: [
      { length: 10, drop: 8, width: 8, walls: true },
      { length: 14, turn: 30, drop: 7, width: 7, bank: 9, walls: true },
      { length: 12, drop: 6, width: 6, surface: Surface.Slick },
      { length: 16, turn: -34, drop: 7, width: 7, bank: -10, walls: true },
      { length: 10, drop: 10, width: 6, surface: Surface.Slick },
      { length: 12, turn: 22, drop: 6, width: 7, bank: 7 },
      { length: 10, drop: 5, width: 7, surface: Surface.Boost },
      { length: 12, turn: -18, drop: 7, width: 8, walls: true },
      { length: 8, drop: 4, width: 9, walls: true },
    ],
  },
  {
    id: 'skyway',
    name: '星ふる回廊',
    blurb: '細い足場ととぎれた床。いきおいをつけて飛びこえよう。',
    difficulty: 3,
    mood: {
      sky: '#1b1e3d',
      horizon: '#6b4fa8',
      ground: '#161a33',
      floor: '#c9d6ff',
      edge: '#ff9de2',
      fog: 130,
    },
    breeze: Math.round(0.3 * ONE),
    seed: 0x9f3d05,
    targetSeconds: 28,
    pieces: [
      { length: 10, drop: 9, width: 7, walls: true },
      { length: 12, turn: 18, drop: 8, width: 5 },
      { length: 8, drop: 3, width: 5, surface: Surface.Boost },
      { length: 4, drop: 13, width: 5, gap: true },
      { length: 12, turn: -24, drop: 6, width: 5, bank: -8 },
      { length: 10, drop: 6, width: 4, surface: Surface.Rough },
      { length: 8, drop: 3, width: 5, surface: Surface.Boost },
      { length: 4, drop: 13, width: 5, gap: true },
      { length: 14, turn: 28, drop: 7, width: 6, bank: 9, walls: true },
      { length: 10, drop: 6, width: 5, surface: Surface.Slick },
      { length: 8, drop: 5, width: 6 },
      { length: 10, drop: 4, width: 8, walls: true },
    ],
  },
];

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
