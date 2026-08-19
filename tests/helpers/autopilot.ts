/**
 * Test helper: play a whole run with the robot driver the title screen uses.
 * Sharing that driver means the tests exercise shipped code rather than a
 * lookalike written just for them.
 */

import { ONE } from '../../src/core/fixed';
import { demoControls } from '../../src/game/demoDriver';
import { RunState, STEPS_PER_SECOND, World } from '../../src/core/simulation';

export { demoControls as autopilotControls };

export interface RunResult {
  state: number;
  seconds: number;
  metres: number;
  topSpeed: number;
  steps: number;
  checksum: number;
}

/** Plays a whole run with the robot driver and reports what happened. */
export function runWithAutopilot(world: World, limitSeconds = 120): RunResult {
  const controls = [0, 0, 0, 0];
  let steps = 0;
  const limit = limitSeconds * STEPS_PER_SECOND;
  while (
    (world.state[0] === RunState.Rolling || world.state[0] === RunState.Ready) &&
    steps < limit
  ) {
    controls[0] = demoControls(world, 0);
    world.advance(controls);
    steps++;
  }
  return {
    state: world.state[0],
    seconds: world.secondsFor(0),
    metres: world.travelled[0] / ONE,
    topSpeed: world.topSpeed[0] / ONE,
    steps,
    checksum: world.checksum(),
  };
}
