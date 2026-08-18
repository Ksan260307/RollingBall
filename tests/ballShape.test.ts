import { describe, expect, it } from 'vitest';
import {
  PALETTE,
  SHAPE_CELLS,
  SHAPE_SIZE,
  cellAt,
  cellIndex,
  cubeShape,
  defaultShape,
  insideShape,
  largestConnectedPart,
  measureShape,
  pebbleShape,
  shapeFingerprint,
  shapeFromText,
  shapeToText,
} from '../src/core/ballShape';
import { ONE, toNumber } from '../src/core/fixed';

function countCubes(voxels: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) n++;
  return n;
}

describe('the block of cubes', () => {
  it('numbers every slot exactly once', () => {
    const seen = new Set<number>();
    for (let x = 0; x < SHAPE_SIZE; x++) {
      for (let y = 0; y < SHAPE_SIZE; y++) {
        for (let z = 0; z < SHAPE_SIZE; z++) seen.add(cellIndex(x, y, z));
      }
    }
    expect(seen.size).toBe(SHAPE_CELLS);
  });

  it('knows what is inside the editing space', () => {
    expect(insideShape(0, 0, 0)).toBe(true);
    expect(insideShape(SHAPE_SIZE - 1, 0, 0)).toBe(true);
    expect(insideShape(-1, 0, 0)).toBe(false);
    expect(insideShape(0, SHAPE_SIZE, 0)).toBe(false);
  });

  it('treats anything outside as empty rather than as an error', () => {
    const voxels = defaultShape();
    expect(cellAt(voxels, -5, 0, 0)).toBe(0);
    expect(cellAt(voxels, 100, 100, 100)).toBe(0);
  });
});

describe('the ready-made shapes', () => {
  it('gives everyone a round ball to start with', () => {
    const stats = measureShape(defaultShape());
    expect(stats.cubes).toBeGreaterThan(200);
    expect(toNumber(stats.smoothness)).toBeGreaterThan(0.8);
    expect(stats.weight).toBe(ONE);
  });

  it('paints the ball the colour it was asked for', () => {
    const green = defaultShape(4);
    const used = new Set([...green].filter((v) => v !== 0));
    expect([...used]).toEqual([4]);
    expect(PALETTE[4]).toBeTruthy();
  });

  it('makes a box less round than a ball', () => {
    const round = measureShape(defaultShape());
    const boxy = measureShape(cubeShape());
    expect(boxy.smoothness).toBeLessThan(round.smoothness);
  });

  it('makes a pebble smaller and lighter than a ball', () => {
    const round = measureShape(defaultShape());
    const pebble = measureShape(pebbleShape());
    expect(pebble.radius).toBeLessThan(round.radius);
    expect(pebble.weight).toBeLessThan(round.weight);
  });

  it('gives a sensible answer even for an empty design', () => {
    const stats = measureShape(new Uint8Array(SHAPE_CELLS));
    expect(stats.cubes).toBe(0);
    expect(stats.radius).toBeGreaterThan(0);
    expect(stats.weight).toBeGreaterThan(0);
  });

  it('measures a ball at about half a metre across the middle', () => {
    const stats = measureShape(defaultShape());
    expect(toNumber(stats.radius)).toBeGreaterThan(0.3);
    expect(toNumber(stats.radius)).toBeLessThan(0.7);
  });
});

describe('saving and loading a design', () => {
  it('comes back exactly as it went in', () => {
    const original = defaultShape(6);
    const restored = shapeFromText(shapeToText(original));
    expect([...restored]).toEqual([...original]);
  });

  it('stays small enough to keep in the browser', () => {
    expect(shapeToText(defaultShape()).length).toBeLessThan(1200);
  });

  it('survives text that makes no sense', () => {
    const rescued = shapeFromText('nonsense,,,17:');
    expect(rescued.length).toBe(SHAPE_CELLS);
  });

  it('gives matching designs the same fingerprint', () => {
    expect(shapeFingerprint(defaultShape())).toBe(shapeFingerprint(defaultShape()));
    expect(shapeFingerprint(defaultShape())).not.toBe(shapeFingerprint(cubeShape()));
  });
});

describe('keeping the ball in one piece', () => {
  it('drops cubes that float on their own', () => {
    const voxels = defaultShape();
    voxels[cellIndex(0, 0, 0)] = 3; // A corner cube, touching nothing.
    const tidied = largestConnectedPart(voxels);
    expect(tidied[cellIndex(0, 0, 0)]).toBe(0);
    expect(countCubes(tidied)).toBe(countCubes(defaultShape()));
  });

  it('leaves a design that is already joined up alone', () => {
    const voxels = defaultShape();
    const tidied = largestConnectedPart(voxels);
    expect([...tidied]).toEqual([...voxels]);
  });

  it('keeps the bigger half when a design is split in two', () => {
    const voxels = new Uint8Array(SHAPE_CELLS);
    voxels[cellIndex(1, 1, 1)] = 2;
    for (let z = 4; z < 8; z++) voxels[cellIndex(5, 5, z)] = 3;
    const tidied = largestConnectedPart(voxels);
    expect(tidied[cellIndex(1, 1, 1)]).toBe(0);
    expect(countCubes(tidied)).toBe(4);
  });
});
