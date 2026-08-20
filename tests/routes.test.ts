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
import {
  STAGES,
  altCourseFor,
  branchCloses,
  branchGap,
  courseFor,
  pieceFromStored,
  stageFromStored,
} from '../src/game/stages';
import type { StoredCourse } from '../src/game/stages';

/**
 * A course with two ways down, built here rather than shipped.
 *
 * No course in the game forks at the moment, but the machinery that makes
 * one work is still there and still has to keep working, so the test brings
 * its own.
 */
const forkStage = stageFromStored(
  {
    id: 'test-fork',
    name: 'ふたまた',
    blurb: '',
    difficulty: 2,
    mood: {
      sky: '#7fd6c4',
      horizon: '#e3fbf5',
      ground: '#4f7a63',
      floor: '#e9f2ee',
      edge: '#ffb703',
      fog: 175,
    },
    breeze: 0,
    seed: 5150422,
    targetSeconds: 20,
    pieces: [
      { length: 12, drop: 9, width: 10, walls: true },
      { length: 12, drop: 7, width: 15, walls: true },
      { length: 16, turn: 24, drop: 6, width: 11, bank: 6, walls: true },
      { length: 16, turn: -18, drop: 6, width: 11, bank: -4, walls: true },
      { length: 16, turn: 14, drop: 6, width: 10, walls: true },
      { length: 14, drop: 7, width: 10, walls: true },
      { length: 14, drop: 7, width: 10, walls: true },
    ],
    branch: {
      from: 2,
      to: 5,
      // The last two stretches were worked out by the editor's closer, not
      // by hand: a branch has to arrive back at the main line in the right
      // place, at the right height and pointing the right way, and nobody
      // hits three things at once by writing numbers in.
      pieces: [
        { length: 10, turn: -26, drop: 4.79, width: 3.2, walls: true },
        { length: 12, turn: -6, drop: 4.79, width: 2.8, walls: true, surface: 'slick' },
        { length: 23, turn: 114, drop: 4.79, width: 6, walls: true },
        { length: 14, turn: -62, drop: 4.79, width: 6, walls: true },
      ],
    },
  } as StoredCourse,
  0,
);

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
  it('has a second way, and it is a different length', () => {
    // Not necessarily shorter. Bringing a branch back to the main line
    // costs track, so a branch that closes is often the longer way round —
    // a shortcut has to be drawn heading for the rejoin from the start.
    const main = courseFor(forkStage);
    const alt = altCourseFor(forkStage);
    expect(alt).not.toBeNull();
    expect(alt!.totalLength).not.toBe(main.totalLength);
    expect(forkStage.forkAt).toBeGreaterThan(0);
  });

  it('sends the ball whichever way it is pointed at the split', () => {
    expect(takeFork(-1).route).toBe(1);
    expect(takeFork(0.5).route).toBe(0);
  });

  it('makes both ways finishable, and makes them different', () => {
    const branchWay = takeFork(-1);
    const mainWay = takeFork(0.5);
    expect(branchWay.finished).toBe(true);
    expect(mainWay.finished).toBe(true);
    // A choice that made no difference would not be a choice.
    expect(Math.abs(branchWay.seconds - mainWay.seconds)).toBeGreaterThan(0.5);
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

  it('gives exactly the shipped courses that say they fork a second way', () => {
    for (const stage of STAGES) {
      const has = altCourseFor(stage) !== null;
      expect(has).toBe(stage.altPieces !== undefined);
      // And where there is one, it really is a second way down and not a
      // copy of the first.
      if (has) expect(altCourseFor(stage)!.totalLength).not.toBe(courseFor(stage).totalLength);
    }
    // One course forks today; the rest do not.
    expect(STAGES.filter((stage) => altCourseFor(stage) !== null)).toHaveLength(1);
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

describe('deciding whether a fork actually rejoins', () => {
  const main = [
    { length: 12, drop: 9, width: 10, walls: true },
    { length: 12, drop: 7, width: 15, walls: true },
    { length: 16, turn: 24, drop: 6, width: 11, bank: 6, walls: true },
    { length: 16, turn: -18, drop: 6, width: 11, bank: -4, walls: true },
    { length: 16, turn: 14, drop: 6, width: 10, walls: true },
    { length: 14, drop: 7, width: 10, walls: true },
  ].map(pieceFromStored);

  it('measures a way that goes nowhere near as not rejoining', () => {
    const wanders = [
      { length: 10, turn: -26, drop: 13, width: 3.2, walls: true },
      { length: 12, turn: -6, drop: 14, width: 2.8, walls: true },
    ].map(pieceFromStored);
    const gap = branchGap(main, wanders, 2, 5);
    expect(gap.apart).toBeGreaterThan(10);
    expect(branchCloses(gap)).toBe(false);
  });

  it('measures the way the main course goes as rejoining exactly', () => {
    // The stretches being replaced obviously arrive where they arrive.
    const gap = branchGap(main, main.slice(2, 5), 2, 5);
    expect(gap.apart).toBeCloseTo(0, 5);
    expect(gap.facing).toBeCloseTo(0, 4);
    expect(branchCloses(gap)).toBe(true);
  });

  it('refuses to use a fork that does not come back', () => {
    // Rather than putting a second finish out in a field somewhere, a
    // branch that misses is simply not used and the course plays as one.
    const stage = stageFromStored(
      {
        ...(forkStage as unknown as StoredCourse),
        id: 'broken-fork',
        pieces: [
          { length: 12, drop: 9, width: 10, walls: true },
          { length: 12, drop: 7, width: 15, walls: true },
          { length: 16, turn: 24, drop: 6, width: 11, walls: true },
          { length: 16, turn: -18, drop: 6, width: 11, walls: true },
          { length: 16, turn: 14, drop: 6, width: 10, walls: true },
          { length: 14, drop: 7, width: 10, walls: true },
        ],
        branch: {
          from: 2,
          to: 5,
          pieces: [{ length: 10, turn: -80, drop: 20, width: 3, walls: true }],
        },
      } as StoredCourse,
      0,
    );
    expect(stage.altPieces).toBeUndefined();
    expect(altCourseFor(stage)).toBeNull();
  });
});
