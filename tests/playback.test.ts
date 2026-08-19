/**
 * Watching a run again.
 *
 * The whole point of a replay here is that it is not a recording: it is the
 * same run happening again from the same inputs. So the thing worth testing
 * is that it really does come out the same, however the watcher chooses to
 * look at it — from the side, in slow motion, or all the way through twice.
 */

import { describe, expect, it } from 'vitest';
import { ONE } from '../src/core/fixed';
import { packControls } from '../src/core/input';
import { RunState } from '../src/core/simulation';
import { defaultShape, measureShape } from '../src/core/ballShape';
import { courseFor, STAGES } from '../src/game/stages';
import { Session, STEP_SECONDS, type SessionOptions } from '../src/game/session';
import { CAMERA_STYLES } from '../src/render/view';
import { PLAYBACK_SPEEDS, Playback } from '../src/game/playback';

const FRAME = 1 / 60;

function optionsFor(index = 0): SessionOptions {
  const stage = STAGES[index];
  return {
    stage,
    course: courseFor(stage),
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  };
}

/** Rolls a run with a fixed pattern of steering, and hands back the inputs. */
function recordRun(options: SessionOptions): { controls: number[]; session: Session } {
  const session = new Session(options);
  let step = 0;
  while (session.running && step < 120 * 60) {
    // Something with a bit of shape to it, so the line is not a straight one.
    const steer = Math.round(Math.sin(step / 90) * 0.6 * ONE);
    session.update(STEP_SECONDS, { steer, push: 0, buttons: 0 });
    step++;
  }
  return { controls: session.replay(), session };
}

describe('watching a run back', () => {
  it('retraces the run exactly, step for step', () => {
    const options = optionsFor(0);
    const { controls, session } = recordRun(options);
    expect(controls.length).toBeGreaterThan(60);

    const playback = new Playback(options, controls);
    let guard = 0;
    while (!playback.finished && guard < 60 * 300) {
      playback.advance(FRAME);
      guard++;
    }

    // Same place, same clock, same everything the results screen reports.
    expect(playback.session.summary().checksum).toBe(session.summary().checksum);
    expect(playback.session.seconds).toBeCloseTo(session.seconds, 5);
    expect(playback.session.world.state[0]).toBe(session.world.state[0]);
  });

  it('comes out the same whether it is watched slowly or quickly', () => {
    const options = optionsFor(1);
    const { controls } = recordRun(options);

    const marks = PLAYBACK_SPEEDS.map((speed) => {
      const playback = new Playback(options, controls);
      playback.speed = speed;
      // Turning the camera off keeps the drama slow-motion out of it too.
      playback.wandering = false;
      let guard = 0;
      while (!playback.finished && guard < 60 * 900) {
        playback.advance(FRAME);
        guard++;
      }
      return playback.session.summary().checksum;
    });

    expect(new Set(marks).size).toBe(1);
  });

  it('survives a stuttering frame rate without drifting', () => {
    const options = optionsFor(2);
    const { controls, session } = recordRun(options);

    const playback = new Playback(options, controls);
    let guard = 0;
    // Frames all over the place, including some very long ones.
    const gaps = [0.004, 0.016, 0.05, 0.2, 0.008, 0.4];
    while (!playback.finished && guard < 60 * 600) {
      playback.advance(gaps[guard % gaps.length]);
      guard++;
    }
    expect(playback.session.summary().checksum).toBe(session.summary().checksum);
  });

  it('plays the whole run and no more', () => {
    const options = optionsFor(0);
    const { controls } = recordRun(options);
    const playback = new Playback(options, controls);
    expect(playback.progress).toBe(0);
    let guard = 0;
    while (!playback.finished && guard < 60 * 300) {
      playback.advance(FRAME);
      guard++;
    }
    expect(playback.progress).toBeCloseTo(1, 2);
  });

  it('can be started over, and gives the same run again', () => {
    const options = optionsFor(0);
    const { controls } = recordRun(options);
    const playback = new Playback(options, controls);

    const runThrough = (): number => {
      let guard = 0;
      while (!playback.finished && guard < 60 * 300) {
        playback.advance(FRAME);
        guard++;
      }
      return playback.session.summary().checksum;
    };

    const first = runThrough();
    playback.restart();
    expect(playback.progress).toBe(0);
    expect(playback.session.world.state[0]).not.toBe(RunState.Finished);
    expect(runThrough()).toBe(first);
  });
});

describe('the end of a replay', () => {
  it('stops reporting steps once the run is over', () => {
    // Whatever happened at the finish happened once. A replay sitting on
    // the ending must not keep handing the same moment out to be played
    // again on every frame, or the finish sounds for ever.
    const options = optionsFor(0);
    const { controls } = recordRun(options);
    const playback = new Playback(options, controls);

    let played = 0;
    let guard = 0;
    while (!playback.finished && guard < 60 * 300) {
      played += playback.advance(FRAME);
      guard++;
    }
    expect(played).toBe(controls.length);

    // And nothing at all after that, however long we sit there.
    for (let i = 0; i < 200; i++) expect(playback.advance(FRAME)).toBe(0);
  });

  it('plays each stored step exactly once', () => {
    const options = optionsFor(1);
    const { controls } = recordRun(options);
    const playback = new Playback(options, controls);
    let played = 0;
    let guard = 0;
    while (!playback.finished && guard < 60 * 600) {
      played += playback.advance(0.05);
      guard++;
    }
    expect(played).toBe(controls.length);
  });
});

describe('the camera during a replay', () => {
  it('starts behind the ball and then goes wandering', () => {
    const options = optionsFor(0);
    const { controls } = recordRun(options);
    const playback = new Playback(options, controls);
    expect(playback.angle).toBe('chase');

    const seen = new Set<string>();
    let guard = 0;
    while (!playback.finished && guard < 60 * 300) {
      playback.advance(FRAME);
      seen.add(playback.angle);
      guard++;
    }
    // More than one place to watch from, and all of them real ones.
    expect(seen.size).toBeGreaterThan(2);
    for (const angle of seen) {
      expect(CAMERA_STYLES).toContain(angle);
    }
  });

  it('stops wandering once the watcher picks an angle themselves', () => {
    const options = optionsFor(0);
    const { controls } = recordRun(options);
    const playback = new Playback(options, controls);
    playback.nextAngle();
    const chosen = playback.angle;
    expect(playback.wandering).toBe(false);
    for (let i = 0; i < 60 * 20; i++) playback.advance(FRAME);
    expect(playback.angle).toBe(chosen);
  });

  it('steps round the angles and comes back to where it started', () => {
    const options = optionsFor(0);
    const playback = new Playback(options, [packControls({ steer: 0, push: 0, buttons: 0 })]);
    const first = playback.angle;
    for (let i = 0; i < CAMERA_STYLES.length; i++) playback.nextAngle();
    expect(playback.angle).toBe(first);
  });

  it('steps round the speeds and comes back to ordinary', () => {
    const options = optionsFor(0);
    const playback = new Playback(options, [packControls({ steer: 0, push: 0, buttons: 0 })]);
    expect(playback.speed).toBe(1);
    for (let i = 0; i < PLAYBACK_SPEEDS.length; i++) playback.nextSpeed();
    expect(playback.speed).toBe(1);
    for (const speed of PLAYBACK_SPEEDS) expect(speed).toBeGreaterThan(0);
  });
});

describe('a replay with nothing in it', () => {
  it('is finished before it starts, and does not fall over', () => {
    const playback = new Playback(optionsFor(0), []);
    expect(playback.finished).toBe(true);
    expect(playback.progress).toBe(1);
    playback.advance(FRAME);
    expect(playback.session.alpha).toBe(1);
  });
});
