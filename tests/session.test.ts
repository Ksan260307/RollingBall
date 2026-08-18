import { describe, expect, it } from 'vitest';
import { ONE } from '../src/core/fixed';
import { defaultShape, measureShape } from '../src/core/ballShape';
import { NEUTRAL, unpackControls } from '../src/core/input';
import { RunState, STEPS_PER_SECOND } from '../src/core/simulation';
import { STEP_SECONDS, Session, replayRun } from '../src/game/session';
import { demoControls } from '../src/game/demoDriver';
import { STAGES, courseFor } from '../src/game/stages';

function newSession(countdownSeconds = 0): Session {
  const stage = STAGES[0];
  return new Session({
    stage,
    course: courseFor(stage),
    ball: measureShape(defaultShape()),
    countdownSeconds,
  });
}

describe('keeping an attempt running', () => {
  it('takes exactly the steps the elapsed time is worth', () => {
    const session = newSession();
    session.update(STEP_SECONDS * 10, NEUTRAL);
    expect(session.world.step).toBe(10);
    session.update(STEP_SECONDS * 2.5, NEUTRAL);
    expect(session.world.step).toBe(12);
  });

  it('keeps the leftover time for the next frame instead of losing it', () => {
    const session = newSession();
    for (let i = 0; i < 60; i++) session.update(1 / 60, NEUTRAL);
    // A second of frames at sixty a second is a second of steps.
    expect(session.world.step).toBeGreaterThan(STEPS_PER_SECOND - 3);
    expect(session.world.step).toBeLessThanOrEqual(STEPS_PER_SECOND);
  });

  it('reports how far between steps the picture should sit', () => {
    const session = newSession();
    session.update(STEP_SECONDS * 1.5, NEUTRAL);
    expect(session.alpha).toBeGreaterThan(0.4);
    expect(session.alpha).toBeLessThan(0.6);
  });

  it('refuses to catch up on a huge gap all at once', () => {
    const session = newSession();
    session.update(30, NEUTRAL);
    // A tab left in the background must not stall the game on its return.
    expect(session.world.step).toBeLessThanOrEqual(10);
  });

  it('does nothing at all while paused', () => {
    const session = newSession();
    session.paused = true;
    session.update(1, NEUTRAL);
    expect(session.world.step).toBe(0);
  });

  it('remembers where the ball was, so the picture can be smoothed', () => {
    const session = newSession();
    session.update(STEP_SECONDS * 40, NEUTRAL);
    expect(session.previous.z).not.toBe(session.world.z[0]);
  });

  it('counts down before letting the ball go', () => {
    const session = newSession(3);
    expect(session.countdownSeconds).toBe(3);
    // Fed one frame at a time, the way the real loop feeds it.
    for (let i = 0; i < 70; i++) session.update(1 / 60, NEUTRAL);
    expect(session.countdownSeconds).toBeLessThan(3);
    expect(session.world.state[0]).toBe(RunState.Ready);

    for (let i = 0; i < 180; i++) session.update(1 / 60, NEUTRAL);
    expect(session.countdownSeconds).toBe(0);
    expect(session.world.state[0]).toBe(RunState.Rolling);
  });
});

describe('finishing an attempt', () => {
  it('says how it went', () => {
    const session = newSession();
    while (session.running) {
      session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    }
    const summary = session.summary();
    expect(summary.finished).toBe(true);
    expect(summary.stageId).toBe(STAGES[0].id);
    expect(summary.seconds).toBeGreaterThan(0);
    expect(summary.metres).toBeGreaterThan(90);
    expect(summary.topSpeed).toBeGreaterThan(1);
    expect(session.outcome).toBe('finished');
  });

  it('starts over cleanly', () => {
    const session = newSession();
    for (let i = 0; i < 400; i++) {
      session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    }
    const before = session.world.checksum();
    session.restart();
    expect(session.world.step).toBe(0);
    expect(session.seconds).toBe(0);
    expect(session.world.checksum()).not.toBe(before);

    for (let i = 0; i < 400; i++) {
      session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    }
    expect(session.world.checksum()).toBe(before);
  });
});

describe('replays', () => {
  it('plays a saved attempt back to exactly the same result', () => {
    const stage = STAGES[1];
    const options = {
      stage,
      course: courseFor(stage),
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    };
    const session = new Session(options);
    while (session.running) {
      session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    }
    const original = session.summary();
    const saved = session.replay();
    expect(saved.length).toBeGreaterThan(100);

    const played = replayRun(options, saved);
    expect(played.checksum).toBe(original.checksum);
    expect(played.seconds).toBe(original.seconds);
    expect(played.finished).toBe(original.finished);
  });

  it('keeps a whole run small enough to save', () => {
    const session = newSession();
    while (session.running) {
      session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    }
    const saved = session.replay();
    // One small whole number per step is all a run costs.
    expect(saved.every((value) => Number.isInteger(value) && value <= 0xffffff)).toBe(true);
    expect(saved.length).toBeLessThan(STEPS_PER_SECOND * 120);
  });
});

describe('a ball that misses the course', () => {
  it('ends the attempt', () => {
    const stage = STAGES[2];
    const session = new Session({
      stage,
      course: courseFor(stage),
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    while (session.running) {
      session.update(STEP_SECONDS, { steer: ONE, push: 0, buttons: 0 });
    }
    expect(session.outcome).toBe('fallen');
    expect(session.summary().finished).toBe(false);
  });
});
