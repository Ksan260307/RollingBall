/**
 * Which way the ball appears to turn.
 *
 * This has been got wrong more than once, so it is checked here rather than
 * by eye. The eye is a poor judge of it: a ball built from cubes repeats its
 * pattern four times a revolution, so at speed it can read as turning
 * backwards even when it is not.
 *
 * These tests go all the way through the drawing path. They take the turning
 * speed the picture uses, turn it into the same quaternion step the renderer
 * applies each frame, and then follow a marked point on the ball's surface.
 * The quaternion maths is plain arithmetic, so none of this needs a graphics
 * card, and a wrong sign anywhere along the way shows up here.
 *
 * Rolling forwards means two things, both checked below:
 *   - the point touching the ground stands still;
 *   - the top of the ball runs ahead, at the speed the ball is travelling.
 */

import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { buildCourse } from '../src/core/course';
import { ONE, toNumber } from '../src/core/fixed';
import { defaultShape, measureShape } from '../src/core/ballShape';
import { packControls } from '../src/core/input';
import { STEPS_PER_SECOND, World } from '../src/core/simulation';
import { drawnSpin, emptySpin, spinRate } from '../src/render/ballSpin';
import { STAGES, courseFor } from '../src/game/stages';

const NEUTRAL = packControls({ steer: 0, push: 0, buttons: 0 });

function rollingWorld(drop = 8, width = 14): World {
  return new World({
    course: buildCourse([{ length: 400, drop, width, walls: true }]),
    seed: 7,
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  });
}

function roll(world: World, steps: number, packed = NEUTRAL): void {
  for (let i = 0; i < steps; i++) world.advance([packed]);
}

/** The one-frame turn the renderer applies, worked out the same way it does. */
function frameTurn(world: World, seconds: number): Quaternion {
  const spin = drawnSpin(world, emptySpin());
  const rate = spinRate(spin);
  if (rate <= 1e-5) return new Quaternion();
  return new Quaternion().setFromAxisAngle(
    new Vector3(spin.x / rate, spin.y / rate, spin.z / rate),
    rate * seconds,
  );
}

/** Which way is out of the floor, where the ball currently is. */
function upAt(world: World): Vector3 {
  const point = world.hintFor(0);
  return new Vector3(
    world.course.upX[point] / ONE,
    world.course.upY[point] / ONE,
    world.course.upZ[point] / ONE,
  ).normalize();
}

function travelOf(world: World): Vector3 {
  return new Vector3(
    world.velocityX[0] / ONE,
    world.velocityY[0] / ONE,
    world.velocityZ[0] / ONE,
  );
}

/**
 * How a point stuck to the ball moves, over one frame of drawing, relative
 * to the ball itself.
 */
function surfaceMotion(world: World, offset: Vector3, seconds: number): Vector3 {
  const turn = frameTurn(world, seconds);
  const after = offset.clone().applyQuaternion(turn);
  return after.sub(offset).divideScalar(seconds);
}

describe('the way the drawn ball turns', () => {
  it('runs the top of the ball forwards, at the speed the ball travels', () => {
    const stats = measureShape(defaultShape());
    const world = rollingWorld();
    roll(world, STEPS_PER_SECOND * 3);

    const speed = toNumber(world.speedFor(0));
    expect(speed).toBeGreaterThan(2);

    const radius = toNumber(stats.radius);
    const top = upAt(world).multiplyScalar(radius);
    const motion = surfaceMotion(world, top, 1 / 240);
    const along = motion.dot(travelOf(world).normalize());

    // Forwards, not backwards.
    expect(along).toBeGreaterThan(0);
    // And at the travelling speed, which is what rolling cleanly means.
    expect(along).toBeCloseTo(speed, 0);
  });

  it('holds the point touching the ground still', () => {
    const stats = measureShape(defaultShape());
    const world = rollingWorld();
    roll(world, STEPS_PER_SECOND * 3);

    const radius = toNumber(stats.radius);
    const bottom = upAt(world).multiplyScalar(-radius);
    // The ground contact moves backwards relative to the ball at exactly the
    // speed the ball moves forwards, so the two cancel and it stands still.
    const overGround = surfaceMotion(world, bottom, 1 / 240).add(travelOf(world));

    expect(overGround.length()).toBeLessThan(toNumber(world.speedFor(0)) * 0.1);
  });

  it('would fail loudly if the drawn turn were reversed', () => {
    // A guard on the guard: with the turn flipped, the checks above must not
    // still pass. Without this a test that measured nothing would look fine.
    const stats = measureShape(defaultShape());
    const world = rollingWorld();
    roll(world, STEPS_PER_SECOND * 3);

    const speed = toNumber(world.speedFor(0));
    const radius = toNumber(stats.radius);
    const top = upAt(world).multiplyScalar(radius);
    const reversed = surfaceMotion(world, top, 1 / 240).negate();
    const along = reversed.dot(travelOf(world).normalize());

    expect(along).toBeLessThan(0);
    expect(along).toBeCloseTo(-speed, 0);
  });

  it('turns about the sideways axis while running straight', () => {
    const world = rollingWorld();
    roll(world, STEPS_PER_SECOND * 3);

    const point = world.hintFor(0);
    const course = world.course;
    const right = new Vector3(
      course.rightX[point] / ONE,
      course.rightY[point] / ONE,
      course.rightZ[point] / ONE,
    ).normalize();
    const forward = new Vector3(
      course.forwardX[point] / ONE,
      course.forwardY[point] / ONE,
      course.forwardZ[point] / ONE,
    ).normalize();

    const spin = drawnSpin(world, emptySpin());
    const axis = new Vector3(spin.x, spin.y, spin.z);
    // Rolling along the course is a turn about the sideways axis, and hardly
    // anything about the forward one.
    expect(Math.abs(axis.dot(right))).toBeGreaterThan(axis.length() * 0.95);
    expect(Math.abs(axis.dot(forward))).toBeLessThan(axis.length() * 0.2);
  });

  it('turns the other way when the ball is sent the other way', () => {
    const world = rollingWorld();
    roll(world, STEPS_PER_SECOND * 3);
    const forwards = drawnSpin(world, emptySpin());

    // Send an identical ball backwards along the same course by hand.
    const other = rollingWorld();
    roll(other, STEPS_PER_SECOND * 3);
    other.velocityX[0] = -other.velocityX[0];
    other.velocityY[0] = -other.velocityY[0];
    other.velocityZ[0] = -other.velocityZ[0];
    other.spinX[0] = 0;
    other.spinY[0] = 0;
    other.spinZ[0] = 0;
    // One step is enough for the ground to spin it up the other way.
    other.advance([NEUTRAL]);
    const backwards = drawnSpin(other, emptySpin());

    const together = forwards.x * backwards.x + forwards.y * backwards.y + forwards.z * backwards.z;
    expect(together).toBeLessThan(0);
  });

  it('keeps the drawing in step with the rules on every course', () => {
    for (const stage of STAGES) {
      const world = new World({
        course: courseFor(stage),
        seed: stage.seed,
        ball: measureShape(defaultShape()),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      roll(world, STEPS_PER_SECOND * 4);
      const spin = drawnSpin(world, emptySpin());
      // Whatever the rules say, the picture says the same. No correction, no
      // flipping, nothing to drift out of step.
      expect(spin.x).toBe(world.spinX[0] / ONE);
      expect(spin.y).toBe(world.spinY[0] / ONE);
      expect(spin.z).toBe(world.spinZ[0] / ONE);

      const radius = toNumber(measureShape(defaultShape()).radius);
      const top = upAt(world).multiplyScalar(radius);
      const along = surfaceMotion(world, top, 1 / 240).dot(travelOf(world).normalize());
      expect(along).toBeGreaterThan(0);
    }
  });
});
