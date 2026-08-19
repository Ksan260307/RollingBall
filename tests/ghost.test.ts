/**
 * Racing your own best run.
 *
 * The ghost is the same machinery as a replay, shown at the same time as a
 * live run. Two things have to hold for it to be worth anything: it must
 * retrace the old run exactly, and it must not be able to affect the run
 * being made now. Both are tested here.
 */

import { describe, expect, it } from 'vitest';
import { ONE } from '../src/core/fixed';
import { packControls, unpackControls } from '../src/core/input';
import { demoControls } from '../src/game/demoDriver';
import { RunState } from '../src/core/simulation';
import { defaultShape, measureShape } from '../src/core/ballShape';
import { courseFor, STAGES } from '../src/game/stages';
import { Session, STEP_SECONDS, type SessionOptions } from '../src/game/session';
import { Ghost, usableGhost } from '../src/game/ghost';

function optionsFor(index = 0): SessionOptions {
  const stage = STAGES[index];
  return {
    stage,
    course: courseFor(stage),
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  };
}

function ghostOptionsFor(index = 0) {
  const stage = STAGES[index];
  return {
    stage,
    course: courseFor(stage),
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  };
}

/**
 * A complete run down the course, and the inputs that made it.
 *
 * Driven the same way the title screen drives itself, which gets down every
 * course in the game. Hand-rolled steering does not, and a ghost of a run
 * that never reached the bottom would test nothing worth testing.
 */
function recordRun(options: SessionOptions): number[] {
  const session = new Session(options);
  let step = 0;
  while (session.running && step < 120 * 180) {
    session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    step++;
  }
  expect(session.world.state[0]).toBe(RunState.Finished);
  return session.replay();
}

describe('the ghost of a best run', () => {
  it('retraces the old run exactly', () => {
    const options = optionsFor(0);
    const controls = recordRun(options);
    const again = new Session(options);
    for (const packed of controls) {
      if (!again.running) break;
      again.world.advance([packed]);
    }

    const ghost = new Ghost(ghostOptionsFor(0), controls);
    ghost.advance(controls.length);
    expect(ghost.world.checksum()).toBe(again.world.checksum());
    expect(ghost.done).toBe(true);
  });

  it('keeps level with a live run however the frames fall', () => {
    // The ghost takes the steps the live run took, not the time that passed,
    // so a stutter cannot put the two out of step with each other.
    const options = optionsFor(0);
    const controls = recordRun(options);

    const live = new Session(options);
    const ghost = new Ghost(ghostOptionsFor(0), controls);
    const gaps = [0.004, 0.05, 0.2, 0.008, 0.4];
    let frame = 0;
    while (live.running && frame < 60 * 600) {
      const before = live.world.step;
      live.update(gaps[frame % gaps.length], { steer: 0, push: 0, buttons: 0 });
      ghost.advance(live.world.step - before);
      frame++;
    }
    // Level to the step for as long as the old run had steps left to take,
    // and then it simply stops rather than carrying on making things up.
    expect(ghost.world.step).toBe(Math.min(live.world.step, controls.length));
    expect(ghost.done).toBe(true);
  });

  it('cannot touch the run being made now', () => {
    const options = optionsFor(1);
    const controls = recordRun(options);

    const withGhost = new Session(options);
    const ghost = new Ghost(ghostOptionsFor(1), controls);
    let steps = 0;
    while (withGhost.running && steps < 120 * 90) {
      const before = withGhost.world.step;
      withGhost.update(STEP_SECONDS, { steer: Math.round(0.3 * ONE), push: 0, buttons: 0 });
      ghost.advance(withGhost.world.step - before);
      steps++;
    }

    const alone = new Session(options);
    let aloneSteps = 0;
    while (alone.running && aloneSteps < 120 * 90) {
      alone.update(STEP_SECONDS, { steer: Math.round(0.3 * ONE), push: 0, buttons: 0 });
      aloneSteps++;
    }

    // Bit for bit the same run, ghost or no ghost.
    expect(withGhost.world.checksum()).toBe(alone.world.checksum());
    expect(withGhost.seconds).toBeCloseTo(alone.seconds, 6);
  });

  it('reports no difference against the run it came from', () => {
    // Racing the ghost of the run you are making is the one case where the
    // answer is known exactly: nothing in it, all the way down.
    const options = optionsFor(0);
    const controls = recordRun(options);
    const ghost = new Ghost(ghostOptionsFor(0), controls);

    const live = new Session(options);
    let steps = 0;
    let worst = 0;
    while (live.running && steps < 120 * 180) {
      live.update(STEP_SECONDS, unpackControls(demoControls(live.world, 0)));
      const gap = ghost.gapAt(live.world.travelled[0] / ONE, live.seconds);
      if (gap !== null) worst = Math.max(worst, Math.abs(gap));
      steps++;
    }
    // Within a twentieth of a second, which is under what the screen shows.
    expect(worst).toBeLessThan(0.08);
  });

  it('counts time lost as a plus and time gained as a minus', () => {
    const options = optionsFor(0);
    const controls = recordRun(options);
    const ghost = new Ghost(ghostOptionsFor(0), controls);

    // Find a mark the old run definitely reached, and the time it did it in.
    const at = ghost.gapAt(30, 0);
    expect(ghost.gapAt(0.5, 1)).toBeNull();
    expect(at).not.toBeNull();
    const wasSeconds = -(at as number);
    expect(wasSeconds).toBeGreaterThan(0);

    expect(ghost.gapAt(30, wasSeconds + 3) as number).toBeCloseTo(3, 6);
    expect(ghost.gapAt(30, wasSeconds - 2) as number).toBeCloseTo(-2, 6);
    expect(ghost.gapAt(30, wasSeconds) as number).toBeCloseTo(0, 6);
  });

  it('says nothing at the start line, or past where the old run reached', () => {
    const options = optionsFor(0);
    const controls = recordRun(options);
    const ghost = new Ghost(ghostOptionsFor(0), controls);
    expect(ghost.gapAt(0, 0)).toBeNull();
    expect(ghost.gapAt(-5, 1)).toBeNull();
    expect(ghost.gapAt(100000, 30)).toBeNull();
  });

  it('marks the course only going forward', () => {
    // Going over the edge puts the ball back at the start. The marks behind
    // it were reached once and must not be written over with a later time,
    // or the gap would flatter a run that fell off.
    const options = optionsFor(0);
    const controls = recordRun(options);
    const ghost = new Ghost(ghostOptionsFor(0), controls);
    const seen: number[] = [];
    for (let metre = 1; metre < 90; metre++) {
      const gap = ghost.gapAt(metre, 0);
      if (gap !== null) seen.push(-gap);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    }
  });

  it('runs out quietly rather than looping', () => {
    const options = optionsFor(0);
    const controls = recordRun(options);
    const ghost = new Ghost(ghostOptionsFor(0), controls);
    ghost.advance(controls.length * 2);
    expect(ghost.done).toBe(true);
    const settled = ghost.world.checksum();
    ghost.advance(500);
    expect(ghost.world.checksum()).toBe(settled);
    expect(ghost.world.state[0]).toBe(RunState.Finished);
    expect(ghost.metres).toBeGreaterThan(80);
  });
});

describe('deciding whether a stored run can be used', () => {
  it('turns down anything that is not a run', () => {
    expect(usableGhost(null)).toBe(false);
    expect(usableGhost('nope')).toBe(false);
    expect(usableGhost([])).toBe(false);
    expect(usableGhost([1, 2, 3])).toBe(false);
    expect(usableGhost(new Array(200).fill(1.5))).toBe(false);
  });

  it('accepts a real one', () => {
    const controls = new Array(400).fill(packControls({ steer: 0, push: 0, buttons: 0 }));
    expect(usableGhost(controls)).toBe(true);
  });
});
