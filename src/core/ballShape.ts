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
import { Generator, mix } from './random';

/**
 * Cubes per side of the editing space.
 *
 * Twice the old count, with cubes half the size, so a ball is exactly as big
 * as it was but built from eight times as many pieces. That makes a round
 * ball noticeably rounder and gives the workshop much finer control.
 */
export const SHAPE_SIZE = 18;

/** Total number of cube slots. */
export const SHAPE_CELLS = SHAPE_SIZE * SHAPE_SIZE * SHAPE_SIZE;

/**
 * The middle of the editing space, in cube steps. With an even number of
 * cubes per side this falls between two of them, which every measurement
 * here copes with.
 */
export const SHAPE_CENTRE = (SHAPE_SIZE - 1) / 2;

/** How wide one cube is, in metres, at the standard ball size. */
export const CUBE_METRES = 0.05;

/**
 * Colours a cube can be painted. Slot 0 means "no cube here".
 *
 * The first nine are the colours the game shipped with, and they stay where
 * they are: a design saved before the palette grew keeps exactly the colours
 * it was built in. Everything after them is new, laid out as rows of a hue
 * so the workshop can show it as a proper palette.
 */
export const PALETTE = [
  '#000000',
  // The original nine.
  '#ff5b6e',
  '#ffb03a',
  '#ffe45e',
  '#66d97a',
  '#4fc3f7',
  '#8f7bff',
  '#ff8fd0',
  '#f5f5f5',
  '#3a3f52',
  // Deeper shades of the same hues.
  '#c62839',
  '#d97706',
  '#c9a227',
  '#2f9e5c',
  '#1976a8',
  '#5b3fbf',
  '#c2508f',
  '#9aa4bf',
  '#12162a',
  // Softer shades, for anything that wants to look gentle.
  '#ffb3bb',
  '#ffd9a8',
  '#fff4b8',
  '#b7ecc3',
  '#a9e2fb',
  '#cfc4ff',
  '#ffd0e8',
  '#ffffff',
  '#6b7392',
  // A few that are hard to reach by mixing the rest.
  '#00c2a8',
  '#7cd44b',
  '#ff6a00',
  '#8b5a2b',
];

/** How many swatches sit on one row of the workshop's palette. */
export const PALETTE_ROW = 9;

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
  // Stops short of the edge of the editing space on purpose, so that there is
  // somewhere to stick a lump on. Filling the space to the brim would leave
  // the "add" tool with nowhere to put anything.
  const limit = 7.6 * 7.6;
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
  for (let x = 2; x < SHAPE_SIZE - 2; x++) {
    for (let y = 2; y < SHAPE_SIZE - 2; y++) {
      for (let z = 2; z < SHAPE_SIZE - 2; z++) {
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
  const limit = 5.2 * 5.2;
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

/** How many cubes a design uses. */
function countFilled(voxels: Uint8Array): number {
  let used = 0;
  for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) used++;
  return used;
}

/** The kinds of chaotic ball the workshop can throw together. */
const RANDOM_STYLES = 10;

/** A whole number from the generator, as a decimal between -1 and 1. */
function spread(rng: Generator): number {
  return rng.signedUnit() / ONE;
}

/** A whole number from the generator, as a decimal between 0 and 1. */
function unit(rng: Generator): number {
  return rng.unit() / ONE;
}

/** Fills or clears a ball of cubes centred anywhere in the space. */
function blob(
  voxels: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  size: number,
  paint: number,
): void {
  const limit = size * size;
  const from = Math.max(0, Math.floor(Math.min(cx, cy, cz) - size));
  const to = Math.min(SHAPE_SIZE - 1, Math.ceil(Math.max(cx, cy, cz) + size));
  for (let x = from; x <= to; x++) {
    for (let y = from; y <= to; y++) {
      for (let z = from; z <= to; z++) {
        const dx = x - cx;
        const dy = y - cy;
        const dz = z - cz;
        if (dx * dx + dy * dy + dz * dz <= limit) voxels[cellIndex(x, y, z)] = paint;
      }
    }
  }
}

/** Fills or clears a box of cubes. */
function slab(
  voxels: Uint8Array,
  cx: number,
  cy: number,
  cz: number,
  halfX: number,
  halfY: number,
  halfZ: number,
  paint: number,
): void {
  for (let x = 0; x < SHAPE_SIZE; x++) {
    if (Math.abs(x - cx) > halfX) continue;
    for (let y = 0; y < SHAPE_SIZE; y++) {
      if (Math.abs(y - cy) > halfY) continue;
      for (let z = 0; z < SHAPE_SIZE; z++) {
        if (Math.abs(z - cz) > halfZ) continue;
        voxels[cellIndex(x, y, z)] = paint;
      }
    }
  }
}

/** Runs a line of cubes out from a point, for spikes and arms. */
function prong(
  voxels: Uint8Array,
  fromX: number,
  fromY: number,
  fromZ: number,
  stepX: number,
  stepY: number,
  stepZ: number,
  length: number,
  thickness: number,
  paint: number,
): void {
  for (let step = 0; step < length; step++) {
    const x = fromX + stepX * step;
    const y = fromY + stepY * step;
    const z = fromZ + stepZ * step;
    if (!insideShape(Math.round(x), Math.round(y), Math.round(z))) break;
    // Tapers as it goes out, so a spike looks like a spike.
    const width = Math.max(0, thickness * (1 - step / Math.max(1, length)));
    blob(voxels, x, y, z, Math.max(0.4, width), paint);
  }
}

/** Paints a finished shape in one of several ways, purely for the look. */
function paintRandomly(voxels: Uint8Array, rng: Generator, colour: number): void {
  const scheme = rng.below(6);
  const other = 1 + rng.below(PALETTE.length - 1);
  const third = 1 + rng.below(PALETTE.length - 1);
  const cutX = spread(rng);
  const cutY = spread(rng);
  const cutZ = spread(rng);

  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const index = cellIndex(x, y, z);
        if (voxels[index] === 0) continue;
        const dx = x - SHAPE_CENTRE;
        const dy = y - SHAPE_CENTRE;
        const dz = z - SHAPE_CENTRE;
        switch (scheme) {
          case 0:
            voxels[index] = colour;
            break;
          case 1:
            // Split down a slanted plane.
            voxels[index] = dx * cutX + dy * cutY + dz * cutZ > 0 ? colour : other;
            break;
          case 2: {
            // Rings, by how far out the cube sits.
            const far = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz) / 2.2);
            voxels[index] = far % 2 === 0 ? colour : other;
            break;
          }
          case 3:
            // Layers, from bottom to top.
            voxels[index] = [colour, other, third][Math.abs(y) % 3];
            break;
          case 4: {
            // Speckled, but the same speckles for the same seed.
            const pick = mix(x, y, z) % 3;
            voxels[index] = [colour, other, third][pick];
            break;
          }
          default:
            // Checked, in blocks of three.
            voxels[index] =
              (Math.floor(x / 3) + Math.floor(y / 3) + Math.floor(z / 3)) % 2 === 0
                ? colour
                : other;
            break;
        }
      }
    }
  }
}

/**
 * A chaotic ball, in one of a good many styles.
 *
 * The same seed always makes the same ball, so a design can be saved or
 * shared; the workshop simply asks for a different seed each time the button
 * is pressed. How it then rolls falls out of the shape, so a spiky one really
 * is harder work than a smooth one.
 */
export function randomShape(seed: number, colour = 6): Uint8Array {
  const rng = new Generator(seed >>> 0);
  const voxels = new Uint8Array(SHAPE_CELLS);
  const middle = SHAPE_CENTRE;
  const reach = SHAPE_CENTRE;
  const style = rng.below(RANDOM_STYLES);

  switch (style) {
    case 0: {
      // Overlapping lumps: a potato.
      const lumps = 3 + rng.below(5);
      for (let lump = 0; lump < lumps; lump++) {
        blob(
          voxels,
          middle + spread(rng) * reach * 0.45,
          middle + spread(rng) * reach * 0.45,
          middle + spread(rng) * reach * 0.45,
          reach * (0.34 + unit(rng) * 0.4),
          1,
        );
      }
      break;
    }
    case 1: {
      // A core with spikes all over it: a sea urchin.
      blob(voxels, middle, middle, middle, reach * (0.3 + unit(rng) * 0.2), 1);
      const spikes = 5 + rng.below(9);
      for (let spike = 0; spike < spikes; spike++) {
        const dx = spread(rng);
        const dy = spread(rng);
        const dz = spread(rng);
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        prong(
          voxels,
          middle,
          middle,
          middle,
          dx / length,
          dy / length,
          dz / length,
          Math.round(reach * (0.7 + unit(rng) * 0.35)),
          1.6,
          1,
        );
      }
      break;
    }
    case 2: {
      // A ring with a hole through the middle.
      blob(voxels, middle, middle, middle, reach * 0.92, 1);
      const axis = rng.below(3);
      const bore = reach * (0.22 + unit(rng) * 0.2);
      for (let step = -SHAPE_SIZE; step <= SHAPE_SIZE; step++) {
        blob(
          voxels,
          middle + (axis === 0 ? step : 0),
          middle + (axis === 1 ? step : 0),
          middle + (axis === 2 ? step : 0),
          bore,
          0,
        );
      }
      break;
    }
    case 3: {
      // Slabs stacked at angles: something quarried.
      const slabs = 2 + rng.below(4);
      for (let piece = 0; piece < slabs; piece++) {
        slab(
          voxels,
          middle + spread(rng) * reach * 0.4,
          middle + spread(rng) * reach * 0.4,
          middle + spread(rng) * reach * 0.4,
          reach * (0.25 + unit(rng) * 0.55),
          reach * (0.2 + unit(rng) * 0.5),
          reach * (0.25 + unit(rng) * 0.55),
          1,
        );
      }
      break;
    }
    case 4: {
      // Riddled with holes.
      blob(voxels, middle, middle, middle, reach * (0.75 + unit(rng) * 0.2), 1);
      const holes = 6 + rng.below(10);
      for (let hole = 0; hole < holes; hole++) {
        blob(
          voxels,
          middle + spread(rng) * reach,
          middle + spread(rng) * reach,
          middle + spread(rng) * reach,
          reach * (0.14 + unit(rng) * 0.24),
          0,
        );
      }
      break;
    }
    case 5: {
      // Long and thin: a roller rather than a ball.
      const axis = rng.below(3);
      const long = reach * (0.75 + unit(rng) * 0.25);
      const thin = reach * (0.3 + unit(rng) * 0.25);
      slab(
        voxels,
        middle,
        middle,
        middle,
        axis === 0 ? long : thin,
        axis === 1 ? long : thin,
        axis === 2 ? long : thin,
        1,
      );
      // Rounded off at the ends.
      for (const end of [-1, 1]) {
        blob(
          voxels,
          middle + (axis === 0 ? end * long : 0),
          middle + (axis === 1 ? end * long : 0),
          middle + (axis === 2 ? end * long : 0),
          thin,
          1,
        );
      }
      break;
    }
    case 6: {
      // Several balls in a cluster, joined by arms.
      const balls = 3 + rng.below(4);
      const spots: [number, number, number][] = [];
      for (let ball = 0; ball < balls; ball++) {
        const x = middle + spread(rng) * reach * 0.6;
        const y = middle + spread(rng) * reach * 0.6;
        const z = middle + spread(rng) * reach * 0.6;
        spots.push([x, y, z]);
        blob(voxels, x, y, z, reach * (0.22 + unit(rng) * 0.24), 1);
      }
      for (let i = 1; i < spots.length; i++) {
        const [ax, ay, az] = spots[i - 1];
        const [bx, by, bz] = spots[i];
        const steps = Math.round(reach);
        for (let step = 0; step <= steps; step++) {
          const t = step / steps;
          blob(voxels, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 1.4, 1);
        }
      }
      break;
    }
    case 7: {
      // Cut flat by a few planes: a rough gemstone.
      blob(voxels, middle, middle, middle, reach * 0.95, 1);
      const cuts = 3 + rng.below(5);
      for (let cut = 0; cut < cuts; cut++) {
        const nx = spread(rng);
        const ny = spread(rng);
        const nz = spread(rng);
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        const at = reach * (0.35 + unit(rng) * 0.45);
        for (let x = 0; x < SHAPE_SIZE; x++) {
          for (let y = 0; y < SHAPE_SIZE; y++) {
            for (let z = 0; z < SHAPE_SIZE; z++) {
              const along =
                ((x - middle) * nx + (y - middle) * ny + (z - middle) * nz) / length;
              if (along > at) voxels[cellIndex(x, y, z)] = 0;
            }
          }
        }
      }
      break;
    }
    case 8: {
      // A shell with the middle scooped out and windows cut in it.
      blob(voxels, middle, middle, middle, reach * 0.95, 1);
      blob(voxels, middle, middle, middle, reach * (0.45 + unit(rng) * 0.25), 0);
      const windows = 3 + rng.below(5);
      for (let window = 0; window < windows; window++) {
        blob(
          voxels,
          middle + spread(rng) * reach,
          middle + spread(rng) * reach,
          middle + spread(rng) * reach,
          reach * (0.2 + unit(rng) * 0.2),
          0,
        );
      }
      break;
    }
    default: {
      // A staircase of blocks winding around the middle.
      const turns = 3 + rng.below(6);
      const rise = (reach * 1.6) / turns;
      for (let turn = 0; turn < turns; turn++) {
        const angle = (turn / turns) * Math.PI * 2 * (1 + unit(rng));
        const out = reach * (0.25 + unit(rng) * 0.4);
        slab(
          voxels,
          middle + Math.cos(angle) * out,
          middle - reach * 0.8 + rise * turn,
          middle + Math.sin(angle) * out,
          reach * 0.28,
          rise * 0.7,
          reach * 0.28,
          1,
        );
      }
      break;
    }
  }

  // A few extra lumps or bites, whatever the style, so no two are alike.
  const extras = rng.below(4);
  for (let extra = 0; extra < extras; extra++) {
    blob(
      voxels,
      middle + spread(rng) * reach,
      middle + spread(rng) * reach,
      middle + spread(rng) * reach,
      reach * (0.12 + unit(rng) * 0.22),
      rng.below(2) === 0 ? 1 : 0,
    );
  }

  let tidied = largestConnectedPart(voxels);
  // A style can cut itself down to almost nothing. Rather than throwing the
  // shape away, give it a core to hang on to: it keeps its character and
  // becomes a ball somebody can actually get down a hill.
  if (countFilled(tidied) < 250) {
    blob(tidied, middle, middle, middle, reach * 0.5, 1);
    tidied = largestConnectedPart(tidied);
  }
  if (countFilled(tidied) < 60) return defaultShape(colour);

  paintRandomly(tidied, rng, colour);
  return tidied;
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
   * How much of the outside sticks out past the body the ball rests on,
   * from 0 to ONE. One lump makes a little; a ball covered in them makes a
   * lot, and each one is another thing to trip over as it rolls.
   */
  proudShare: number;
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
  // Where every cube's outer face sits, kept so that the ones standing proud
  // of the body can be counted once the body is known.
  const faceReach: number[] = [];

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
        faceReach.push(furthestFace);

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
      proudShare: 0,
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

  // How many cubes stand proud of the body, against how many are on the
  // outside at all. One lump is a small share; a ball bristling with them is
  // a large one, and every one is another thing to catch on.
  let proud = 0;
  for (const face of faceReach) {
    if (face > outermost) proud++;
  }
  const proudShare = clamp(div(proud, Math.max(1, surfaceCount)), 0, ONE);

  const floor = Math.round((CUBE_METRES / 2) * ONE);
  return {
    cubes,
    radius: Math.max(floor, radius),
    reach: Math.max(floor, reach),
    weight,
    smoothness,
    proudShare,
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

/**
 * How many cube slots a saved design covers, without unpacking it. Used to
 * spot a design saved before the cubes were made finer.
 */
export function shapeTextCells(text: string): number {
  let total = 0;
  for (const part of text.split(',')) {
    const count = Number(part.split(':')[0]);
    if (Number.isFinite(count) && count > 0) total += count;
  }
  return total;
}

/**
 * Doubles a design built in the old, coarser space so that it fills the new
 * one: every old cube becomes a two-by-two-by-two block. A ball built before
 * the change comes back looking exactly as it did.
 */
export function upscaleShape(coarse: Uint8Array, coarseSize: number): Uint8Array {
  const voxels = new Uint8Array(SHAPE_CELLS);
  const scale = Math.max(1, Math.round(SHAPE_SIZE / coarseSize));
  for (let x = 0; x < coarseSize; x++) {
    for (let y = 0; y < coarseSize; y++) {
      for (let z = 0; z < coarseSize; z++) {
        const slot = coarse[(x * coarseSize + y) * coarseSize + z];
        if (slot === 0) continue;
        for (let ox = 0; ox < scale; ox++) {
          for (let oy = 0; oy < scale; oy++) {
            for (let oz = 0; oz < scale; oz++) {
              const nx = x * scale + ox;
              const ny = y * scale + oy;
              const nz = z * scale + oz;
              if (insideShape(nx, ny, nz)) voxels[cellIndex(nx, ny, nz)] = slot;
            }
          }
        }
      }
    }
  }
  return voxels;
}

/** Unpacks a design saved by {@link shapeToText}. */
export function shapeFromText(text: string, cells = SHAPE_CELLS): Uint8Array {
  const voxels = new Uint8Array(cells);
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
