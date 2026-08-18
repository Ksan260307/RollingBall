/**
 * A very plain robot driver.
 *
 * It rolls the ball down a course on the title screen so the menus have
 * something alive behind them, and the tests use the same driver to prove
 * that every course can actually be finished.
 *
 * It does exactly one thing: aim for the middle of the floor, easing off as
 * the ball already drifts back towards it. That is deliberately unclever, so
 * a course only a robot could clear is a course that needs redesigning.
 */

import { ONE, clamp, mul } from '../core/fixed';
import { packControls } from '../core/input';
import { World } from '../core/simulation';

/** How firmly the driver corrects for drifting sideways. */
const CORRECTION = Math.round(0.42 * ONE);

/** Works out the controls for the current moment. */
export function demoControls(world: World, player = 0): number {
  const drift = world.sideways[player] + mul(world.sidewaysSpeed[player], CORRECTION);
  const steer = clamp(-drift, -ONE, ONE);
  return packControls({ steer, push: 0, buttons: 0 });
}
