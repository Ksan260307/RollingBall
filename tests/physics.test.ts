/**
 * These tests check the ball against physics, not against whatever the code
 * happens to do. The figures they compare with are worked out from the slope
 * and the ball, so if the rules ever drift away from how a real ball behaves,
 * they say so.
 */

import { describe, expect, it } from 'vitest';
import { Surface, SurfaceValue, buildCourse, placeOnCourse } from '../src/core/course';
import { ONE, div, mul, toNumber } from '../src/core/fixed';
import {
  SHAPE_CELLS,
  SHAPE_CENTRE,
  SHAPE_SIZE,
  cellIndex,
  cubeShape,
  defaultShape,
  measureShape,
  pebbleShape,
} from '../src/core/ballShape';
import { packControls } from '../src/core/input';
import { crossInto, dot, magnitude, triple } from '../src/core/rolling';
import { RunState, STEPS_PER_SECOND, World, ballFeelFrom } from '../src/core/simulation';

const GRAVITY = 9.80665;
const NEUTRAL = packControls({ steer: 0, push: 0, buttons: 0 });

/** A ball with its weight pushed out to the rim: slow to get going. */
function shellShape(): Uint8Array {
  const voxels = new Uint8Array(SHAPE_CELLS);
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const dx = x - SHAPE_CENTRE;
        const dy = y - SHAPE_CENTRE;
        const dz = z - SHAPE_CENTRE;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (distance <= 4.35 && distance >= 3.3) voxels[cellIndex(x, y, z)] = 5;
      }
    }
  }
  return voxels;
}

function slopeWorld(
  drop: number,
  surface: SurfaceValue = Surface.Normal,
  voxels = defaultShape(),
): World {
  return new World({
    course: buildCourse([{ length: 400, drop, width: 14, walls: true, surface }]),
    seed: 7,
    ball: measureShape(voxels),
    countdownSeconds: 0,
  });
}

/** A very wide floor, so that walls cannot interfere with a measurement. */
function wideWorld(drop: number, surface: SurfaceValue = Surface.Normal): World {
  return new World({
    course: buildCourse([{ length: 400, drop, width: 90, surface }]),
    seed: 7,
    ball: measureShape(defaultShape()),
    countdownSeconds: 0,
  });
}

function roll(world: World, steps: number, packed = NEUTRAL): void {
  const controls = [packed];
  for (let i = 0; i < steps; i++) world.advance(controls);
}

describe('a ball rolling down a slope', () => {
  it('speeds up at the rate a rolling ball does, not a sliding one', () => {
    const drop = 10;
    const stats = measureShape(defaultShape());
    const world = slopeWorld(drop);

    roll(world, STEPS_PER_SECOND);
    const first = toNumber(world.speedFor(0));
    roll(world, STEPS_PER_SECOND);
    const second = toNumber(world.speedFor(0));
    const measured = second - first;

    const slope = (drop * Math.PI) / 180;
    const sliding = GRAVITY * Math.sin(slope);
    const spinResistance = toNumber(stats.spinResistance);
    // A rolling ball has to spin itself up as well as move, so it only gets
    // a share of what a frictionless sliding one would.
    const rolling = sliding / (1 + spinResistance);
    const feel = ballFeelFrom(stats);
    const rollingDrag = 0.03 * toNumber(feel.dragScale) * GRAVITY * Math.cos(slope);

    expect(measured).toBeLessThan(sliding * 0.95);
    expect(measured).toBeCloseTo(rolling - rollingDrag, 1);
  });

  it('turns exactly as fast as it travels, once it is rolling cleanly', () => {
    const stats = measureShape(defaultShape());
    const world = slopeWorld(8);
    roll(world, STEPS_PER_SECOND * 3);

    const travel = toNumber(world.speedFor(0));
    const turning = toNumber(world.spinFor(0));
    const radius = toNumber(stats.radius);
    expect(travel).toBeGreaterThan(1);
    // Rolling cleanly means the outside of the ball keeps pace with the ground.
    expect(turning * radius).toBeCloseTo(travel, 1);
    expect(toNumber(world.skidFor(0))).toBeLessThan(0.05);
  });

  it('starts out with no spin at all', () => {
    const world = slopeWorld(8);
    expect(world.spinFor(0)).toBe(0);
  });

  it('turns forwards, with the top of the ball running ahead', () => {
    // The direction the ball turns is the one thing a player watches, so it
    // is worth pinning down rather than trusting. On a ball rolling forwards
    // the top of it moves the same way the ball is going, at the travelling
    // speed, while the point touching the ground stands still.
    const stats = measureShape(defaultShape());
    const world = slopeWorld(8);
    roll(world, STEPS_PER_SECOND * 3);

    const speed = world.speedFor(0);
    expect(toNumber(speed)).toBeGreaterThan(2);
    const point = world.hintFor(0);
    const course = world.course;

    // How the very top of the ball moves, compared with the ball itself.
    const armX = mul(course.upX[point], stats.radius);
    const armY = mul(course.upY[point], stats.radius);
    const armZ = mul(course.upZ[point], stats.radius);
    const top = crossInto(triple(), world.spinX[0], world.spinY[0], world.spinZ[0], armX, armY, armZ);

    const alongTravel = div(
      dot(top.x, top.y, top.z, world.velocityX[0], world.velocityY[0], world.velocityZ[0]),
      speed,
    );
    // Forwards, and at very nearly the speed the ball is travelling.
    expect(alongTravel).toBeGreaterThan(0);
    expect(toNumber(alongTravel)).toBeCloseTo(toNumber(speed), 0);
    expect(toNumber(magnitude(top.x, top.y, top.z))).toBeCloseTo(toNumber(speed), 0);
  });

  it('holds the point touching the ground still', () => {
    const world = slopeWorld(8);
    roll(world, STEPS_PER_SECOND * 3);
    // If the ball turned the wrong way this would come out at twice the
    // travelling speed rather than near nothing.
    expect(toNumber(world.skidFor(0))).toBeLessThan(0.05);
    expect(toNumber(world.speedFor(0))).toBeGreaterThan(2);
  });

  it('turns the way it is going, not some other way', () => {
    const world = slopeWorld(8);
    roll(world, STEPS_PER_SECOND * 2);
    // Heading along the course means turning about the sideways direction.
    expect(Math.abs(toNumber(world.spinX[0]))).toBeGreaterThan(1);
    expect(Math.abs(toNumber(world.spinZ[0]))).toBeLessThan(1);
  });
});

describe('the floor stops where it is drawn', () => {
  it('does not carry on behind the start line', () => {
    const course = buildCourse([{ length: 60, drop: 8, width: 10, walls: true }]);
    const world = new World({
      course,
      seed: 5,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    // Set the ball down well behind the start line, where no floor is drawn.
    const back = Math.round(6 * ONE);
    world.x[0] = course.startX - mul(course.forwardX[0], back);
    world.y[0] = course.startY - mul(course.forwardY[0], back);
    world.z[0] = course.startZ - mul(course.forwardZ[0], back);

    let steps = 0;
    while (world.falls[0] === 0 && steps < STEPS_PER_SECOND * 10) {
      world.advance([NEUTRAL]);
      steps++;
    }
    // It drops rather than rolling away on a surface that is not there, and
    // dropping puts it straight back on the start line.
    expect(world.falls[0]).toBe(1);
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(toNumber(world.travelled[0])).toBeLessThan(4);
    expect(world.speedFor(0)).toBe(0);
  });

  it('knows the floor has run out at either end', () => {
    const course = buildCourse([{ length: 60, drop: 8, width: 10, walls: true }]);
    const beyond = Math.round(6 * ONE);
    const last = course.count - 1;

    const onIt = placeOnCourse(course, course.x[5], course.y[5], course.z[5], 5);
    expect(onIt.pastEnd).toBe(0);

    const behind = placeOnCourse(
      course,
      course.startX - mul(course.forwardX[0], beyond),
      course.startY - mul(course.forwardY[0], beyond),
      course.startZ - mul(course.forwardZ[0], beyond),
      0,
    );
    expect(toNumber(behind.pastEnd)).toBeCloseTo(6, 0);

    const ahead = placeOnCourse(
      course,
      course.x[last] + mul(course.forwardX[last], beyond),
      course.y[last] + mul(course.forwardY[last], beyond),
      course.z[last] + mul(course.forwardZ[last], beyond),
      last,
    );
    expect(toNumber(ahead.pastEnd)).toBeCloseTo(6, 0);
  });

  it('lets a ball sail over a wall instead of stopping it in mid-air', () => {
    // The walls are low ones, and they are drawn that way. They should not
    // carry on invisibly into the sky.
    const course = buildCourse([{ length: 60, drop: 0, width: 8, walls: true }]);
    const world = new World({
      course,
      seed: 5,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    const point = 5;
    const outside = Math.round(6 * ONE);
    const high = Math.round(4 * ONE);
    world.x[0] =
      course.x[point] + mul(course.rightX[point], outside) + mul(course.upX[point], high);
    world.y[0] =
      course.y[point] + mul(course.rightY[point], outside) + mul(course.upY[point], high);
    world.z[0] =
      course.z[point] + mul(course.rightZ[point], outside) + mul(course.upZ[point], high);

    world.advance([NEUTRAL]);
    expect(world.grounded[0]).toBe(0);
    // Still outside the course, dropping, rather than shoved back over it.
    expect(toNumber(Math.abs(world.sideways[0]))).toBeGreaterThan(4);
  });

  it('still keeps a rolling ball inside the walls', () => {
    const world = slopeWorld(8);
    const hardRight = packControls({ steer: ONE, push: 0, buttons: 0 });
    roll(world, STEPS_PER_SECOND * 6, hardRight);
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(toNumber(Math.abs(world.sideways[0]))).toBeLessThan(7.1);
  });

  it('holds the ball up everywhere the floor really is', () => {
    const world = slopeWorld(8);
    for (let i = 0; i < STEPS_PER_SECOND * 6; i++) {
      world.advance([NEUTRAL]);
      expect(world.state[0]).toBe(RunState.Rolling);
    }
    expect(world.grounded[0]).toBe(1);
  });
});

describe('the controls only send the ball one way', () => {
  it('brakes to a stop when dragged back, and no further', () => {
    const course = buildCourse([{ length: 60, drop: 8, width: 10, walls: true }]);
    const world = new World({
      course,
      seed: 5,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    const fullBrake = packControls({ steer: 0, push: -ONE, buttons: 0 });

    let leastTravelled = Number.POSITIVE_INFINITY;
    for (let i = 0; i < STEPS_PER_SECOND * 20; i++) {
      world.advance([fullBrake]);
      leastTravelled = Math.min(leastTravelled, world.travelled[0]);
      // Never driven back out through the start line.
      expect(world.travelled[0]).toBeGreaterThanOrEqual(0);
    }
    // It comes to a near stop rather than reversing.
    expect(toNumber(world.speedFor(0))).toBeLessThan(0.5);
    expect(world.state[0]).toBe(RunState.Rolling);
    expect(toNumber(leastTravelled)).toBeGreaterThan(0.5);
  });

  it('still lets the player push on down the hill', () => {
    const pushed = slopeWorld(8);
    const coasting = slopeWorld(8);
    roll(pushed, STEPS_PER_SECOND * 3, packControls({ steer: 0, push: ONE, buttons: 0 }));
    roll(coasting, STEPS_PER_SECOND * 3);
    expect(pushed.travelled[0]).toBeGreaterThan(coasting.travelled[0]);
  });

  it('starts the ball inside the floor, not balanced on its edge', () => {
    const world = slopeWorld(8);
    expect(world.travelled[0]).toBe(0);
    world.advance([NEUTRAL]);
    // One step in, it is comfortably on the floor rather than over the edge.
    expect(world.grounded[0]).toBe(1);
    expect(toNumber(world.travelled[0])).toBeGreaterThan(0.5);
  });
});

describe('a ball on a slippery floor', () => {
  it('skids on a steep slope, turning more slowly than it travels', () => {
    const stats = measureShape(defaultShape());
    const ice = slopeWorld(14, Surface.Slick);
    roll(ice, STEPS_PER_SECOND * 3);

    const travel = toNumber(ice.speedFor(0));
    const turning = toNumber(ice.spinFor(0));
    const radius = toNumber(stats.radius);
    expect(travel).toBeGreaterThan(1);
    expect(turning * radius).toBeLessThan(travel * 0.9);
    expect(toNumber(ice.skidFor(0))).toBeGreaterThan(0.3);
  });

  it('still rolls cleanly on a gentle slope, as a real ball would', () => {
    // Ice does not stop a ball rolling; it stops it rolling when the slope
    // asks for more grip than the ice can give.
    const stats = measureShape(defaultShape());
    const ice = slopeWorld(5, Surface.Slick);
    roll(ice, STEPS_PER_SECOND * 3);
    const travel = toNumber(ice.speedFor(0));
    const turning = toNumber(ice.spinFor(0));
    expect(travel).toBeGreaterThan(0.5);
    expect(turning * toNumber(stats.radius)).toBeCloseTo(travel, 1);
  });

  it('slides faster than a gripping floor lets a ball roll', () => {
    const ice = slopeWorld(12, Surface.Slick);
    const grippy = slopeWorld(12, Surface.Normal);
    roll(ice, STEPS_PER_SECOND * 3);
    roll(grippy, STEPS_PER_SECOND * 3);
    // Without the ground to spin it up, more of the slope goes into travel.
    expect(ice.speedFor(0)).toBeGreaterThan(grippy.speedFor(0));
  });

  it('says so when the ball is skidding, so the picture can show it', () => {
    const ice = wideWorld(10, Surface.Slick);
    const hardLeft = packControls({ steer: -ONE, push: 0, buttons: 0 });
    let reported = 0;
    for (let i = 0; i < STEPS_PER_SECOND * 2; i++) {
      ice.advance([hardLeft]);
      reported += ice.moments.filter((m) => m.kind === 'skid').length;
    }
    expect(ice.grounded[0]).toBe(1);
    expect(reported).toBeGreaterThan(0);
    expect(toNumber(ice.skidFor(0))).toBeGreaterThan(1);
  });

  it('stays quiet about skidding on a floor that grips', () => {
    const grippy = wideWorld(10, Surface.Normal);
    const hardLeft = packControls({ steer: -ONE, push: 0, buttons: 0 });
    let reported = 0;
    for (let i = 0; i < STEPS_PER_SECOND * 2; i++) {
      grippy.advance([hardLeft]);
      reported += grippy.moments.filter((m) => m.kind === 'skid').length;
    }
    expect(grippy.grounded[0]).toBe(1);
    expect(reported).toBe(0);
  });

  it('lets the ball wander further sideways for the same tilt', () => {
    // With little grip, less of the tilt goes into spinning the ball up and
    // more of it simply slides the ball along, so ice is twitchier rather
    // than heavier. The floor here is made very wide so that a wall cannot
    // get in the way of the measurement.
    const ice = wideWorld(8, Surface.Slick);
    const grippy = wideWorld(8, Surface.Normal);
    const hardLeft = packControls({ steer: -ONE, push: 0, buttons: 0 });
    roll(ice, STEPS_PER_SECOND, hardLeft);
    roll(grippy, STEPS_PER_SECOND, hardLeft);
    expect(Math.abs(ice.sideways[0])).toBeGreaterThan(Math.abs(grippy.sideways[0]));
  });
});

describe('what the ball is made of matters', () => {
  it('gets going more slowly when its weight sits out at the rim', () => {
    const solid = measureShape(defaultShape());
    const shell = measureShape(shellShape());
    expect(shell.spinResistance).toBeGreaterThan(solid.spinResistance);

    const solidWorld = slopeWorld(10, Surface.Normal, defaultShape());
    const shellWorld = slopeWorld(10, Surface.Normal, shellShape());
    roll(solidWorld, STEPS_PER_SECOND * 2);
    roll(shellWorld, STEPS_PER_SECOND * 2);
    expect(shellWorld.speedFor(0)).toBeLessThan(solidWorld.speedFor(0));
  });

  it('lets a boxy ball roll, but less tidily than a round one', () => {
    const round = slopeWorld(10, Surface.Normal, defaultShape());
    const boxy = slopeWorld(10, Surface.Normal, cubeShape());
    roll(round, STEPS_PER_SECOND * 3);
    roll(boxy, STEPS_PER_SECOND * 3);
    expect(boxy.speedFor(0)).toBeLessThan(round.speedFor(0));
    expect(boxy.speedFor(0)).toBeGreaterThan(0);
  });

  it('lets a heavier ball push through the air better', () => {
    const heavy = ballFeelFrom(measureShape(defaultShape()));
    const light = ballFeelFrom(measureShape(pebbleShape()));
    expect(heavy.weight).toBeGreaterThan(light.weight);
  });
});

describe('a ball in the air', () => {
  it('keeps spinning while it is off the ground', () => {
    const world = new World({
      course: buildCourse([
        { length: 30, drop: 8, width: 10, walls: true },
        { length: 10, drop: 8, width: 10, gap: true },
        { length: 40, drop: 8, width: 10, walls: true },
      ]),
      seed: 3,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });

    let airborneSpin = 0;
    let sawAir = false;
    for (let i = 0; i < STEPS_PER_SECOND * 20; i++) {
      world.advance([NEUTRAL]);
      if (!world.grounded[0] && world.speedFor(0) > ONE) {
        if (!sawAir) {
          sawAir = true;
          airborneSpin = world.spinFor(0);
        } else {
          // Spin barely fades in the air; nothing is there to slow it down.
          expect(world.spinFor(0)).toBeGreaterThan(airborneSpin * 0.8);
        }
      }
      if (world.state[0] !== RunState.Rolling) break;
    }
    expect(sawAir).toBe(true);
    expect(airborneSpin).toBeGreaterThan(0);
  });
});

describe('bumping into a wall', () => {
  it('bounces off and comes away spinning differently', () => {
    const world = slopeWorld(8);
    const hardRight = packControls({ steer: ONE, push: 0, buttons: 0 });
    let hit = false;
    let before = 0;
    for (let i = 0; i < STEPS_PER_SECOND * 8; i++) {
      before = world.spinFor(0);
      world.advance([hardRight]);
      if (world.moments.some((m) => m.kind === 'wall')) {
        hit = true;
        expect(world.spinFor(0)).not.toBe(before);
        break;
      }
    }
    expect(hit).toBe(true);
    expect(world.state[0]).toBe(RunState.Rolling);
  });
});

describe('the rules stay exactly repeatable', () => {
  it('gives the same spin as well as the same position, every time', () => {
    const a = slopeWorld(9);
    const b = slopeWorld(9);
    const wiggle = packControls({ steer: Math.round(0.6 * ONE), push: 0, buttons: 0 });
    for (let i = 0; i < 600; i++) {
      a.advance([wiggle]);
      b.advance([wiggle]);
    }
    expect(b.spinX[0]).toBe(a.spinX[0]);
    expect(b.spinY[0]).toBe(a.spinY[0]);
    expect(b.spinZ[0]).toBe(a.spinZ[0]);
    expect(b.checksum()).toBe(a.checksum());
  });

  it('notices a difference in spin alone', () => {
    const a = slopeWorld(9);
    roll(a, 300);
    const before = a.checksum();
    a.spinX[0] += 1;
    expect(a.checksum()).not.toBe(before);
  });

  it('produces only whole numbers for the spin', () => {
    const world = slopeWorld(9);
    roll(world, 400, packControls({ steer: Math.round(0.3 * ONE), push: 0, buttons: 0 }));
    expect(Number.isInteger(world.spinX[0])).toBe(true);
    expect(Number.isInteger(world.spinY[0])).toBe(true);
    expect(Number.isInteger(world.spinZ[0])).toBe(true);
  });
});
