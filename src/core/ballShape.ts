/**
 * The player's ball, described as a small block of cubes.
 *
 * The editor lets the player carve cubes away and stick new ones on, so the
 * ball can end up as anything from a smooth sphere to a lopsided lump. This
 * file turns whatever they built into the handful of numbers the physics
 * needs: how big it is, how heavy it is, and how smoothly it rolls.
 *
 * The numbers come out of whole-number arithmetic so that two players with
 * the same design always get exactly the same handling.
 */

import { ONE, clamp, div, mul, sqrt } from './fixed';

/** Cubes per side of the editing space. Odd, so there is a middle cube. */
export const SHAPE_SIZE = 9;

/** Total number of cube slots. */
export const SHAPE_CELLS = SHAPE_SIZE * SHAPE_SIZE * SHAPE_SIZE;

/** Middle cube along each side. */
export const SHAPE_CENTRE = (SHAPE_SIZE - 1) / 2;

/** How wide one cube is, in metres, at the standard ball size. */
export const CUBE_METRES = 0.1;

/** Colours a cube can be painted. Slot 0 means "no cube here". */
export const PALETTE = [
  '#000000',
  '#ff5b6e',
  '#ffb03a',
  '#ffe45e',
  '#66d97a',
  '#4fc3f7',
  '#8f7bff',
  '#ff8fd0',
  '#f5f5f5',
  '#3a3f52',
];

/** Half a cube, in stored metres; distances are measured in half-cube steps. */
const HALF_CUBE = Math.round((CUBE_METRES / 2) * ONE);

/** Two thirds, used when working out how hard a shape is to spin up. */
const TWO_THIRDS = Math.round((2 / 3) * ONE);

/** Turns a cube position into its slot number. */
export function cellIndex(x: number, y: number, z: number): number {
  return (x * SHAPE_SIZE + y) * SHAPE_SIZE + z;
}

/** True when a cube position is inside the editing space. */
export function insideShape(x: number, y: number, z: number): boolean {
  return (
    x >= 0 && y >= 0 && z >= 0 && x < SHAPE_SIZE && y < SHAPE_SIZE && z < SHAPE_SIZE
  );
}

/** Reads a slot, treating anything outside the space as empty. */
export function cellAt(voxels: Uint8Array, x: number, y: number, z: number): number {
  if (!insideShape(x, y, z)) return 0;
  return voxels[cellIndex(x, y, z)];
}

/**
 * Paints a lopsided pattern over a finished shape.
 *
 * A ball built out of cubes looks exactly the same after a quarter turn, so
 * painting it one flat colour leaves the eye nothing to follow but a pattern
 * that comes round four times per revolution. At speed that repeat outruns
 * the screen refresh, and the ball appears to turn backwards, in just the way
 * spoked wheels do on film.
 *
 * Two off-centre patches give the eye a single landmark per revolution
 * instead. That is slow enough to read clearly even on a slow display, so
 * the direction the ball is turning is never in doubt.
 *
 * Only the colours change, so nothing here affects how the ball rolls.
 */
function paintPattern(voxels: Uint8Array, colour: number): void {
  const patchColour = colour === 8 ? 9 : 8;
  const spotColour = colour === 1 ? 3 : 1;
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const index = cellIndex(x, y, z);
        if (voxels[index] === 0) continue;
        voxels[index] = colour;

        const dx = x - SHAPE_CENTRE;
        const dy = y - SHAPE_CENTRE;
        const dz = z - SHAPE_CENTRE;
        const lengthSquared = dx * dx + dy * dy + dz * dz;
        if (lengthSquared === 0) continue;

        // Compared as squares, so no square roots are needed.
        const towardsPatch = dx * 0.31 + dy * 0.7 + dz * 0.64;
        if (towardsPatch > 0 && towardsPatch * towardsPatch > 0.34 * lengthSquared) {
          voxels[index] = patchColour;
          continue;
        }
        const towardsSpot = dx * -0.58 + dy * -0.49 + dz * 0.65;
        if (towardsSpot > 0 && towardsSpot * towardsSpot > 0.55 * lengthSquared) {
          voxels[index] = spotColour;
        }
      }
    }
  }
}

/** The ball everybody starts with: as round as the cubes allow. */
export function defaultShape(colour = 5): Uint8Array {
  const voxels = new Uint8Array(SHAPE_CELLS);
  const limit = 4.35 * 4.35;
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const dx = x - SHAPE_CENTRE;
        const dy = y - SHAPE_CENTRE;
        const dz = z - SHAPE_CENTRE;
        if (dx * dx + dy * dy + dz * dz <= limit) {
          voxels[cellIndex(x, y, z)] = colour;
        }
      }
    }
  }
  paintPattern(voxels, colour);
  return voxels;
}

/** A cube, for a chunky, skiddy ride. */
export function cubeShape(colour = 2): Uint8Array {
  const voxels = new Uint8Array(SHAPE_CELLS);
  for (let x = 1; x < SHAPE_SIZE - 1; x++) {
    for (let y = 1; y < SHAPE_SIZE - 1; y++) {
      for (let z = 1; z < SHAPE_SIZE - 1; z++) {
        voxels[cellIndex(x, y, z)] = colour;
      }
    }
  }
  paintPattern(voxels, colour);
  return voxels;
}

/** A small, light ball that darts about. */
export function pebbleShape(colour = 4): Uint8Array {
  const voxels = new Uint8Array(SHAPE_CELLS);
  const limit = 2.8 * 2.8;
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const dx = x - SHAPE_CENTRE;
        const dy = y - SHAPE_CENTRE;
        const dz = z - SHAPE_CENTRE;
        if (dx * dx + dy * dy + dz * dz <= limit) {
          voxels[cellIndex(x, y, z)] = colour;
        }
      }
    }
  }
  paintPattern(voxels, colour);
  return voxels;
}

/** What a design works out to once measured. */
export interface ShapeStats {
  /** How many cubes were used. */
  cubes: number;
  /**
   * How high the ball sits when it is resting on the floor, measured from
   * its middle down to its outside.
   *
   * This is the distance to the flat outside of the block, not to its
   * furthest corner, because that is where the ball actually meets the
   * ground. Using the corner instead would leave the ball hovering a
   * centimetre or two above the floor and turning as though it were bigger
   * than it looks, which reads as sliding rather than rolling.
   */
  radius: number;
  /** How heavy the ball is, where ONE is the weight of the standard ball. */
  weight: number;
  /** How evenly the cubes sit around the middle, from 0 to ONE. */
  smoothness: number;
  /**
   * How hard the ball is to spin up, worked out from where its cubes sit.
   *
   * Weight gathered near the middle gives a small number and a ball that
   * gets going quickly; weight pushed out to the rim gives a large one and a
   * ball that is slow to start but keeps going. A solid, evenly filled ball
   * lands near 0.4, which is the figure a real one has.
   */
  spinResistance: number;
  /** Distance from the middle out to the furthest corner, for drawing. */
  reach: number;
}

/** The measurements of the ball everybody starts with, used as the yardstick. */
const REFERENCE_CUBES = countCubes(defaultShape());

function countCubes(voxels: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) n++;
  return n;
}

/**
 * Measures a design.
 *
 * Smoothness compares the average reach of the outer cubes with the longest
 * reach: a sphere scores near the top because every part of its surface is
 * about the same distance from the middle, while a cube or a spiky shape
 * scores lower and therefore rolls less predictably.
 */
export function measureShape(voxels: Uint8Array): ShapeStats {
  let cubes = 0;
  let longestSquared = 0;
  let surfaceCount = 0;
  let surfaceTotalSquared = 0;
  let centreTotalSquared = 0;
  // How far the solid body of the block reaches out, in half-cube steps.
  // Single cubes poking out on their own are left out of this: the ball
  // rests on its body, not on its whiskers.
  let outermost = 0;
  // The same measured over everything, used only if there is no body at all.
  let outermostIncludingSpikes = 0;

  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        if (voxels[cellIndex(x, y, z)] === 0) continue;
        cubes++;
        // Reach is measured to the far corner of the cube, in half-cube units,
        // so that everything stays a whole number.
        const dx = 2 * (x - SHAPE_CENTRE) + (x >= SHAPE_CENTRE ? 1 : -1);
        const dy = 2 * (y - SHAPE_CENTRE) + (y >= SHAPE_CENTRE ? 1 : -1);
        const dz = 2 * (z - SHAPE_CENTRE) + (z >= SHAPE_CENTRE ? 1 : -1);
        const reachSquared = dx * dx + dy * dy + dz * dz;
        if (reachSquared > longestSquared) longestSquared = reachSquared;

        // How far this cube sits from the middle, which is what decides how
        // hard the whole ball is to spin up.
        const midX = 2 * (x - SHAPE_CENTRE);
        const midY = 2 * (y - SHAPE_CENTRE);
        const midZ = 2 * (z - SHAPE_CENTRE);
        centreTotalSquared += midX * midX + midY * midY + midZ * midZ;

        // The outer faces of this cube, again in half-cube steps.
        const faceX = Math.abs(midX) + 1;
        const faceY = Math.abs(midY) + 1;
        const faceZ = Math.abs(midZ) + 1;
        const furthestFace = Math.max(faceX, faceY, faceZ);
        if (furthestFace > outermostIncludingSpikes) outermostIncludingSpikes = furthestFace;

        // A cube joined to the rest on at least three sides is part of the
        // body. One hanging off a corner is a whisker, and letting a whisker
        // set the resting height would hold the whole ball off the floor and
        // make it turn too slowly for the size it looks.
        const neighbours =
          (cellAt(voxels, x - 1, y, z) !== 0 ? 1 : 0) +
          (cellAt(voxels, x + 1, y, z) !== 0 ? 1 : 0) +
          (cellAt(voxels, x, y - 1, z) !== 0 ? 1 : 0) +
          (cellAt(voxels, x, y + 1, z) !== 0 ? 1 : 0) +
          (cellAt(voxels, x, y, z - 1) !== 0 ? 1 : 0) +
          (cellAt(voxels, x, y, z + 1) !== 0 ? 1 : 0);
        if (neighbours >= 3 && furthestFace > outermost) outermost = furthestFace;

        const exposed =
          cellAt(voxels, x - 1, y, z) === 0 ||
          cellAt(voxels, x + 1, y, z) === 0 ||
          cellAt(voxels, x, y - 1, z) === 0 ||
          cellAt(voxels, x, y + 1, z) === 0 ||
          cellAt(voxels, x, y, z - 1) === 0 ||
          cellAt(voxels, x, y, z + 1) === 0;
        if (exposed) {
          surfaceCount++;
          surfaceTotalSquared += reachSquared;
        }
      }
    }
  }

  if (cubes === 0) {
    const fallback = Math.round(CUBE_METRES * ONE);
    return {
      cubes: 0,
      radius: fallback,
      reach: fallback,
      weight: ONE >> 3,
      smoothness: ONE,
      spinResistance: Math.round(0.4 * ONE),
    };
  }

  // The ball rests on the flat outside of its body, so that is the distance
  // the physics uses as well: the drawn ball then sits on the floor and turns
  // at the rate its size calls for.
  if (outermost === 0) outermost = outermostIncludingSpikes;
  const averageSquared = div(surfaceTotalSquared, Math.max(1, surfaceCount));
  // Worked out from the cube size in one go rather than by adding up half
  // cubes, so the answer lands as close to the drawn shape as the numbers
  // allow: a few thousandths of a millimetre, rather than a few hundredths.
  const radius = Math.round((outermost / 2) * CUBE_METRES * ONE);
  const reach = mul(sqrt(longestSquared * ONE), HALF_CUBE);

  const ratio = longestSquared > 0 ? div(averageSquared, longestSquared * ONE) : ONE;
  const smoothness = Math.min(ONE, sqrt(ratio));
  const weight = Math.max(ONE >> 3, Math.round((cubes * ONE) / REFERENCE_CUBES));

  // Two thirds of the average distance from the middle, plus each cube's own
  // share, divided by the distance the ball rests on. The units cancel, so
  // this is a plain ratio and comes out at the textbook figures: about 0.4
  // for a solid ball, about 0.67 for a hollow shell.
  const meanCentreSquared = div(centreTotalSquared, cubes);
  const spread = mul(TWO_THIRDS, meanCentreSquared + ONE);
  const restingSquared = outermost * outermost * ONE;
  const spinResistance = clamp(
    restingSquared > 0 ? div(spread, restingSquared) : Math.round(0.4 * ONE),
    Math.round(0.12 * ONE),
    Math.round(1.4 * ONE),
  );

  const floor = Math.round((CUBE_METRES / 2) * ONE);
  return {
    cubes,
    radius: Math.max(floor, radius),
    reach: Math.max(floor, reach),
    weight,
    smoothness,
    spinResistance,
  };
}

/** A short fingerprint of a design, used to spot when it has changed. */
export function shapeFingerprint(voxels: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < voxels.length; i++) {
    h ^= voxels[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Packs a design into text so it can be saved or shared. */
export function shapeToText(voxels: Uint8Array): string {
  // Runs of identical slots are stored as "count:value", which keeps a
  // typical design well under a kilobyte.
  const parts: string[] = [];
  let runValue = voxels[0];
  let runLength = 1;
  for (let i = 1; i < voxels.length; i++) {
    if (voxels[i] === runValue) {
      runLength++;
    } else {
      parts.push(`${runLength}:${runValue}`);
      runValue = voxels[i];
      runLength = 1;
    }
  }
  parts.push(`${runLength}:${runValue}`);
  return parts.join(',');
}

/** Unpacks a design saved by {@link shapeToText}. */
export function shapeFromText(text: string): Uint8Array {
  const voxels = new Uint8Array(SHAPE_CELLS);
  let at = 0;
  for (const part of text.split(',')) {
    const [countText, valueText] = part.split(':');
    const count = Number(countText);
    const value = Number(valueText);
    if (!Number.isFinite(count) || !Number.isFinite(value)) continue;
    for (let i = 0; i < count && at < voxels.length; i++) {
      voxels[at++] = value & 0xff;
    }
  }
  return voxels;
}

/** Removes stray cubes that are not joined to the main lump. */
export function largestConnectedPart(voxels: Uint8Array): Uint8Array {
  const seen = new Uint8Array(SHAPE_CELLS);
  const result = new Uint8Array(SHAPE_CELLS);
  let bestSize = 0;
  let bestGroup: number[] = [];
  const queue = new Int32Array(SHAPE_CELLS);

  for (let start = 0; start < SHAPE_CELLS; start++) {
    if (voxels[start] === 0 || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    const group: number[] = [];
    while (head < tail) {
      const cell = queue[head++];
      group.push(cell);
      const z = cell % SHAPE_SIZE;
      const y = Math.floor(cell / SHAPE_SIZE) % SHAPE_SIZE;
      const x = Math.floor(cell / (SHAPE_SIZE * SHAPE_SIZE));
      const neighbours = [
        [x - 1, y, z],
        [x + 1, y, z],
        [x, y - 1, z],
        [x, y + 1, z],
        [x, y, z - 1],
        [x, y, z + 1],
      ];
      for (const [nx, ny, nz] of neighbours) {
        if (!insideShape(nx, ny, nz)) continue;
        const index = cellIndex(nx, ny, nz);
        if (seen[index] || voxels[index] === 0) continue;
        seen[index] = 1;
        queue[tail++] = index;
      }
    }
    if (group.length > bestSize) {
      bestSize = group.length;
      bestGroup = group;
    }
  }

  for (const cell of bestGroup) result[cell] = voxels[cell];
  return result;
}
