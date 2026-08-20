/**
 * The fork, and throwing the ball's weight about.
 *
 * Both of these change what the player can do rather than how things look,
 * so both are checked by rolling a ball and measuring where it ends up.
 */

import { describe, expect, it } from 'vitest';
import { ONE, toNumber } from '../src/core/fixed';
import { packControls } from '../src/core/input';
import { defaultShape, measureShape, randomShape } from '../src/core/ballShape';
import { buildCourse } from '../src/core/course';
import { RunState, World, capture, rewind } from '../src/core/simulation';
import { STAGES, altCourseFor, courseFor, stageById } from '../src/game/stages';

const forkStage = stageById('fork');

/** Rolls the fork course, holding a steer through the split. */
function takeFork(bias: number): { route: number; seconds: number; finished: boolean } {
  const world = new World({
    course: courseFor(forkStage),
    alt: altCourseFor(forkStage),
    forkAt: forkStage.forkAt,
    seed: forkStage.seed,
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  });
  const at = forkStage.forkAt ?? 0;
  let steps = 0;
  while (world.state[0] === RunState.Rolling && steps < 120 * 120) {
    const metres = world.travelled[0] / ONE;
    const near = metres > at - 10 && metres < at + 4;
    world.advance([
      packControls({ steer: Math.round((near ? bias : 0) * ONE), push: 0, buttons: 0 }),
    ]);
    steps++;
  }
  return {
    route: world.route[0],
    seconds: world.secondsFor(0),
    finished: world.state[0] === RunState.Finished,
  };
}

describe('a course with two ways down', () => {
  it('has a second way, and it is the shorter one', () => {
    const main = courseFor(forkStage);
    const alt = altCourseFor(forkStage);
    expect(alt).not.toBeNull();
    expect(alt!.totalLength).toBeLessThan(main.totalLength);
    expect(forkStage.forkAt).toBeGreaterThan(0);
  });

  it('sends the ball whichever way it is pointed at the split', () => {
    expect(takeFork(-1).route).toBe(1);
    expect(takeFork(0.5).route).toBe(0);
  });

  it('makes the short way worth taking, and both ways finishable', () => {
    const quick = takeFork(-1);
    const safe = takeFork(0.5);
    expect(quick.finished).toBe(true);
    expect(safe.finished).toBe(true);
    // Worth the risk, or nobody would ever take it.
    expect(quick.seconds).toBeLessThan(safe.seconds);
  });

  it('will not change its mind once the split is behind it', () => {
    // Flitting between two floors that are no longer near each other would
    // put the ball in mid-air over neither of them.
    const world = new World({
      course: courseFor(forkStage),
      alt: altCourseFor(forkStage),
      forkAt: forkStage.forkAt,
      seed: forkStage.seed,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    let taken = -1;
    let changes = 0;
    for (let i = 0; i < 120 * 60 && world.state[0] === RunState.Rolling; i++) {
      world.advance([packControls({ steer: Math.round(Math.sin(i / 40) * ONE), push: 0, buttons: 0 })]);
      if (world.route[0] !== taken) {
        changes++;
        taken = world.route[0];
      }
    }
    // Once from nothing to a choice, and never again.
    expect(changes).toBeLessThanOrEqual(2);
  });

  it('is wound back along with everything else', () => {
    const world = new World({
      course: courseFor(forkStage),
      alt: altCourseFor(forkStage),
      forkAt: forkStage.forkAt,
      seed: forkStage.seed,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    const start = capture(world);
    for (let i = 0; i < 120 * 8; i++) {
      world.advance([packControls({ steer: -ONE, push: 0, buttons: 0 })]);
    }
    const wentLeft = world.route[0];
    rewind(world, start);
    expect(world.route[0]).toBe(0);

    // And doing the same again lands in exactly the same place.
    for (let i = 0; i < 120 * 8; i++) {
      world.advance([packControls({ steer: -ONE, push: 0, buttons: 0 })]);
    }
    expect(world.route[0]).toBe(wentLeft);
  });

  it('leaves the courses that do not fork exactly as they were', () => {
    for (const stage of STAGES) {
      if (stage.id === 'fork') continue;
      expect(altCourseFor(stage)).toBeNull();
    }
  });
});

describe('throwing the ball weight about while it rolls', () => {
  /** How far the ball ends up sideways down a wide, straight slope. */
  function drift(shape: Uint8Array, lean: number): number {
    const world = new World({
      course: buildCourse([{ length: 90, drop: 6, width: 24 }], 0),
      seed: 1,
      ball: measureShape(shape),
      countdownSeconds: 0,
    });
    let most = 0;
    for (let i = 0; i < 120 * 30 && world.state[0] === RunState.Rolling; i++) {
      world.advance([
        packControls({ steer: 0, push: 0, buttons: 0, lean: Math.round(lean * ONE) }),
      ]);
      const now = toNumber(world.sideways[0]);
      if (Math.abs(now) > Math.abs(most)) most = now;
    }
    return most;
  }

  it('does nothing at all until it is asked for', () => {
    expect(drift(defaultShape(), 0)).toBeCloseTo(0, 2);
  });

  it('sends the ball the way the weight is thrown', () => {
    // The same way round as the steering: right is right.
    expect(drift(defaultShape(), 1)).toBeGreaterThan(3);
    expect(drift(defaultShape(), -1)).toBeLessThan(-3);
  });

  it('can be held against a ball that pulls, and hold it straight', () => {
    // The use of it: a badly built ball can be trimmed by the player rather
    // than merely suffered.
    const wonky = randomShape(3);
    const alone = drift(wonky, 0);
    const trimmed = drift(wonky, -1);
    expect(Math.abs(alone)).toBeGreaterThan(0.5);
    // Pulling the other way overcomes what the shape was doing.
    expect(Math.sign(trimmed)).not.toBe(Math.sign(alone));
  });

  it('takes a moment to get the weight across', () => {
    // Not a second steering wheel: the weight has to be got moving.
    const world = new World({
      course: buildCourse([{ length: 90, drop: 6, width: 24 }], 0),
      seed: 1,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    const hard = packControls({ steer: 0, push: 0, buttons: 0, lean: ONE });
    world.advance([hard]);
    const afterOne = world.lean[0];
    for (let i = 0; i < 120; i++) world.advance([hard]);
    const afterASecond = world.lean[0];
    expect(afterOne).toBeLessThan(ONE / 4);
    expect(afterASecond).toBeGreaterThan(afterOne);
  });

  it('is part of the world, so a replay puts it back', () => {
    const world = new World({
      course: buildCourse([{ length: 90, drop: 6, width: 24 }], 0),
      seed: 1,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    for (let i = 0; i < 60; i++) {
      world.advance([packControls({ steer: 0, push: 0, buttons: 0, lean: ONE })]);
    }
    const held = capture(world);
    expect(held.lean[0]).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) {
      world.advance([packControls({ steer: 0, push: 0, buttons: 0, lean: -ONE })]);
    }
    rewind(world, held);
    expect(world.lean[0]).toBe(held.lean[0]);
  });
});
