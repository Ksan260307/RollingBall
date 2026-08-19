import { describe, expect, it } from 'vitest';
import { CoursePiece, buildCourse } from '../src/core/course';
import { ONE, toNumber } from '../src/core/fixed';
import { cubeShape, defaultShape, measureShape, pebbleShape } from '../src/core/ballShape';
import { packControls } from '../src/core/input';
import {
  RunState,
  STEPS_PER_SECOND,
  World,
  ballFeelFrom,
  capture,
  rewind,
} from '../src/core/simulation';
import { demoControls } from '../src/game/demoDriver';

const straightHill: CoursePiece[] = [{ length: 60, drop: 8, width: 8, walls: true }];
const narrowLedge: CoursePiece[] = [{ length: 40, drop: 8, width: 3 }];

function makeWorld(pieces: CoursePiece[] = straightHill, options: Record<string, unknown> = {}): World {
  return new World({
    course: buildCourse(pieces),
    seed: 0x1234,
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
    ...options,
  });
}

function roll(world: World, steps: number, packed = packControls({ steer: 0, push: 0, buttons: 0 })): void {
  const controls = [packed];
  for (let i = 0; i < steps; i++) world.advance(controls);
}

describe('starting a run', () => {
  it('places the ball on the start line, resting on the floor', () => {
    const world = makeWorld();
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(world.travelled[0]).toBe(0);
    expect(world.speedFor(0)).toBe(0);
  });

  it('holds the ball still while the countdown runs', () => {
    const world = makeWorld(straightHill, { countdownSeconds: 2 });
    expect(world.state[0]).toBe(RunState.Ready);
    roll(world, STEPS_PER_SECOND);
    expect(world.state[0]).toBe(RunState.Ready);
    expect(world.speedFor(0)).toBe(0);
    expect(world.elapsedSteps[0]).toBe(0);

    roll(world, STEPS_PER_SECOND + 1);
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(world.elapsedSteps[0]).toBeGreaterThan(0);
  });

  it('scatters some scenery to look at', () => {
    const world = makeWorld();
    expect(world.scenery.count).toBeGreaterThan(0);
  });
});

describe('rolling downhill', () => {
  it('picks up speed on its own', () => {
    const world = makeWorld();
    roll(world, STEPS_PER_SECOND * 2);
    expect(toNumber(world.speedFor(0))).toBeGreaterThan(1);
    expect(world.travelled[0]).toBeGreaterThan(0);
  });

  it('settles at a sensible top speed rather than running away', () => {
    const world = makeWorld([{ length: 400, drop: 12, width: 8, walls: true }]);
    roll(world, STEPS_PER_SECOND * 40);
    expect(toNumber(world.topSpeed[0])).toBeLessThan(34);
  });

  it('steers towards the side the player asks for', () => {
    const left = makeWorld();
    const right = makeWorld();
    roll(left, STEPS_PER_SECOND, packControls({ steer: -ONE, push: 0, buttons: 0 }));
    roll(right, STEPS_PER_SECOND, packControls({ steer: ONE, push: 0, buttons: 0 }));
    expect(left.sideways[0]).toBeLessThan(0);
    expect(right.sideways[0]).toBeGreaterThan(0);
  });

  it('goes faster when pushed and slower when held back', () => {
    const pushed = makeWorld();
    const braked = makeWorld();
    roll(pushed, STEPS_PER_SECOND * 3, packControls({ steer: 0, push: ONE, buttons: 0 }));
    roll(braked, STEPS_PER_SECOND * 3, packControls({ steer: 0, push: -ONE, buttons: 0 }));
    expect(pushed.travelled[0]).toBeGreaterThan(braked.travelled[0]);
  });

  it('is kept on the course by walls', () => {
    const world = makeWorld();
    roll(world, STEPS_PER_SECOND * 4, packControls({ steer: ONE, push: 0, buttons: 0 }));
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(Math.abs(toNumber(world.sideways[0]))).toBeLessThan(4.1);
  });

  it('goes back to the start after falling off a ledge with no walls', () => {
    const world = makeWorld(narrowLedge);
    let steps = 0;
    while (world.falls[0] === 0 && steps < STEPS_PER_SECOND * 30) {
      world.advance([packControls({ steer: ONE, push: 0, buttons: 0 })]);
      steps++;
    }
    expect(world.falls[0]).toBe(1);
    // Back at the start, still going, with the clock never having stopped.
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(world.travelled[0]).toBeLessThan(Math.round(4 * ONE));
    expect(world.speedFor(0)).toBe(0);
    expect(world.elapsedSteps[0]).toBe(steps);
  });

  it('finishes when it reaches the end', () => {
    const world = makeWorld();
    let steps = 0;
    while (world.state[0] === RunState.Rolling && steps < STEPS_PER_SECOND * 60) {
      world.advance([demoControls(world, 0)]);
      steps++;
    }
    expect(world.state[0]).toBe(RunState.Finished);
    expect(world.finishStep[0]).toBeGreaterThan(0);
    expect(world.secondsFor(0)).toBeGreaterThan(0);
  });

  it('reports how far along the course it is, from nothing to everything', () => {
    const world = makeWorld();
    expect(world.progressFor(0)).toBe(0);
    roll(world, STEPS_PER_SECOND * 3);
    const part = world.progressFor(0);
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThanOrEqual(ONE);
  });

  it('leaves the scenery alone: it is there to look at, nothing more', () => {
    const world = makeWorld();
    const before = world.scenery.count;
    let steps = 0;
    while (world.state[0] === RunState.Rolling && steps < STEPS_PER_SECOND * 60) {
      world.advance([demoControls(world, 0)]);
      steps++;
    }
    expect(world.scenery.count).toBe(before);
  });
});

describe('the same run every time', () => {
  it('two worlds given the same controls end up identical', () => {
    const a = makeWorld();
    const b = makeWorld();
    const controls = [packControls({ steer: Math.round(0.4 * ONE), push: 0, buttons: 0 })];
    for (let i = 0; i < 900; i++) {
      a.advance(controls);
      b.advance(controls);
    }
    expect(b.checksum()).toBe(a.checksum());
    expect(b.x[0]).toBe(a.x[0]);
    expect(b.travelled[0]).toBe(a.travelled[0]);
  });

  it('notices when one of them is nudged', () => {
    const a = makeWorld();
    const b = makeWorld();
    const straight = [packControls({ steer: 0, push: 0, buttons: 0 })];
    const nudged = [packControls({ steer: Math.round(0.05 * ONE), push: 0, buttons: 0 })];
    for (let i = 0; i < 200; i++) {
      a.advance(straight);
      b.advance(i === 100 ? nudged : straight);
    }
    expect(b.checksum()).not.toBe(a.checksum());
  });

  it('plays a recorded run back exactly', () => {
    const original = makeWorld();
    const recorded: number[] = [];
    for (let i = 0; i < 700; i++) {
      const packed = demoControls(original, 0);
      recorded.push(packed);
      original.advance([packed]);
    }

    const replayed = makeWorld();
    for (const packed of recorded) replayed.advance([packed]);
    expect(replayed.checksum()).toBe(original.checksum());
  });

  it('never once reaches for the clock or an unseeded random number', () => {
    // Both would break the promise that a run can be replayed exactly, so
    // they are worth guarding against directly.
    const realRandom = Math.random;
    const realNow = Date.now;
    let touched = 0;
    Math.random = () => {
      touched++;
      return 0.5;
    };
    Date.now = () => {
      touched++;
      return 0;
    };
    try {
      const world = makeWorld();
      roll(world, 400);
      world.checksum();
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
    expect(touched).toBe(0);
  });
});

describe('winding a run back', () => {
  it('returns to exactly where it was', () => {
    const world = makeWorld();
    const controls = [packControls({ steer: Math.round(0.3 * ONE), push: 0, buttons: 0 })];
    roll(world, 300);
    const mark = capture(world);
    const marked = world.checksum();

    roll(world, 200);
    expect(world.checksum()).not.toBe(marked);

    rewind(world, mark);
    expect(world.checksum()).toBe(marked);

    // And carrying on from there follows the same path as before.
    const afterFirst: number[] = [];
    for (let i = 0; i < 100; i++) {
      world.advance(controls);
      afterFirst.push(world.checksum());
    }
    rewind(world, mark);
    const afterSecond: number[] = [];
    for (let i = 0; i < 100; i++) {
      world.advance(controls);
      afterSecond.push(world.checksum());
    }
    expect(afterSecond).toEqual(afterFirst);
  });
});

describe('the ball the player built', () => {
  it('turns a round design into a better grip on the floor', () => {
    const round = ballFeelFrom(measureShape(defaultShape()));
    const boxy = ballFeelFrom(measureShape(cubeShape()));
    expect(round.gripScale).toBeGreaterThan(boxy.gripScale);
    expect(round.dragScale).toBeLessThan(boxy.dragScale);
    // A box carries more of its weight out at the corners, so it takes
    // longer to get spinning.
    expect(round.spinResistance).toBeLessThan(boxy.spinResistance);
  });

  it('makes a small design lighter than a large one', () => {
    const small = measureShape(pebbleShape());
    const large = measureShape(cubeShape());
    expect(small.weight).toBeLessThan(large.weight);
    expect(small.radius).toBeLessThan(large.radius);
  });

  it('still rolls the same course with a different ball', () => {
    const world = new World({
      course: buildCourse(straightHill),
      seed: 1,
      ball: measureShape(pebbleShape()),
      countdownSeconds: 0,
    });
    let steps = 0;
    while (world.state[0] === RunState.Rolling && steps < STEPS_PER_SECOND * 60) {
      world.advance([demoControls(world, 0)]);
      steps++;
    }
    expect(world.state[0]).toBe(RunState.Finished);
  });
});

describe('looking after scenery that is out of sight', () => {
  it('lets faraway groups sleep and wakes them again', () => {
    const world = makeWorld([{ length: 200, drop: 8, width: 8, walls: true }]);
    const atStart = world.awakeCount;
    roll(world, STEPS_PER_SECOND * 12);
    const later = world.awakeCount;
    expect(atStart).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(0);
    // Something must have been put aside on a course this long.
    expect(Math.min(atStart, later)).toBeLessThan(world.scenery.count);
  });

  it('does not change the outcome of a run', () => {
    const a = makeWorld([{ length: 200, drop: 8, width: 8, walls: true }]);
    const b = makeWorld([{ length: 200, drop: 8, width: 8, walls: true }]);
    for (let i = 0; i < 1500; i++) {
      a.advance([demoControls(a, 0)]);
      b.advance([demoControls(b, 0)]);
    }
    expect(b.travelled[0]).toBe(a.travelled[0]);
    expect(b.checksum()).toBe(a.checksum());
  });
});
