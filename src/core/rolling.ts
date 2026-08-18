/**
 * The maths of a ball that really rolls.
 *
 * Up to now the ball was pushed about as a single point and the spinning was
 * only drawn on afterwards. Here the spin is part of the physics: the ball
 * has a turning speed of its own, the ground grips it at the single point
 * where they touch, and that grip is what converts sliding into rolling.
 *
 * Two consequences fall straight out of this, and both are worth having:
 *
 *  - A ball only speeds up down a slope as fast as the ground can spin it up.
 *    A ball with its weight near the middle gets going quickly; one with its
 *    weight out at the rim is sluggish. That comes from the shape the player
 *    built, not from a number somebody picked.
 *  - On a slippery floor the grip runs out, so the ball skids: it slides
 *    without spinning, and you can see it happening.
 *
 * Everything is whole-number arithmetic, like the rest of the rules.
 */

import { ONE, div, length3, mul } from './fixed';

/** A value with three parts, reused so that nothing is thrown away each step. */
export interface Triple {
  x: number;
  y: number;
  z: number;
}

export function triple(x = 0, y = 0, z = 0): Triple {
  return { x, y, z };
}

/** How much two directions agree, from -ONE (opposite) to ONE (identical). */
export function dot(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  return mul(ax, bx) + mul(ay, by) + mul(az, bz);
}

/**
 * The turning product of two values: a third direction square to both, whose
 * size grows with how far apart they point. It is what links a turning speed
 * to the speed of a point on the surface.
 */
export function crossInto(
  out: Triple,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): Triple {
  // Written out into locals first, so that passing `out` as an input is safe.
  const x = mul(ay, bz) - mul(az, by);
  const y = mul(az, bx) - mul(ax, bz);
  const z = mul(ax, by) - mul(ay, bx);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/**
 * How fast the ball is sliding across the ground.
 *
 * The point of the ball that is touching the floor is not moving at the same
 * speed as the ball as a whole: the spin adds to it. When the two cancel out
 * exactly the ball is rolling cleanly; whatever is left over is a skid.
 *
 * @param out    filled in with the skid, and returned
 * @param radius how far the touching point is below the middle of the ball
 */
export function slipInto(
  out: Triple,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  spinX: number,
  spinY: number,
  spinZ: number,
  upX: number,
  upY: number,
  upZ: number,
  radius: number,
): Triple {
  // The touching point sits one radius below the middle, against the floor.
  const armX = -mul(upX, radius);
  const armY = -mul(upY, radius);
  const armZ = -mul(upZ, radius);
  crossInto(out, spinX, spinY, spinZ, armX, armY, armZ);
  let x = velocityX + out.x;
  let y = velocityY + out.y;
  let z = velocityZ + out.z;
  // Only movement along the floor counts as a skid; movement into or out of
  // the floor is somebody else's problem.
  const intoFloor = dot(x, y, z, upX, upY, upZ);
  x -= mul(upX, intoFloor);
  y -= mul(upY, intoFloor);
  z -= mul(upZ, intoFloor);
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

/**
 * How much of a skid one shove from the ground can take out, as a share of
 * the skid itself.
 *
 * A ball resists being pushed and resists being spun up, and the ground has
 * to overcome both at once. For a ball with its weight spread evenly this
 * works out at a bit over a quarter, which is why a rolling ball only picks
 * up five sevenths of the speed a sliding one would.
 *
 * @param spinResistance how hard this ball is to spin up, from its shape
 */
export function gripShare(spinResistance: number): number {
  if (spinResistance <= 0) return ONE;
  return div(spinResistance, spinResistance + ONE);
}

/**
 * How much the spin changes when the ground shoves the ball sideways.
 *
 * The shove lands at the bottom of the ball rather than through the middle,
 * so it turns the ball as well as moving it.
 *
 * @param out            filled in with the change in turning speed
 * @param changeX/Y/Z    how much the ground changed the ball's travel
 * @param upX/Y/Z        which way is out of the floor
 * @param spinResistance how hard this ball is to spin up
 * @param radius         how far the touching point is below the middle
 */
export function spinChangeInto(
  out: Triple,
  changeX: number,
  changeY: number,
  changeZ: number,
  upX: number,
  upY: number,
  upZ: number,
  spinResistance: number,
  radius: number,
): Triple {
  crossInto(out, upX, upY, upZ, changeX, changeY, changeZ);
  const scale = mul(spinResistance, radius);
  if (scale <= 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  out.x = -div(out.x, scale);
  out.y = -div(out.y, scale);
  out.z = -div(out.z, scale);
  return out;
}

/**
 * The turning speed a cleanly rolling ball would have at this travelling
 * speed. Used to check the rules are behaving, and to settle the ball down
 * when it is barely moving.
 */
export function rollingSpinInto(
  out: Triple,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  upX: number,
  upY: number,
  upZ: number,
  radius: number,
): Triple {
  crossInto(out, upX, upY, upZ, velocityX, velocityY, velocityZ);
  if (radius <= 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return out;
  }
  out.x = div(out.x, radius);
  out.y = div(out.y, radius);
  out.z = div(out.z, radius);
  return out;
}

/** How fast a three-part value is going, all told. */
export function magnitude(x: number, y: number, z: number): number {
  return length3(x, y, z);
}
