import { describe, expect, it } from 'vitest';
import {
  CUBE_METRES,
  PALETTE,
  SHAPE_CELLS,
  SHAPE_CENTRE,
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

  it('paints the ball mostly the colour it was asked for', () => {
    const green = defaultShape(4);
    const counts = new Map<number, number>();
    for (const slot of green) if (slot !== 0) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    expect(ordered[0][0]).toBe(4);
    expect(PALETTE[4]).toBeTruthy();
    // The rest is the pattern that shows which way the ball is turning.
    expect(counts.size).toBeGreaterThan(1);
  });

  it('is lopsided enough to show which way it is turning', () => {
    // A ball of cubes is the same shape after a quarter turn. Painted one
    // flat colour, its pattern would come round four times a revolution,
    // fast enough at speed to outrun the screen and appear to run backwards.
    // A lopsided pattern gives one landmark per turn instead.
    for (const voxels of [defaultShape(), cubeShape(), pebbleShape()]) {
      let differing = 0;
      let filled = 0;
      for (let x = 0; x < SHAPE_SIZE; x++) {
        for (let y = 0; y < SHAPE_SIZE; y++) {
          for (let z = 0; z < SHAPE_SIZE; z++) {
            const here = voxels[cellIndex(x, y, z)];
            if (here === 0) continue;
            filled++;
            // A quarter turn about the axis the ball rolls on.
            const turnedY = SHAPE_CENTRE + (z - SHAPE_CENTRE);
            const turnedZ = SHAPE_CENTRE - (y - SHAPE_CENTRE);
            if (here !== voxels[cellIndex(x, turnedY, turnedZ)]) differing++;
          }
        }
      }
      expect(differing / filled).toBeGreaterThan(0.25);
    }
  });

  it('keeps the pattern out of the way of how the ball rolls', () => {
    // Colour must never change the handling: only which cubes are filled in.
    const plain = defaultShape();
    const stripped = Uint8Array.from(plain, (slot) => (slot === 0 ? 0 : 7));
    const a = measureShape(plain);
    const b = measureShape(stripped);
    expect(b.radius).toBe(a.radius);
    expect(b.weight).toBe(a.weight);
    expect(b.spinResistance).toBe(a.spinResistance);
    expect(b.smoothness).toBe(a.smoothness);
  });

  it('rests on its body, not on cubes poking out on their own', () => {
    // A ball with a whisker or two is a normal thing to build in the
    // workshop. If a single sticking-out cube set the resting height, the
    // whole ball would hover above the floor and turn too slowly for the
    // size it appears to be, which looks exactly like sliding.
    const body = new Uint8Array(SHAPE_CELLS);
    for (let x = 0; x < SHAPE_SIZE; x++) {
      for (let y = 0; y < SHAPE_SIZE; y++) {
        for (let z = 0; z < SHAPE_SIZE; z++) {
          const dx = x - SHAPE_CENTRE;
          const dy = y - SHAPE_CENTRE;
          const dz = z - SHAPE_CENTRE;
          if (dx * dx + dy * dy + dz * dz <= 6.8 * 6.8) body[cellIndex(x, y, z)] = 5;
        }
      }
    }
    const plain = measureShape(body);

    // Two-cube whiskers growing out of the body on three sides.
    const whiskered = Uint8Array.from(body);
    whiskered[cellIndex(16, 9, 9)] = 4;
    whiskered[cellIndex(17, 9, 9)] = 4;
    whiskered[cellIndex(1, 9, 9)] = 4;
    whiskered[cellIndex(0, 9, 9)] = 4;
    whiskered[cellIndex(9, 16, 9)] = 4;
    whiskered[cellIndex(9, 17, 9)] = 4;
    const bumpy = measureShape(whiskered);

    expect(bumpy.radius).toBe(plain.radius);
    // The whiskers do reach further out, and that is still worth knowing.
    expect(bumpy.reach).toBeGreaterThan(plain.reach);
    // Handling stays where it was rather than being thrown off by them.
    expect(toNumber(bumpy.spinResistance)).toBeCloseTo(toNumber(plain.spinResistance), 1);
  });

  it('still uses a lone cube when there is nothing else to rest on', () => {
    const middle = Math.ceil(SHAPE_CENTRE);
    const single = new Uint8Array(SHAPE_CELLS);
    single[cellIndex(middle, middle, middle)] = 3;
    const stats = measureShape(single);
    expect(toNumber(stats.radius)).toBeCloseTo(CUBE_METRES, 3);
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
    expect(shapeToText(defaultShape()).length).toBeLessThan(6000);
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
