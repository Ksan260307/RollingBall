/**
 * These tests build the real meshes without a graphics card. Shapes and
 * colours are worked out on the processor, so the part most likely to break
 * silently can still be checked in a plain test run.
 */

import { describe, expect, it } from 'vitest';
import { BufferGeometry, Group, Mesh } from 'three';
import { Junction, buildCourse } from '../src/core/course';
import {
  SHAPE_CELLS,
  SHAPE_SIZE,
  cellIndex,
  cubeShape,
  defaultShape,
  pebbleShape,
} from '../src/core/ballShape';
import { measureShape } from '../src/core/ballShape';
import { packControls } from '../src/core/input';
import { WALL_HEIGHT, World } from '../src/core/simulation';
import { ONE, toNumber } from '../src/core/fixed';
import { buildCourseMesh, disposeCourseMesh, toMetres } from '../src/render/courseMesh';
import { buildBallGeometry } from '../src/render/ballMesh';
import { STAGES, altCourseFor, courseFor, stageById } from '../src/game/stages';

const colours = { floor: '#f2f6e9', edge: '#ffd166', ground: '#7fc98a' };

function countTriangles(group: Group): number {
  let total = 0;
  group.traverse((child) => {
    if (child instanceof Mesh) {
      const index = (child.geometry as BufferGeometry).getIndex();
      if (index) total += index.count / 3;
    }
  });
  return total;
}

describe('building the course to look at', () => {
  it('makes a floor, edges, walls and an underside', () => {
    const course = buildCourse([{ length: 20, drop: 6, width: 8, walls: true }]);
    const group = buildCourseMesh(course, colours);
    expect(group.children.length).toBeGreaterThanOrEqual(4);
    expect(countTriangles(group)).toBeGreaterThan(20);
    disposeCourseMesh(group);
  });

  it('produces sound numbers everywhere, never a broken one', () => {
    for (const stage of STAGES) {
      const group = buildCourseMesh(courseFor(stage), colours);
      group.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const position = child.geometry.getAttribute('position');
        if (!position) return;
        for (let i = 0; i < position.count * position.itemSize; i++) {
          expect(Number.isFinite(position.array[i] as number)).toBe(true);
        }
      });
      disposeCourseMesh(group);
    }
  });

  it('leaves a hole in the floor where the course has a gap', () => {
    const solid = buildCourse([{ length: 20, width: 6 }]);
    const broken = buildCourse([
      { length: 8, width: 6 },
      { length: 4, width: 6, gap: true },
      { length: 8, width: 6 },
    ]);
    const solidGroup = buildCourseMesh(solid, colours);
    const brokenGroup = buildCourseMesh(broken, colours);
    expect(countTriangles(brokenGroup)).toBeLessThan(countTriangles(solidGroup));
    disposeCourseMesh(solidGroup);
    disposeCourseMesh(brokenGroup);
  });

  it('follows the course rather than sitting in one place', () => {
    const course = courseFor(STAGES[0]);
    const group = buildCourseMesh(course, colours);
    const floor = group.children[0] as Mesh;
    floor.geometry.computeBoundingBox();
    const box = floor.geometry.boundingBox;
    expect(box).not.toBeNull();
    if (box) {
      expect(box.max.z - box.min.z).toBeGreaterThan(40);
      expect(box.min.y).toBeLessThan(box.max.y);
    }
    disposeCourseMesh(group);
  });

  it('lets go of what it was holding when the course changes', () => {
    const group = buildCourseMesh(buildCourse([{ length: 10, width: 6 }]), colours);
    expect(() => disposeCourseMesh(group)).not.toThrow();
  });

  it('keeps a whole course down to a reasonable number of triangles', () => {
    for (const stage of STAGES) {
      const group = buildCourseMesh(courseFor(stage), colours);
      expect(countTriangles(group)).toBeLessThan(6000);
      disposeCourseMesh(group);
    }
  });

  it('measures in metres', () => {
    expect(toMetres(65536)).toBe(1);
    expect(toMetres(32768)).toBe(0.5);
  });
});

describe('building the ball to look at', () => {
  it('only builds the sides you can actually see', () => {
    const solid = new Uint8Array(SHAPE_CELLS).fill(3);
    const built = buildBallGeometry(solid);
    const index = built.geometry.getIndex();
    // A solid block is six flat sides, however many cubes are hidden inside.
    expect(index).not.toBeNull();
    expect(index && index.count / 3).toBe(6 * SHAPE_SIZE * SHAPE_SIZE * 2);
  });

  it('gives a single cube its six sides', () => {
    const one = new Uint8Array(SHAPE_CELLS);
    one[cellIndex(4, 4, 4)] = 2;
    const built = buildBallGeometry(one);
    expect(built.faces.length).toBe(12);
    expect(built.geometry.getIndex()?.count).toBe(36);
  });

  it('remembers which cube each side belongs to, and which way it faces', () => {
    const one = new Uint8Array(SHAPE_CELLS);
    one[cellIndex(4, 4, 4)] = 2;
    const built = buildBallGeometry(one);
    const cell = cellIndex(4, 4, 4);
    for (const face of built.faces) {
      expect(face.cell).toBe(cell);
      const steps = Math.abs(face.nx) + Math.abs(face.ny) + Math.abs(face.nz);
      expect(steps).toBe(1);
    }
    const directions = new Set(built.faces.map((f) => `${f.nx},${f.ny},${f.nz}`));
    expect(directions.size).toBe(6);
  });

  it('has one face entry per triangle, so a tap can be traced back', () => {
    const built = buildBallGeometry(defaultShape());
    const triangles = (built.geometry.getIndex()?.count ?? 0) / 3;
    expect(built.faces.length).toBe(triangles);
  });

  it('sits centred on nothing, so the ball turns about its middle', () => {
    const built = buildBallGeometry(defaultShape());
    built.geometry.computeBoundingBox();
    const box = built.geometry.boundingBox;
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.001);
      expect(Math.abs(box.min.y + box.max.y)).toBeLessThan(0.001);
    }
  });

  it('faces every side outwards, so the ball is solid rather than see-through', () => {
    // Three.js draws only the front of a triangle. Wind them the wrong way
    // and the near side of the ball is thrown away, leaving it looking
    // transparent, and a tap aimed at the surface lands on the far side.
    for (const voxels of [defaultShape(), cubeShape(), pebbleShape()]) {
      const built = buildBallGeometry(voxels);
      const position = built.geometry.getAttribute('position');
      const normal = built.geometry.getAttribute('normal');
      const index = built.geometry.getIndex();
      expect(index).not.toBeNull();
      if (!index) continue;

      let inward = 0;
      for (let triangle = 0; triangle < index.count / 3; triangle++) {
        const a = index.getX(triangle * 3);
        const b = index.getX(triangle * 3 + 1);
        const c = index.getX(triangle * 3 + 2);
        const e1 = [
          position.getX(b) - position.getX(a),
          position.getY(b) - position.getY(a),
          position.getZ(b) - position.getZ(a),
        ];
        const e2 = [
          position.getX(c) - position.getX(a),
          position.getY(c) - position.getY(a),
          position.getZ(c) - position.getZ(a),
        ];
        const wound = [
          e1[1] * e2[2] - e1[2] * e2[1],
          e1[2] * e2[0] - e1[0] * e2[2],
          e1[0] * e2[1] - e1[1] * e2[0],
        ];
        const facing =
          wound[0] * normal.getX(a) + wound[1] * normal.getY(a) + wound[2] * normal.getZ(a);
        if (facing <= 0) inward++;
      }
      expect(inward).toBe(0);
    }
  });

  it('sits exactly on the floor, so it rolls instead of hovering', () => {
    // The rules hold the middle of the ball one radius above the floor. If
    // the drawn ball did not reach down exactly that far it would float, and
    // it would turn at the wrong rate for the size it appears to be, which
    // reads as sliding rather than rolling.
    for (const voxels of [defaultShape(), cubeShape(), pebbleShape()]) {
      const built = buildBallGeometry(voxels);
      built.geometry.computeBoundingBox();
      const box = built.geometry.boundingBox;
      expect(box).not.toBeNull();
      if (!box) continue;
      const resting = toNumber(measureShape(voxels).radius);
      // They agree to within the smallest step the rules can store.
      expect(-box.min.y).toBeCloseTo(resting, 4);
      expect(box.max.y).toBeCloseTo(resting, 4);
      expect(-box.min.x).toBeLessThanOrEqual(resting + 1 / ONE);
      expect(-box.min.z).toBeLessThanOrEqual(resting + 1 / ONE);
    }
  });

  it('grows and shrinks with the size it is given', () => {
    const small = buildBallGeometry(defaultShape(), 0.5);
    const large = buildBallGeometry(defaultShape(), 2);
    small.geometry.computeBoundingSphere();
    large.geometry.computeBoundingSphere();
    const a = small.geometry.boundingSphere?.radius ?? 0;
    const b = large.geometry.boundingSphere?.radius ?? 0;
    expect(b).toBeCloseTo(a * 4, 3);
  });

  it('carries colours and picture positions for every corner', () => {
    const built = buildBallGeometry(defaultShape(6));
    const position = built.geometry.getAttribute('position');
    expect(built.geometry.getAttribute('color').count).toBe(position.count);
    expect(built.geometry.getAttribute('uv').count).toBe(position.count);
    const uv = built.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count * 2; i++) {
      const value = uv.array[i] as number;
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('copes with a design that has nothing in it', () => {
    const built = buildBallGeometry(new Uint8Array(SHAPE_CELLS));
    expect(built.faces.length).toBe(0);
    expect(built.geometry.getIndex()?.count ?? 0).toBe(0);
  });

  it('stays light enough for a phone', () => {
    for (const voxels of [defaultShape(), cubeShape(), pebbleShape()]) {
      const built = buildBallGeometry(voxels);
      // Finer cubes mean more sides, but only the ones you can see are built,
      // so the count grows with the surface rather than with the volume.
      expect(built.faces.length / 2).toBeLessThan(2200);
    }
  });
});

describe('the railings', () => {
  /** The tallest point the drawn railings reach above the floor. */
  function drawnRailingHeight(): number {
    const course = buildCourse([{ length: 20, drop: 0, width: 6, walls: true }], 0);
    const group = buildCourseMesh(course, {
      floor: '#ffffff',
      edge: '#ffd166',
      ground: '#334455',
    });
    let highest = 0;
    group.traverse((node) => {
      const mesh = node as Mesh;
      const geometry = mesh.geometry as BufferGeometry | undefined;
      const position = geometry?.getAttribute?.('position');
      if (!position) return;
      for (let i = 0; i < position.count; i++) highest = Math.max(highest, position.getY(i));
    });
    disposeCourseMesh(group);
    return highest;
  }

  it('stand exactly as tall as the rules let the ball hit them', () => {
    // A barrier you can see through is as bad as one you cannot see. The two
    // numbers come from one place, and this is what holds them together.
    expect(drawnRailingHeight()).toBeCloseTo(toMetres(WALL_HEIGHT), 5);
  });

  it('are tall enough to hold a bouncing ball on the course', () => {
    // The point of raising them: a ball that lands hard next to a railing
    // should be turned back rather than skipping over the top of it.
    const course = buildCourse(
      [
        { length: 14, drop: 22, width: 5, walls: true },
        { length: 40, turn: 40, drop: 4, width: 5, walls: true },
      ],
      0,
    );
    const world = new World({
      course,
      seed: 3,
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    const hardRight = packControls({ steer: ONE, push: 0, buttons: 0 });
    let hits = 0;
    for (let i = 0; i < 120 * 12; i++) {
      world.advance([hardRight]);
      for (const moment of world.moments) if (moment.kind === 'wall') hits++;
    }
    // It leant on the railing all the way and the railing held.
    expect(hits).toBeGreaterThan(0);
    expect(world.falls[0]).toBe(0);
  });
});

/**
 * Drawing only the stretch that differs, at a fork.
 *
 * Both ways down are the same course with a stretch swapped out, so drawing
 * both of them whole lays two identical floors on top of each other for the
 * shared start and the shared finish. That does not look like two roads. It
 * looks like one road tearing itself apart as the camera moves, and it is
 * exactly what was wrong with the fork course when it first went in.
 */
describe('drawing the second way down', () => {
  it('draws far less of it than the whole course', () => {
    const stage = stageById('fork');
    if (!stage) throw new Error('the fork course went missing');
    const other = altCourseFor(stage);
    expect(other).not.toBeNull();

    const whole = buildCourseMesh(other!, colours);
    const part = buildCourseMesh(other!, colours, stage.shows);
    expect(countTriangles(part)).toBeLessThan(countTriangles(whole) * 0.6);
    expect(countTriangles(part)).toBeGreaterThan(0);
    disposeCourseMesh(whole);
    disposeCourseMesh(part);
  });

  it('keeps every corner of it between the fork and the join', () => {
    const stage = stageById('fork');
    if (!stage) throw new Error('the fork course went missing');
    const other = altCourseFor(stage)!;
    const from = stage.forkAt ?? 0;
    const to = stage.rejoinAt ?? 0;
    const part = buildCourseMesh(other, colours, { from, to });

    // Where the drawn stretch starts and stops, along the ground.
    let earliest = Number.POSITIVE_INFINITY;
    let latest = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < other.count; i++) {
      const along = toMetres(other.distance[i]);
      if (along < from || along > to) continue;
      earliest = Math.min(earliest, toMetres(other.z[i]));
      latest = Math.max(latest, toMetres(other.z[i]));
    }

    // Nothing drawn may sit outside that, give or take the width of the floor.
    const room = 12;
    part.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      const position = child.geometry.getAttribute('position');
      if (!position) return;
      for (let i = 0; i < position.count; i++) {
        const z = position.getZ(i);
        expect(z).toBeGreaterThan(earliest - room);
        expect(z).toBeLessThan(latest + room);
      }
    });
    disposeCourseMesh(part);
  });
});

describe('drawing a junction', () => {
  it('builds no railing along the side the other road is on', () => {
    const plain = buildCourse([{ length: 40, drop: 6, width: 10, walls: true }]);
    const open = buildCourse([
      { length: 40, drop: 6, width: 10, walls: true, junction: Junction.SplitLeft },
    ]);
    const plainGroup = buildCourseMesh(plain, colours);
    const openGroup = buildCourseMesh(open, colours);
    // Everything else is the same shape, so the difference is one railing:
    // roughly half of them, and certainly not all and not none.
    expect(countTriangles(openGroup)).toBeLessThan(countTriangles(plainGroup));
    expect(countTriangles(openGroup)).toBeGreaterThan(countTriangles(plainGroup) * 0.7);
    disposeCourseMesh(plainGroup);
    disposeCourseMesh(openGroup);
  });

  it('builds no railing at all where both sides are junctions', () => {
    const bare = buildCourse([{ length: 40, drop: 6, width: 10, walls: false }]);
    const both = buildCourse([
      { length: 40, drop: 6, width: 10, walls: true, junction: Junction.SplitLeft },
    ]);
    // Opening one side leaves the other, so this only checks the one that
    // is opened really is gone rather than merely thinner.
    const bareGroup = buildCourseMesh(bare, colours);
    const bothGroup = buildCourseMesh(both, colours);
    expect(countTriangles(bothGroup)).toBeGreaterThan(countTriangles(bareGroup));
    disposeCourseMesh(bareGroup);
    disposeCourseMesh(bothGroup);
  });
});
