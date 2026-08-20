/**
 * A course that changes with the date.
 *
 * The day itself is the only ingredient, so everybody who plays on the same
 * day rolls down exactly the same hill without anything having to be sent
 * anywhere. It is built out of the same stretches the hand-made courses are
 * written with, so nothing else in the game has to know it is any different.
 *
 * Days are counted in UTC on purpose. A course that changed at a different
 * moment for each player would make comparing times a nonsense.
 */

import { Generator } from '../core/random';
import { ONE } from '../core/fixed';
import type { StoredCourse, StoredPiece } from './stages';

/** How many stretches a day's course is made of. */
const PIECES = 9;

/** The moods it picks from, so one day looks unlike the next. */
const MOODS = [
  { sky: '#8fd3ff', horizon: '#e8f7ff', ground: '#7fc98a', floor: '#f2f6e9', edge: '#ffd166', fog: 190 },
  { sky: '#ffb98f', horizon: '#fff0e2', ground: '#8a6b4f', floor: '#f6ead9', edge: '#e2574c', fog: 165 },
  { sky: '#6f78c9', horizon: '#d9dcff', ground: '#3c4470', floor: '#e3e6fb', edge: '#7cf2d0', fog: 150 },
  { sky: '#9be7d6', horizon: '#eafcf6', ground: '#4f7a63', floor: '#eef7f3', edge: '#ffb703', fog: 180 },
  { sky: '#d6a9e8', horizon: '#f7ecff', ground: '#5d4a72', floor: '#f0e8f7', edge: '#ffe066', fog: 170 },
];

/** Which day it is, counted in whole days since the usual starting point. */
export function dayNumber(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 86_400_000);
}

/** How the day is written for the player: 2026-08-21 and the like. */
export function dayName(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Builds the course for a given day.
 *
 * Everything is drawn from one seeded generator, so the same day always
 * produces the same hill, on every device, for ever.
 */
export function dailyCourse(day: number = dayNumber()): StoredCourse {
  const rng = new Generator((day * 2654435761) >>> 0);
  const pick = <T>(list: T[]): T => list[rng.below(list.length)];
  const between = (low: number, high: number): number =>
    low + (rng.below(1000) / 1000) * (high - low);

  const mood = MOODS[day % MOODS.length];
  // How the day feels overall: some days are steep, some are windy, some are
  // narrow. Deciding it once up front keeps a day's course of a piece rather
  // than a bag of unrelated stretches.
  const steepness = between(5, 11);
  const width = between(6.5, 12);
  const twist = between(10, 46);
  const breeze = rng.below(3) === 0 ? between(0.3, 0.7) : 0;

  const pieces: StoredPiece[] = [];
  let turningRight = rng.below(2) === 0;
  for (let i = 0; i < PIECES; i++) {
    const bend = i === 0 ? 0 : Math.round(between(twist * 0.35, twist)) * (turningRight ? 1 : -1);
    turningRight = !turningRight;
    const piece: StoredPiece = {
      length: Math.round(between(10, 16)),
      drop: Math.round(between(steepness * 0.6, steepness * 1.4)),
      width: Math.round(between(width * 0.8, width * 1.2) * 10) / 10,
      // Railings unless the stretch is wide, straight and sheltered. A day
      // that cannot be got down is not a day's course, it is a bad joke, so
      // the generator is deliberately careful here.
      walls: true,
    };
    if (breeze === 0 && bend === 0 && (piece.width ?? 0) >= 10 && rng.below(3) === 0) {
      piece.walls = false;
    }
    if (bend !== 0) {
      piece.turn = bend;
      piece.bank = Math.round(bend / 4);
    }
    // One stretch in six is made of something other than ordinary floor.
    if (rng.below(6) === 0) piece.surface = pick(['slick', 'rough', 'boost'] as const);
    // A gap, but never at the very start or the very end, never on a bend,
    // and never on a windy day: flying blind in a crosswind is not a test
    // of anything.
    if (i > 1 && i < PIECES - 2 && bend === 0 && breeze === 0 && rng.below(9) === 0) {
      piece.gap = true;
      piece.length = 4;
      piece.drop = Math.round(between(10, 14));
      piece.walls = true;
    }
    if (breeze > 0) piece.wind = rng.below(3) === 0 ? 0.2 : 1;

    // The opening stretch is always a plain, honest slope. A day that began
    // on rough ground at three degrees would leave the ball sitting there
    // waiting to be counted out, which is nobody's idea of a course.
    if (i === 0) {
      piece.drop = Math.max(8, Math.round(steepness));
      piece.walls = true;
      piece.width = Math.max(8, piece.width ?? 8);
      delete piece.surface;
      delete piece.gap;
      delete piece.wind;
    }
    pieces.push(piece);
  }

  return {
    id: DAILY_ID,
    name: 'きょうの コース',
    blurb: `${dayName(new Date(day * 86_400_000))} のコース。あしたには 別のコースに なります。`,
    difficulty: 2,
    inGame: true,
    mood,
    breeze,
    seed: (day * 7919) % 0xffffff,
    targetSeconds: 24,
    pieces,
  };
}

/** What the day's course is called, so it can be told from the fixed ones. */
export const DAILY_ID = 'today';

/** Whether a course is the one that changes with the date. */
export function isDaily(id: string): boolean {
  return id === DAILY_ID;
}

/** The wind strength as the rules want it, for a day's course. */
export function dailyBreeze(course: StoredCourse): number {
  return Math.round(Math.min(1, Math.max(0, course.breeze)) * ONE);
}
