/**
 * The courses live in a file that both the game and the course editor read
 * and write. That file gets hand-edited too, so loading it has to cope with
 * whatever it finds: missing fields, silly numbers, a colour that is not a
 * colour. A broken course should still load, and still be playable.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Surface, buildCourse } from '../src/core/course';
import { ONE, toNumber } from '../src/core/fixed';
import { defaultShape, measureShape } from '../src/core/ballShape';
import { RunState, World } from '../src/core/simulation';
import {
  COURSE_DEFAULTS,
  STAGES,
  SURFACE_NAMES,
  type StoredCourse,
  pieceFromStored,
  stageFromStored,
} from '../src/game/stages';
import { isDaily } from '../src/game/daily';
import { runWithAutopilot } from './helpers/autopilot';

const raw = JSON.parse(readFileSync('src/game/courses.json', 'utf8')) as {
  courses: StoredCourse[];
};

describe('the course file', () => {
  it('holds every course the game offers, bar the one made from the date', () => {
    // The day's course is generated rather than written down, so it is in
    // the game without being in the file. Everything else comes from here.
    expect(raw.courses.length).toBeGreaterThan(0);
    const fromFile = STAGES.filter((stage) => !isDaily(stage.id));
    expect(fromFile.map((stage) => stage.id)).toEqual(raw.courses.map((course) => course.id));
    expect(STAGES.filter((stage) => isDaily(stage.id))).toHaveLength(1);
  });

  it('uses names for the floor rather than numbers, so it reads plainly', () => {
    for (const course of raw.courses) {
      for (const piece of course.pieces) {
        if (piece.surface === undefined) continue;
        expect(SURFACE_NAMES).toContain(piece.surface);
      }
    }
  });

  it('keeps every course to a sensible size and shape', () => {
    for (const course of raw.courses) {
      expect(course.id).toMatch(/^[a-z0-9-]+$/i);
      expect(course.pieces.length).toBeGreaterThan(0);
      expect(course.targetSeconds).toBeGreaterThan(0);
      expect(course.breeze).toBeGreaterThanOrEqual(0);
      expect(course.breeze).toBeLessThanOrEqual(1);
      for (const colour of Object.values(course.mood)) {
        if (typeof colour === 'string') expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('is still playable exactly as it was before it moved into a file', () => {
    for (const stage of STAGES) {
      const world = new World({
        course: buildCourse(stage.pieces, 0),
        seed: stage.seed,
        ball: measureShape(defaultShape()),
        breeze: stage.breeze,
        countdownSeconds: 0,
      });
      const result = runWithAutopilot(world, 180);
      expect(result.state).toBe(RunState.Finished);
    }
  });
});

describe('loading a course that has been hand-edited', () => {
  it('fills in everything that was left out', () => {
    const stage = stageFromStored({ pieces: [{ length: 30 }] } as unknown as StoredCourse, 0);
    expect(stage.id).toBe('course-1');
    expect(stage.name.length).toBeGreaterThan(0);
    expect(stage.difficulty).toBe(COURSE_DEFAULTS.difficulty);
    expect(stage.mood.sky).toBe(COURSE_DEFAULTS.mood.sky);
    expect(stage.targetSeconds).toBe(COURSE_DEFAULTS.targetSeconds);
    expect(stage.pieces).toHaveLength(1);
  });

  it('gives a course with no stretches at all something to roll down', () => {
    const stage = stageFromStored({ id: 'empty', pieces: [] } as unknown as StoredCourse, 1);
    expect(stage.pieces.length).toBeGreaterThan(0);
    const course = buildCourse(stage.pieces, 0);
    expect(toNumber(course.totalLength)).toBeGreaterThan(1);
  });

  it('pulls silly numbers back to something the physics can use', () => {
    const piece = pieceFromStored({
      length: 100000,
      turn: 999,
      drop: -900,
      width: 0.0001,
      bank: 400,
    });
    expect(piece.length).toBeLessThanOrEqual(200);
    expect(Math.abs(piece.turn ?? 0)).toBeLessThanOrEqual(180);
    expect(Math.abs(piece.drop ?? 0)).toBeLessThanOrEqual(45);
    expect(piece.width).toBeGreaterThanOrEqual(2);
    expect(Math.abs(piece.bank ?? 0)).toBeLessThanOrEqual(45);
  });

  it('ignores rubbish where a number or a colour should be', () => {
    const stage = stageFromStored(
      {
        id: 'odd',
        name: 'odd',
        blurb: '',
        difficulty: 'lots',
        mood: { sky: 'not a colour', fog: 'thick' },
        breeze: 'windy',
        seed: 'abc',
        targetSeconds: null,
        pieces: [{ length: 'long', surface: 'lava' }],
      } as unknown as StoredCourse,
      2,
    );
    expect(stage.difficulty).toBe(COURSE_DEFAULTS.difficulty);
    expect(stage.mood.sky).toBe(COURSE_DEFAULTS.mood.sky);
    expect(stage.mood.fog).toBe(COURSE_DEFAULTS.mood.fog);
    expect(stage.breeze).toBe(0);
    expect(Number.isFinite(stage.seed)).toBe(true);
    expect(stage.targetSeconds).toBe(COURSE_DEFAULTS.targetSeconds);
    expect(stage.pieces[0].length).toBe(COURSE_DEFAULTS.piece.length);
    // An unknown floor falls back to the ordinary one rather than breaking.
    expect(stage.pieces[0].surface).toBe(Surface.Normal);
  });

  it('turns a course written by the editor straight into something playable', () => {
    // Exactly the shape the editor writes: names for floors, plain numbers.
    const written: StoredCourse = {
      id: 'made-in-the-editor',
      name: 'エディタで作ったコース',
      blurb: 'ためし',
      difficulty: 2,
      mood: {
        sky: '#223344',
        horizon: '#556677',
        ground: '#334455',
        floor: '#ddeeff',
        edge: '#ffaa00',
        fog: 160,
      },
      breeze: 0.25,
      seed: 4242,
      targetSeconds: 22,
      pieces: [
        { length: 24, drop: 8, width: 9, walls: true },
        { length: 20, turn: 25, drop: 7, width: 8, bank: 7, walls: true },
        { length: 16, drop: 6, width: 7, surface: 'slick' },
        { length: 20, drop: 5, width: 9, walls: true },
      ],
    };
    const stage = stageFromStored(written, 0);
    expect(stage.breeze).toBe(Math.round(0.25 * ONE));
    expect(stage.pieces[2].surface).toBe(Surface.Slick);

    const world = new World({
      course: buildCourse(stage.pieces, 0),
      seed: stage.seed,
      ball: measureShape(defaultShape()),
      breeze: stage.breeze,
      countdownSeconds: 0,
    });
    const result = runWithAutopilot(world, 180);
    expect(result.state).toBe(RunState.Finished);
    expect(result.metres).toBeGreaterThan(70);
  });
});

describe('parking a course instead of deleting it', () => {
  it('keeps a course out of the game when it says so', () => {
    const off = raw.courses.filter((course) => course.inGame === false);
    for (const course of off) {
      expect(STAGES.some((stage) => stage.id === course.id)).toBe(false);
    }
    // And everything else is in, alongside the one made from the date.
    const on = raw.courses.filter((course) => course.inGame !== false);
    expect(STAGES.filter((stage) => !isDaily(stage.id))).toHaveLength(on.length);
  });

  it('treats a course that says nothing as one that is in', () => {
    // Hand-written files should not need the extra line.
    const written = { id: 'quiet', pieces: [{ length: 30 }] } as unknown as StoredCourse;
    expect(written.inGame).toBeUndefined();
    const stage = stageFromStored(written, 0);
    expect(stage.id).toBe('quiet');
  });

  it('no longer carries the course that was made and then dropped', () => {
    expect(raw.courses.some((course) => course.id === 'course-4')).toBe(false);
  });
});
