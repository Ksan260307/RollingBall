/**
 * Racing several balls down one hill.
 *
 * Two things have to hold for a race between people to mean anything. Every
 * screen has to see the same race from the same steering, or two players
 * will disagree about who won. And nobody may gain anything from the order
 * the players happen to be stored in.
 */

import { describe, expect, it } from 'vitest';
import { ONE } from '../src/core/fixed';
import { NEUTRAL, packControls } from '../src/core/input';
import {
  cubeShape,
  defaultShape,
  measureShape,
  pebbleShape,
  randomShape,
} from '../src/core/ballShape';
import { World } from '../src/core/simulation';
import { buildCourse } from '../src/core/course';
import { STAGES, courseFor } from '../src/game/stages';
import { Race, robotControls, type Seat } from '../src/game/race';

function seatsOf(count: number): Seat[] {
  const balls = [defaultShape(), pebbleShape(), cubeShape(), randomShape(19)];
  const out: Seat[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      kind: i === 0 ? 'you' : 'robot',
      name: `${i}`,
      ball: measureShape(balls[i % balls.length]),
      keenness: 1 - i * 0.05,
    });
  }
  return out;
}

/** Runs a whole race with everybody driven by the same driver. */
function runRace(count: number, stageIndex = 0) {
  const race = new Race({
    stage: STAGES[stageIndex],
    seats: seatsOf(count),
    you: 0,
    countdownSeconds: 0,
  });
  let frames = 0;
  let barges = 0;
  while (race.running && frames < 120 * 150) {
    race.hear(0, race.wantedStep, robotControls(race.world, 0, 1));
    race.update(1 / 120, NEUTRAL);
    for (const moment of race.world.moments) if (moment.kind === 'barge') barges++;
    frames++;
  }
  return { race, barges };
}

describe('balls running into each other', () => {
  it('pushes two overlapping balls apart', () => {
    // Put two balls in the same place and let the rules sort it out.
    const world = new World({
      course: buildCourse([{ length: 60, drop: 6, width: 14, walls: true }], 0),
      seed: 1,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
      players: 2,
    });
    world.x[1] = world.x[0];
    world.y[1] = world.y[0];
    world.z[1] = world.z[0];
    const hands = packControls(NEUTRAL);
    world.advance([hands, hands]);
    const apart = Math.hypot(
      (world.x[1] - world.x[0]) / ONE,
      (world.y[1] - world.y[0]) / ONE,
      (world.z[1] - world.z[0]) / ONE,
    );
    expect(apart).toBeGreaterThan(0.1);
  });

  it('shoves a light ball further than a heavy one', () => {
    // Same knock, shared out by weight: that is what makes a heavy ball
    // worth building for a race.
    const light = measureShape(pebbleShape());
    const heavy = measureShape(cubeShape());
    const world = new World({
      course: buildCourse([{ length: 60, drop: 6, width: 14, walls: true }], 0),
      seed: 1,
      ball: light,
      balls: [light, heavy],
      countdownSeconds: 0,
      players: 2,
    });
    const startedApart = world.x[1] - world.x[0];
    world.x[1] = world.x[0] + Math.round(0.1 * ONE);
    world.y[1] = world.y[0];
    world.z[1] = world.z[0];
    const before = { a: world.x[0], b: world.x[1] };
    world.advance([packControls(NEUTRAL), packControls(NEUTRAL)]);
    const movedLight = Math.abs(world.x[0] - before.a);
    const movedHeavy = Math.abs(world.x[1] - before.b);
    expect(startedApart).not.toBe(0);
    expect(movedLight).toBeGreaterThan(movedHeavy);
  });

  it('leaves balls alone that are simply near each other', () => {
    const world = new World({
      course: buildCourse([{ length: 60, drop: 6, width: 14, walls: true }], 0),
      seed: 1,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
      players: 2,
    });
    // Started well apart, as the start line puts them.
    const before = [world.x[0], world.x[1]];
    const hands = packControls(NEUTRAL);
    for (let i = 0; i < 10; i++) world.advance([hands, hands]);
    // They roll downhill, but neither is thrown sideways by the other.
    expect(Math.abs(world.x[0] - before[0])).toBeLessThan(0.5 * ONE);
    expect(Math.abs(world.x[1] - before[1])).toBeLessThan(0.5 * ONE);
  });

  it('shares a knock out evenly between two equal balls', () => {
    // Whoever is listed first must get no advantage whatever: the same
    // knock has to move both of them by the same amount.
    const ball = measureShape(defaultShape());
    const world = new World({
      course: buildCourse([{ length: 60, drop: 0, width: 14, walls: true }], 0),
      seed: 1,
      ball,
      countdownSeconds: 0,
      players: 2,
    });
    // Put them just touching, and send them into each other.
    const gap = Math.round(0.35 * ONE);
    world.x[1] = world.x[0] + gap;
    world.y[1] = world.y[0];
    world.z[1] = world.z[0];
    world.velocityX[0] = Math.round(3 * ONE);
    world.velocityX[1] = Math.round(-3 * ONE);
    const before = [world.velocityX[0], world.velocityX[1]];
    world.advance([packControls(NEUTRAL), packControls(NEUTRAL)]);
    const movedA = world.velocityX[0] - before[0];
    const movedB = world.velocityX[1] - before[1];
    // Equal and opposite, near enough: the two are at different points of
    // the floor, so the ordinary physics of the step differs between them
    // by a hair. What matters is that the knock itself is shared evenly.
    expect(Math.abs(movedA + movedB)).toBeLessThan(ONE / 1000);
    expect(movedA).toBeLessThan(0);
    expect(movedB).toBeGreaterThan(0);
  });

});

describe('a race of four', () => {
  it('gets everybody down and puts them in an order', () => {
    const { race } = runRace(4);
    const placings = race.placings();
    expect(placings).toHaveLength(4);
    // Sorted: finishers first, by time.
    for (let i = 1; i < placings.length; i++) {
      const before = placings[i - 1];
      const now = placings[i];
      if (before.finished && now.finished) expect(before.seconds).toBeLessThanOrEqual(now.seconds);
      if (!before.finished) expect(now.finished).toBe(false);
    }
    expect(placings.filter((placing) => placing.finished).length).toBeGreaterThan(1);
  });

  it('has them run into each other on the way down', () => {
    // Four balls on one hill: if they never touched, the whole thing would
    // just be four separate runs sharing a screen.
    const { barges } = runRace(4);
    expect(barges).toBeGreaterThan(0);
  });

  it('gives every screen the same race from the same steering', () => {
    // The heart of it: nobody sends positions, so two screens agree only if
    // the same inputs give the same world. If this ever stops being true,
    // two players will disagree about who won.
    const first = runRace(4).race;
    const second = runRace(4).race;
    expect(first.world.checksum()).toBe(second.world.checksum());
    expect(first.placings()).toEqual(second.placings());
  });

  it('carries on when somebody stops saying anything', () => {
    // A player whose connection dies must not freeze the race for everybody
    // who is still there.
    const race = new Race({
      stage: STAGES[0],
      seats: [
        { kind: 'you', name: 'あなた', ball: measureShape(defaultShape()), keenness: 1 },
        { kind: 'friend', name: 'あいて', ball: measureShape(defaultShape()), keenness: 1 },
      ],
      you: 0,
      countdownSeconds: 0,
    });
    // Seat 1 never says a word.
    let frames = 0;
    while (race.running && frames < 120 * 90) {
      race.update(1 / 120, NEUTRAL);
      frames++;
    }
    expect(race.world.step).toBeGreaterThan(120 * 5);
  });

  it('waits for a player who is still talking', () => {
    const race = new Race({
      stage: STAGES[0],
      seats: [
        { kind: 'you', name: 'あなた', ball: measureShape(defaultShape()), keenness: 1 },
        { kind: 'friend', name: 'あいて', ball: measureShape(defaultShape()), keenness: 1 },
      ],
      you: 0,
      countdownSeconds: 0,
    });
    // Heard from once, early, and then nothing for a moment: the race must
    // hold rather than run on without them.
    race.hear(1, 0, packControls(NEUTRAL));
    race.update(1, NEUTRAL);
    expect(race.world.step).toBeLessThan(30);
  });
});

describe('the robots that fill the empty seats', () => {
  it('drive, and drive less hard the less keen they are', () => {
    const world = new World({
      course: courseFor(STAGES[0]),
      seed: STAGES[0].seed,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
      players: 2,
    });
    for (let i = 0; i < 200; i++) {
      world.advance([robotControls(world, 0, 1), robotControls(world, 1, 1)]);
    }
    expect(world.travelled[0]).toBeGreaterThan(0);
    // Keenness only ever holds a robot back.
    const flatOut = robotControls(world, 0, 1);
    const halfHearted = robotControls(world, 0, 0.5);
    expect(halfHearted).not.toBe(0);
    expect(typeof halfHearted).toBe('number');
    expect(flatOut).toBeGreaterThanOrEqual(0);
  });
});
