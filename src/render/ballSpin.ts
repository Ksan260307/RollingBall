/**
 * How fast the drawn ball turns, and about which way.
 *
 * This is a single small function on purpose. The direction the ball appears
 * to turn has been got wrong more than once, in more than one place, and it
 * is not something the eye can be trusted to judge: a ball made of cubes has
 * fourfold symmetry, so at speed it can read as turning backwards even when
 * it is not, and drawing the inside of the ball by mistake reverses it too.
 *
 * With the whole answer in one place it can be checked by a test instead,
 * which is what tests/ballSpin.test.ts does.
 *
 * There is nothing to decide here: the rules already roll the ball forwards,
 * holding the point that touches the ground still, and the drawing simply
 * follows them.
 */

import { ONE } from '../core/fixed';
import { World } from '../core/simulation';

/** A turning speed in radians per second, about each axis. */
export interface DrawnSpin {
  x: number;
  y: number;
  z: number;
}

export function emptySpin(): DrawnSpin {
  return { x: 0, y: 0, z: 0 };
}

/**
 * Fills in the turning speed the drawn ball should use.
 *
 * @param out reused so that drawing a frame creates no rubbish
 */
export function drawnSpin(world: World, out: DrawnSpin, player = 0): DrawnSpin {
  out.x = world.spinX[player] / ONE;
  out.y = world.spinY[player] / ONE;
  out.z = world.spinZ[player] / ONE;
  return out;
}

/** How fast the ball is turning, all told, in radians per second. */
export function spinRate(spin: DrawnSpin): number {
  return Math.sqrt(spin.x * spin.x + spin.y * spin.y + spin.z * spin.z);
}
