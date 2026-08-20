/**
 * Handing a run to somebody else.
 *
 * A challenge has to arrive as the same run it left as — the same course,
 * the same ball, the same inputs — or the person receiving it is racing
 * something that never happened.
 */

import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import { unpackControls } from '../src/core/input';
import { defaultShape, measureShape, randomShape } from '../src/core/ballShape';
import { RunState } from '../src/core/simulation';
import { courseFor, STAGES } from '../src/game/stages';
import { Session, STEP_SECONDS } from '../src/game/session';
import { demoControls } from '../src/game/demoDriver';
import { Ghost } from '../src/game/ghost';
import {
  challengeFromLink,
  challengeLink,
  readChallenge,
  writeChallenge,
} from '../src/game/challenge';
import type { BallDesign } from '../src/game/storage';

function ballOf(voxels: Uint8Array): BallDesign {
  return {
    voxels,
    photo: null,
    photoStrength: 0.85,
    shine: 0.4,
    mixed: ['#28dcff'],
    weightAt: { sideways: 0.25, up: -0.5 },
  };
}

/** A whole run down a course, and what it took. */
function makeRun(index = 0) {
  const stage = STAGES[index];
  const design = ballOf(defaultShape());
  const session = new Session({
    stage,
    course: courseFor(stage),
    ball: measureShape(design.voxels, design.weightAt),
    countdownSeconds: 3,
  });
  let steps = 0;
  while (session.running && steps < 120 * 200) {
    session.update(STEP_SECONDS, unpackControls(demoControls(session.world, 0)));
    steps++;
  }
  expect(session.world.state[0]).toBe(RunState.Finished);
  return { stage, design, controls: session.replay(), seconds: session.seconds };
}

describe('writing a run down', () => {
  it('gives back the same run it was given', async () => {
    const { stage, design, controls, seconds } = makeRun(0);
    const text = await writeChallenge(stage.id, 0, seconds, design, controls);
    const back = await readChallenge(text);
    expect(back).not.toBeNull();
    expect(back!.courseId).toBe(stage.id);
    expect(back!.seconds).toBeCloseTo(seconds, 2);
    expect(back!.controls).toEqual(controls);
  });

  it('carries the ball, because the run means nothing without it', async () => {
    // The same steering given to a different ball goes somewhere else.
    const { stage, controls, seconds } = makeRun(0);
    const design = ballOf(randomShape(9));
    const back = await readChallenge(
      await writeChallenge(stage.id, 0, seconds, design, controls),
    );
    expect(Array.from(back!.ball.voxels)).toEqual(Array.from(design.voxels));
    expect(back!.ball.weightAt).toEqual(design.weightAt);
  });

  it('replays as exactly the run that was handed over', async () => {
    const { stage, design, controls } = makeRun(1);
    const back = await readChallenge(await writeChallenge(stage.id, 0, 0, design, controls));

    const ghost = new Ghost(
      {
        stage,
        course: courseFor(stage),
        ball: measureShape(back!.ball.voxels, back!.ball.weightAt),
        countdownSeconds: 3,
      },
      back!.controls,
    );
    ghost.advance(back!.controls.length);

    const again = new Session({
      stage,
      course: courseFor(stage),
      ball: measureShape(design.voxels, design.weightAt),
      countdownSeconds: 3,
    });
    for (const packed of controls) {
      if (!again.running) break;
      again.world.advance([packed]);
    }
    expect(ghost.world.checksum()).toBe(again.world.checksum());
  });

  it('turns down anything that is not a challenge', async () => {
    expect(await readChallenge('')).toBeNull();
    expect(await readChallenge('hello')).toBeNull();
    expect(await readChallenge('C1!meadow!0!1.0')).toBeNull();
    expect(await readChallenge('C1!meadow!0!1.0!nonsense!AAAA!1')).toBeNull();
    expect(await readChallenge(`C1!x!0!1!${'A'.repeat(30000)}!AAAA!0`)).toBeNull();
  });

  it('survives the bar the ball recipe already uses', async () => {
    // A recipe writes the weight as "0.25|-0.5". Splitting a challenge on
    // that same bar tore the ball in half on the way back in.
    const { stage, design, controls, seconds } = makeRun(0);
    const text = await writeChallenge(stage.id, 0, seconds, design, controls);
    expect(text).toContain('|');
    expect(await readChallenge(text)).not.toBeNull();
  });
});

describe('handing a run over by web address', () => {
  it('carries it, and can be read back off the address', async () => {
    const { stage, design, controls, seconds } = makeRun(0);
    const link = await challengeLink(
      stage.id, 0, seconds, design, controls, 'https://example.test/g/?old=1#here',
    );
    expect(link.startsWith('https://example.test/g/?run=')).toBe(true);
    const held = challengeFromLink(link.slice(link.indexOf('?')));
    const back = await readChallenge(decodeURIComponent(held!));
    expect(back!.controls).toEqual(controls);
  });

  it('finds nothing in an address that carries nothing', () => {
    expect(challengeFromLink('')).toBeNull();
    expect(challengeFromLink('?ball=abc')).toBeNull();
    expect(challengeFromLink('?run=')).toBeNull();
  });
});

describe('the picture somebody points a camera at', () => {
  it('fits a whole run, and reads back as the address it was made from', async () => {
    const { stage, design, controls, seconds } = makeRun(0);
    const link = await challengeLink(stage.id, 0, seconds, design, controls, 'https://e.test/g/');

    const code = qrcode(0, 'L');
    code.addData(link);
    code.make();
    const across = code.getModuleCount();
    const cell = 3;
    const edge = cell * 2;
    const size = across * cell + edge * 2;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let row = 0; row < across; row++) {
      for (let column = 0; column < across; column++) {
        if (!code.isDark(row, column)) continue;
        for (let y = 0; y < cell; y++) {
          for (let x = 0; x < cell; x++) {
            const at = ((edge + row * cell + y) * size + (edge + column * cell + x)) * 4;
            pixels[at] = 0;
            pixels[at + 1] = 0;
            pixels[at + 2] = 0;
          }
        }
      }
    }
    expect(jsQR(pixels, size, size)?.data).toBe(link);
  });

  it('stays inside what a run is allowed to weigh', async () => {
    const { stage, design, controls, seconds } = makeRun(0);
    const link = await challengeLink(stage.id, 0, seconds, design, controls, 'https://e.test/g/');
    // Two thousand characters is about as much as an address is safe at.
    expect(link.length).toBeLessThan(2000);
    expect(controls.length * 4).toBeGreaterThan(link.length);
  });
});
