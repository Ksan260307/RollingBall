/**
 * These tests build the real meshes without a graphics card. Shapes and
 * colours are worked out on the processor, so the part most likely to break
 * silently can still be checked in a plain test run.
 */

import { describe, expect, it } from 'vitest';
import { BufferGeometry, Group, Mesh } from 'three';
import { buildCourse } from '../src/core/course';
import {
  SHAPE_CELLS,
  cellIndex,
  cubeShape,
  defaultShape,
  pebbleShape,
} from '../src/core/ballShape';
import { buildCourseMesh, disposeCourseMesh, toMetres } from '../src/render/courseMesh';
import { buildBallGeometry } from '../src/render/ballMesh';
import { STAGES, courseFor } from '../src/game/stages';

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
    expect(index && index.count / 3).toBe(6 * 9 * 9 * 2);
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
      expect(built.faces.length / 2).toBeLessThan(600);
    }
  });
});
