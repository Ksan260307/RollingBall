/**
 * The slope in the workbench.
 *
 * What matters about it is that it is the real rules on a real slope: a
 * ball that will not roll here will not roll on a course, and one that
 * wanders here wanders there. The drawing of it is ordinary drawing code;
 * what is checked here is that the slope itself does its job.
 */

import { describe, expect, it } from 'vitest';
import { ONE, toNumber } from '../src/core/fixed';
import { NEUTRAL, packControls } from '../src/core/input';
import { buildCourse } from '../src/core/course';
import { cubeShape, defaultShape, measureShape, randomShape } from '../src/core/ballShape';
import { RunState, World } from '../src/core/simulation';

/** The same slope the workbench puts under the ball. */
function testSlope() {
  return buildCourse(
    [
      { length: 14, drop: 11, width: 7, walls: true },
      { length: 14, turn: 22, drop: 9, width: 7, walls: true },
      { length: 14, turn: -24, drop: 9, width: 7, walls: true },
      { length: 12, drop: 8, width: 7, walls: true },
    ],
    0,
  );
}

function roll(voxels: Uint8Array, weightAt = { sideways: 0, up: 0 }) {
  const world = new World({
    course: testSlope(),
    seed: 7,
    ball: measureShape(voxels, weightAt),
    countdownSeconds: 0,
  });
  const hands = packControls(NEUTRAL);
  let steps = 0;
  let drift = 0;
  while (world.state[0] === RunState.Rolling && steps < 120 * 60) {
    world.advance([hands]);
    drift = Math.max(drift, Math.abs(toNumber(world.sideways[0])));
    steps++;
  }
  return {
    finished: world.state[0] === RunState.Finished,
    seconds: world.secondsFor(0),
    drift,
    metres: world.travelled[0] / ONE,
  };
}

describe('the slope in the workbench', () => {
  it('lets a properly round ball get to the bottom, hands off', () => {
    const result = roll(defaultShape());
    expect(result.finished).toBe(true);
    // Short: it is a look at the ball, not a course.
    expect(result.seconds).toBeGreaterThan(2);
    expect(result.seconds).toBeLessThan(20);
  });

  it('takes a boxy ball longer, the same as a course would', () => {
    expect(roll(cubeShape()).seconds).toBeGreaterThan(roll(defaultShape()).seconds);
  });

  it('tells one ball from another, which is what it is for', () => {
    // Watching a test roll has to be worth doing, so balls that behave
    // differently on a course have to behave differently here.
    const times = [defaultShape(), cubeShape(), randomShape(4), randomShape(11)].map(
      (shape) => Math.round(roll(shape).seconds * 10) / 10,
    );
    expect(new Set(times).size).toBe(times.length);
  });

  it('is not so gentle that a chaotic ball sails down it', () => {
    // If everything got to the bottom regardless, watching would tell you
    // nothing. Some of them should struggle, exactly as on a course.
    let struggled = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const result = roll(randomShape(seed));
      if (!result.finished || result.seconds > 8) struggled++;
    }
    expect(struggled).toBeGreaterThan(0);
  });

  it('holds the ball on, so a test roll never simply falls off', () => {
    // Railings all the way: the workbench is for watching how it rolls, and
    // a ball that vanished over the edge would show nothing at all.
    for (let seed = 1; seed <= 12; seed++) {
      const world = new World({
        course: testSlope(),
        seed: 7,
        ball: measureShape(randomShape(seed)),
        countdownSeconds: 0,
      });
      for (let i = 0; i < 120 * 20 && world.state[0] === RunState.Rolling; i++) {
        world.advance([packControls(NEUTRAL)]);
      }
      expect(world.falls[0]).toBe(0);
    }
  });
});
