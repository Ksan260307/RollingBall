/**
 * The course that changes with the date.
 *
 * Two things have to hold. Everybody who plays on a given day must get the
 * same hill, or comparing times is meaningless. And every day's hill has to
 * be one somebody can actually get down — a generated course that cannot be
 * finished is worse than no course at all, because it is nobody's fault and
 * cannot be fixed by playing better.
 */

import { describe, expect, it } from 'vitest';
import { ONE } from '../src/core/fixed';
import { unpackControls } from '../src/core/input';
import { defaultShape, measureShape } from '../src/core/ballShape';
import { RunState } from '../src/core/simulation';
import { buildCourse } from '../src/core/course';
import { Session, STEP_SECONDS } from '../src/game/session';
import { demoControls } from '../src/game/demoDriver';
import { DAILY_ID, dailyCourse, dayName, dayNumber, isDaily } from '../src/game/daily';
import { stageFromStored } from '../src/game/stages';

/** Rolls a day's course down with the same driving the title screen uses. */
function runDay(day: number): { finished: boolean; seconds: number; metres: number } {
  const stage = { ...stageFromStored(dailyCourse(day), 99), id: `day-${day}` };
  const session = new Session({
    stage,
    course: buildCourse(stage.pieces, 0),
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  });
  let steps = 0;
  while (session.running && steps < 120 * 200) {
    session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    steps++;
  }
  return {
    finished: session.world.state[0] === RunState.Finished,
    seconds: session.seconds,
    metres: session.world.travelled[0] / ONE,
  };
}

describe('the course that changes with the date', () => {
  it('gives the same course to everybody on the same day', () => {
    for (const day of [20685, 20700, 21000]) {
      expect(JSON.stringify(dailyCourse(day))).toBe(JSON.stringify(dailyCourse(day)));
    }
  });

  it('gives a different course tomorrow', () => {
    const today = dayNumber();
    const seen = new Set<string>();
    for (let day = today; day < today + 12; day++) {
      seen.add(JSON.stringify(dailyCourse(day).pieces));
    }
    expect(seen.size).toBe(12);
  });

  it('counts the day the same way wherever you are', () => {
    // Whole days from a fixed point, not local midnight: a course that
    // turned over at a different moment for each player would make times
    // impossible to compare.
    const noon = new Date('2026-08-21T12:00:00Z');
    const lateEvening = new Date('2026-08-21T23:59:59Z');
    expect(dayNumber(noon)).toBe(dayNumber(lateEvening));
    expect(dayNumber(new Date('2026-08-22T00:00:01Z'))).toBe(dayNumber(noon) + 1);
    expect(dayName(noon)).toBe('2026-08-21');
  });

  it('can be told apart from the courses that do not change', () => {
    expect(isDaily(DAILY_ID)).toBe(true);
    expect(isDaily('meadow')).toBe(false);
    expect(dailyCourse().id).toBe(DAILY_ID);
  });

  it('always starts with a slope the ball can get going on', () => {
    // A day that opened on rough ground at three degrees left the ball
    // sitting on the line to be counted out. Every day starts properly now.
    for (let day = 20685; day < 20685 + 60; day++) {
      const first = dailyCourse(day).pieces[0];
      expect(first.drop ?? 0).toBeGreaterThanOrEqual(8);
      expect(first.surface).toBeUndefined();
      expect(first.gap).toBeUndefined();
      expect(first.walls).toBe(true);
    }
  });

  it('can be got down, every day of the next four months', () => {
    const today = dayNumber();
    const failures: number[] = [];
    for (let day = today; day < today + 120; day++) {
      if (!runDay(day).finished) failures.push(day);
    }
    expect(failures).toEqual([]);
    // Rolling four months of courses takes a moment; it is worth it, because
    // this is the check that catches a day nobody could have played.
  }, 60_000);

  it('is about the length and the time the other courses are', () => {
    const today = dayNumber();
    for (let day = today; day < today + 20; day++) {
      const result = runDay(day);
      expect(result.metres).toBeGreaterThan(80);
      expect(result.metres).toBeLessThan(200);
      expect(result.seconds).toBeGreaterThan(8);
      expect(result.seconds).toBeLessThan(90);
    }
  });
});
