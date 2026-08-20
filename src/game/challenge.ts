/**
 * Handing a run to somebody else.
 *
 * A challenge is one line of text carrying everything needed to race
 * against a run somebody else made: which course it was on, the ball they
 * used, and every input they gave, one per step. Fed back in, it reproduces
 * their run exactly, so the person receiving it races the real thing rather
 * than a recording of it.
 *
 * The ball has to travel with it. A run is only a list of steering inputs;
 * the same inputs given to a different ball go somewhere else entirely.
 */

import { squashed, unsquashed, fromText, toText } from './pack';
import { readRecipe, writeRecipe, type Recipe } from './recipe';
import type { BallDesign } from './storage';

/** What this format is called, so a later one can be told apart from it. */
const MARK = 'C1';

/**
 * What separates the pieces of a challenge.
 *
 * Not the bar a recipe already uses between the two halves of the weight:
 * splitting on that would tear the ball in half on the way back in.
 */
const BETWEEN = '!';

/** How long a challenge may be before it is refused, in characters. */
const MOST_CHARACTERS = 20000;

/** A run somebody has handed over. */
export interface Challenge {
  /** Which course it was set on. */
  courseId: string;
  /** Which day's course, where the course is the one made from the date. */
  day: number;
  /** How long it took them, in seconds. */
  seconds: number;
  /** The ball they used. */
  ball: Recipe;
  /** Everything they did, one entry per step. */
  controls: number[];
}

/** Turns a run into one line of text. */
export async function writeChallenge(
  courseId: string,
  day: number,
  seconds: number,
  ball: BallDesign,
  controls: readonly number[],
): Promise<string> {
  const packed = new Uint8Array(new Int32Array(controls).buffer);
  const squeezed = await squashed(packed);
  return [
    MARK,
    courseId,
    String(day),
    seconds.toFixed(2),
    await writeRecipe(ball),
    toText(squeezed ?? packed),
    squeezed ? '1' : '0',
  ].join(BETWEEN);
}

/**
 * Reads a challenge back, or gives nothing if it is not one.
 *
 * All of it arrives from outside, so none of it is believed without being
 * checked: a course nobody has, a ball that is not a ball, or a run that is
 * not a whole number of steps all come back as nothing at all.
 */
export async function readChallenge(text: string): Promise<Challenge | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MOST_CHARACTERS) return null;

  const parts = trimmed.split(BETWEEN);
  if (parts[0] !== MARK || parts.length < 7) return null;

  const courseId = parts[1];
  const day = Number(parts[2]);
  const seconds = Number(parts[3]);
  if (courseId.length === 0 || !Number.isFinite(day) || !Number.isFinite(seconds)) return null;

  const ball = await readRecipe(parts[4]);
  if (!ball) return null;

  const held = fromText(parts[5]);
  if (!held) return null;
  const loose = parts[6] === '1' ? await unsquashed(held) : held;
  // Four bytes to a step, so anything else is not a run.
  if (!loose || loose.length === 0 || loose.length % 4 !== 0) return null;

  const controls = Array.from(
    new Int32Array(loose.buffer, loose.byteOffset, loose.length / 4),
  );
  if (controls.length < 60) return null;

  return { courseId, day, seconds, ball, controls };
}

/** The web address that opens the game on this challenge. */
export async function challengeLink(
  courseId: string,
  day: number,
  seconds: number,
  ball: BallDesign,
  controls: readonly number[],
  base: string,
): Promise<string> {
  const at = base.split('#')[0].split('?')[0];
  const text = await writeChallenge(courseId, day, seconds, ball, controls);
  return `${at}?run=${encodeURIComponent(text)}`;
}

/** The challenge carried by a web address, if it carries one. */
export function challengeFromLink(search: string): string | null {
  try {
    const held = new URLSearchParams(search).get('run');
    return held && held.length > 0 ? held : null;
  } catch {
    return null;
  }
}
