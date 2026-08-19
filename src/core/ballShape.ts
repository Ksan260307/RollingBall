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

/**
 * Where the colours a player mixed themselves begin.
 *
 * Cube slots hold a whole number, so the ready-made colours sit at the
 * bottom and anything mixed by hand is counted from here. Leaving a gap
 * means more ready-made colours can be added later without disturbing a
 * ball somebody has already made.
 */
export const MIXED_BASE = 64;

/** How many colours can be mixed for one ball. */
export const MIXED_LIMIT = 12;

/**
 * The colour a cube slot stands for.
 *
 * @param slot what the cube holds
 * @param mixed the colours mixed for this particular ball
 */
export function colourAt(slot: number, mixed: readonly string[] = []): string {
  if (slot >= MIXED_BASE) return mixed[slot - MIXED_BASE] ?? PALETTE[8];
  return PALETTE[slot] ?? PALETTE[8];
}

/** True if a piece of text is a colour we can actually use. */
export function isColour(text: unknown): text is string {
  return typeof text === 'string' && /^#[0-9a-f]{6}$/i.test(text);
}

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
const RANDOM_STYLES = 24;

/**
 * How many ways a body can be finished off once it has been built.
 *
 * Every body can come out plain, pulled out of shape, hollowed into a
 * shell, covered in studs, or sanded round. Each is a different ball to look
 * at and a different ball to roll, and the last two in particular reach
 * kinds of ball the bodies never made on their own: nothing was properly
 * spiky before, and very little was properly round.
 */
const RANDOM_FINISHES = 5;

/**
 * How many ways a body can be put together before it is finished off.
 *
 * This axis is about how even the ball is, which is the thing that decides
 * whether it will hold a line. Left to itself a body comes out lopsided as
 * often as not; folding it against its own mirror makes it deliberately
 * even; folding it against a turned copy of itself makes something more
 * complicated than either. Three builds, five finishes and two dozen
 * bodies is three hundred and sixty ways round.
 */
const RANDOM_BUILDS = 3;

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
  const scheme = rng.below(12);
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
          case 5:
            // Checked, in blocks of three.
            voxels[index] =
              (Math.floor(x / 3) + Math.floor(y / 3) + Math.floor(z / 3)) % 2 === 0
                ? colour
                : other;
            break;
          case 6: {
            // Stripes running round one way, like a beach ball.
            const round = Math.round((Math.atan2(dz, dx) / Math.PI) * 4);
            voxels[index] = round % 2 === 0 ? colour : other;
            break;
          }
          case 7: {
            // A cap of another colour on top, and one underneath.
            const height = dy / Math.max(1, SHAPE_CENTRE);
            voxels[index] = height > 0.45 ? other : height < -0.45 ? third : colour;
            break;
          }
          case 8: {
            // Patches, big and soft-edged.
            const patch = mix(Math.floor(x / 4), Math.floor(y / 4), Math.floor(z / 4)) % 3;
            voxels[index] = [colour, other, third][patch];
            break;
          }
          case 9: {
            // Fading out from the middle through three shades.
            const far = Math.sqrt(dx * dx + dy * dy + dz * dz) / Math.max(1, SHAPE_CENTRE);
            voxels[index] = far > 0.8 ? third : far > 0.5 ? other : colour;
            break;
          }
          case 10: {
            // Quarters, like a beach ball seen end on.
            const quarter = (dx > 0 ? 1 : 0) + (dz > 0 ? 2 : 0);
            voxels[index] = [colour, other, third, colour][quarter];
            break;
          }
          default: {
            // A spiral wound round the middle.
            const round = Math.atan2(dz, dx) / (Math.PI * 2);
            const along = dy / Math.max(1, SHAPE_CENTRE);
            voxels[index] = Math.floor((round + along) * 4) % 2 === 0 ? colour : other;
            break;
          }
            break;
        }
      }
    }
  }
}

/**
 * Pulls a shape out along one direction and squashes it in the others.
 *
 * A potato becomes a rugby ball; a ring becomes an oval. It reads as a
 * different ball straight away, and it rolls like one too, because the
 * distance from the middle to the floor now depends on which way up it is.
 */
function stretched(voxels: Uint8Array, axis: number, pull: number): Uint8Array {
  const out = new Uint8Array(SHAPE_CELLS);
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        // Read from wherever this cell has been pulled away from.
        const fx = axis === 0 ? (x - SHAPE_CENTRE) / pull : (x - SHAPE_CENTRE) * pull;
        const fy = axis === 1 ? (y - SHAPE_CENTRE) / pull : (y - SHAPE_CENTRE) * pull;
        const fz = axis === 2 ? (z - SHAPE_CENTRE) / pull : (z - SHAPE_CENTRE) * pull;
        const cube = cellAt(
          voxels,
          Math.round(SHAPE_CENTRE + fx),
          Math.round(SHAPE_CENTRE + fy),
          Math.round(SHAPE_CENTRE + fz),
        );
        if (cube !== 0) out[cellIndex(x, y, z)] = cube;
      }
    }
  }
  return out;
}

/**
 * Scoops the middle out and cuts a few windows, leaving a shell.
 *
 * Only the cubes with a filled cube on every side go: what is left is the
 * outside of whatever was built, which keeps the character of the body
 * while weighing a fraction of it.
 */
function hollowed(voxels: Uint8Array, rng: Generator): Uint8Array {
  const out = Uint8Array.from(voxels);
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        if (voxels[cellIndex(x, y, z)] === 0) continue;
        const buried =
          cellAt(voxels, x - 1, y, z) !== 0 &&
          cellAt(voxels, x + 1, y, z) !== 0 &&
          cellAt(voxels, x, y - 1, z) !== 0 &&
          cellAt(voxels, x, y + 1, z) !== 0 &&
          cellAt(voxels, x, y, z - 1) !== 0 &&
          cellAt(voxels, x, y, z + 1) !== 0;
        if (buried) out[cellIndex(x, y, z)] = 0;
      }
    }
  }
  // A window or two, so it reads as hollow rather than merely light.
  const windows = 1 + rng.below(3);
  for (let window = 0; window < windows; window++) {
    blob(
      out,
      SHAPE_CENTRE + spread(rng) * SHAPE_CENTRE,
      SHAPE_CENTRE + spread(rng) * SHAPE_CENTRE,
      SHAPE_CENTRE + spread(rng) * SHAPE_CENTRE,
      SHAPE_CENTRE * (0.18 + unit(rng) * 0.2),
      0,
    );
  }
  return out;
}

/** Merges one shape into another, keeping whatever either of them had. */
function mergeInto(into: Uint8Array, from: Uint8Array): void {
  for (let i = 0; i < SHAPE_CELLS; i++) {
    if (into[i] === 0 && from[i] !== 0) into[i] = from[i];
  }
}

/**
 * Folds a shape against its own mirror, so both sides match.
 *
 * An even ball turns about its own middle and goes where it is sent. This
 * is how a chaotic shape gets to be even on purpose rather than by luck,
 * and it is the difference between a ball that has to be fought and one
 * that can be trusted.
 */
function mirrored(voxels: Uint8Array, axis: number): Uint8Array {
  const out = Uint8Array.from(voxels);
  const flipped = new Uint8Array(SHAPE_CELLS);
  const last = SHAPE_SIZE - 1;
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const cube = voxels[cellIndex(x, y, z)];
        if (cube === 0) continue;
        flipped[
          cellIndex(axis === 0 ? last - x : x, axis === 1 ? last - y : y, axis === 2 ? last - z : z)
        ] = cube;
      }
    }
  }
  mergeInto(out, flipped);
  return out;
}

/**
 * Folds a shape against a quarter-turned copy of itself.
 *
 * What comes out has more going on than the body did on its own — arms
 * where there was one arm, corners where there was one corner — while still
 * being recognisably built from the same thing.
 */
function twinned(voxels: Uint8Array, axis: number): Uint8Array {
  const out = Uint8Array.from(voxels);
  const turned = new Uint8Array(SHAPE_CELLS);
  const middle = SHAPE_CENTRE;
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const cube = voxels[cellIndex(x, y, z)];
        if (cube === 0) continue;
        const dx = x - middle;
        const dy = y - middle;
        const dz = z - middle;
        // A quarter turn about the chosen way up.
        const tx = axis === 0 ? dx : axis === 1 ? dz : dy;
        const ty = axis === 0 ? dz : axis === 1 ? dy : -dx;
        const tz = axis === 0 ? -dy : axis === 1 ? -dx : dz;
        const px = Math.round(middle + tx);
        const py = Math.round(middle + ty);
        const pz = Math.round(middle + tz);
        if (insideShape(px, py, pz)) turned[cellIndex(px, py, pz)] = cube;
      }
    }
  }
  mergeInto(out, turned);
  return out;
}

/**
 * Covers whatever was built in short studs.
 *
 * Nothing the bodies make on their own comes out properly spiky, and a
 * spiky ball rolls quite unlike a smooth one, so this is a whole corner of
 * the range that only exists because of this pass.
 */
function studded(voxels: Uint8Array, rng: Generator): Uint8Array {
  const out = Uint8Array.from(voxels);
  const middle = SHAPE_CENTRE;
  const studs = 10 + rng.below(18);
  for (let stud = 0; stud < studs; stud++) {
    const dx = spread(rng);
    const dy = spread(rng);
    const dz = spread(rng);
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    // Walk out from the middle until the body ends, then keep going a
    // little: the stud starts where the surface is, whatever shape it is.
    let at = 0;
    for (let step = 1; step <= SHAPE_CENTRE * 2; step++) {
      const x = Math.round(middle + (dx / length) * step * 0.5);
      const y = Math.round(middle + (dy / length) * step * 0.5);
      const z = Math.round(middle + (dz / length) * step * 0.5);
      if (cellAt(voxels, x, y, z) !== 0) at = step;
    }
    if (at === 0) continue;
    const out2 = at * 0.5 + 1 + unit(rng) * 2.5;
    prong(
      out,
      middle,
      middle,
      middle,
      dx / length,
      dy / length,
      dz / length,
      Math.round(out2),
      1.5 + unit(rng) * 0.9,
      1,
    );
  }
  return out;
}

/**
 * Sands the shape back to something much closer to a ball.
 *
 * Takes off everything past a chosen radius and fills in what is inside it,
 * keeping only the parts of the body that stuck out far enough to survive.
 * What comes out is round with a memory of what it was, which is a kind of
 * ball the bodies almost never made by themselves.
 */
function rounded(voxels: Uint8Array, rng: Generator): Uint8Array {
  const out = new Uint8Array(SHAPE_CELLS);
  const middle = SHAPE_CENTRE;
  const keep = SHAPE_CENTRE * (0.6 + unit(rng) * 0.3);
  const core = keep * (0.55 + unit(rng) * 0.25);
  let paint = 0;
  for (let x = 0; x < SHAPE_SIZE && paint === 0; x++) {
    for (let y = 0; y < SHAPE_SIZE && paint === 0; y++) {
      for (let z = 0; z < SHAPE_SIZE && paint === 0; z++) {
        paint = voxels[cellIndex(x, y, z)];
      }
    }
  }
  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const dx = x - middle;
        const dy = y - middle;
        const dz = z - middle;
        const far = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (far > keep) continue;
        const was = voxels[cellIndex(x, y, z)];
        // Solid in the middle; outside that, only where the body reached.
        if (far <= core) out[cellIndex(x, y, z)] = was !== 0 ? was : paint || 8;
        else if (was !== 0) out[cellIndex(x, y, z)] = was;
      }
    }
  }
  return out;
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
    case 9: {
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
    case 10: {
      // Studded all over with short stubs: a sweet covered in sugar.
      blob(voxels, middle, middle, middle, reach * (0.62 + unit(rng) * 0.16), 1);
      const studs = 14 + rng.below(20);
      for (let stud = 0; stud < studs; stud++) {
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
          Math.round(reach * (0.8 + unit(rng) * 0.2)),
          2.4,
          1,
        );
      }
      break;
    }
    case 11: {
      // A coil wound round and round: a spring.
      const loops = 2 + rng.below(4);
      const out = reach * (0.5 + unit(rng) * 0.3);
      const thick = 1.6 + unit(rng) * 1.4;
      const steps = Math.round(reach * 9);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const angle = t * Math.PI * 2 * loops;
        blob(
          voxels,
          middle + Math.cos(angle) * out,
          middle - reach * 0.85 + t * reach * 1.7,
          middle + Math.sin(angle) * out,
          thick,
          1,
        );
      }
      break;
    }
    case 12: {
      // A block with its corners knocked off, and pips dug into the faces.
      slab(voxels, middle, middle, middle, reach * 0.78, reach * 0.78, reach * 0.78, 1);
      const knock = reach * (0.9 + unit(rng) * 0.3);
      for (const cx of [-1, 1]) {
        for (const cy of [-1, 1]) {
          for (const cz of [-1, 1]) {
            blob(
              voxels,
              middle + cx * reach * 0.78,
              middle + cy * reach * 0.78,
              middle + cz * reach * 0.78,
              reach * 0.78 * 1.42 - knock * 0.6,
              0,
            );
          }
        }
      }
      const pips = 3 + rng.below(6);
      for (let pip = 0; pip < pips; pip++) {
        const face = rng.below(6);
        const along = reach * 0.8;
        blob(
          voxels,
          middle + (face === 0 ? along : face === 1 ? -along : spread(rng) * reach * 0.45),
          middle + (face === 2 ? along : face === 3 ? -along : spread(rng) * reach * 0.45),
          middle + (face === 4 ? along : face === 5 ? -along : spread(rng) * reach * 0.45),
          reach * (0.14 + unit(rng) * 0.1),
          0,
        );
      }
      break;
    }
    case 13: {
      // Shells inside shells, with a slice taken out so you can see in.
      const shells = 2 + rng.below(3);
      for (let shell = 0; shell < shells; shell++) {
        const outer = reach * (0.95 - shell * 0.3);
        blob(voxels, middle, middle, middle, outer, 1);
        blob(voxels, middle, middle, middle, outer - reach * 0.12, 0);
      }
      blob(voxels, middle, middle, middle, reach * 0.2, 1);
      // The slice: a quarter taken away.
      const keepX = spread(rng) > 0 ? 1 : -1;
      const keepZ = spread(rng) > 0 ? 1 : -1;
      for (let x = 0; x < SHAPE_SIZE; x++) {
        for (let y = 0; y < SHAPE_SIZE; y++) {
          for (let z = 0; z < SHAPE_SIZE; z++) {
            if ((x - middle) * keepX > 0 && (z - middle) * keepZ > 0) {
              voxels[cellIndex(x, y, z)] = 0;
            }
          }
        }
      }
      break;
    }
    case 14: {
      // Two rings threaded through each other.
      for (const axis of [0, 1]) {
        blob(voxels, middle, middle, middle, reach * 0.9, 1);
        const bore = reach * (0.3 + unit(rng) * 0.15);
        for (let step = -SHAPE_SIZE; step <= SHAPE_SIZE; step++) {
          blob(
            voxels,
            middle + (axis === 0 ? step : 0),
            middle + (axis === 1 ? step : 0),
            middle,
            bore,
            0,
          );
        }
      }
      break;
    }
    case 15: {
      // Spikes on one side only, so it never settles the same way twice.
      blob(voxels, middle, middle, middle, reach * (0.6 + unit(rng) * 0.2), 1);
      const side = spread(rng) > 0 ? 1 : -1;
      const spikes = 5 + rng.below(7);
      for (let spike = 0; spike < spikes; spike++) {
        const dy = Math.abs(spread(rng)) * side;
        const dx = spread(rng);
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
          Math.round(reach * (0.9 + unit(rng) * 0.3)),
          1.8,
          1,
        );
      }
      break;
    }
    case 16: {
      // Sliced away on four slants: something between a top and a pyramid.
      blob(voxels, middle, middle, middle, reach * 0.95, 1);
      const point = spread(rng) > 0 ? 1 : -1;
      for (let x = 0; x < SHAPE_SIZE; x++) {
        for (let y = 0; y < SHAPE_SIZE; y++) {
          for (let z = 0; z < SHAPE_SIZE; z++) {
            const up = (y - middle) * point;
            const wide = Math.max(Math.abs(x - middle), Math.abs(z - middle));
            if (wide > reach * 0.95 - up * 0.9) voxels[cellIndex(x, y, z)] = 0;
          }
        }
      }
      break;
    }
    case 17: {
      // A folded sheet, like a crisp.
      const thick = 1.4 + unit(rng) * 1.2;
      const waves = 1 + unit(rng) * 2;
      const depth = reach * (0.3 + unit(rng) * 0.4);
      for (let x = 0; x < SHAPE_SIZE; x++) {
        for (let z = 0; z < SHAPE_SIZE; z++) {
          const dx = (x - middle) / reach;
          const dz = (z - middle) / reach;
          if (dx * dx + dz * dz > 1) continue;
          const lift = Math.sin(dx * Math.PI * waves) * Math.cos(dz * Math.PI * waves) * depth;
          blob(voxels, x, middle + lift, z, thick, 1);
        }
      }
      break;
    }
    case 18: {
      // A bunch of berries pressed together.
      const berries = 8 + rng.below(10);
      for (let berry = 0; berry < berries; berry++) {
        const dx = spread(rng);
        const dy = spread(rng);
        const dz = spread(rng);
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const out = reach * (0.35 + unit(rng) * 0.4);
        blob(
          voxels,
          middle + (dx / length) * out,
          middle + (dy / length) * out,
          middle + (dz / length) * out,
          reach * (0.2 + unit(rng) * 0.16),
          1,
        );
      }
      blob(voxels, middle, middle, middle, reach * 0.34, 1);
      break;
    }
    case 19: {
      // Craters scooped out of the surface: the moon.
      blob(voxels, middle, middle, middle, reach * 0.95, 1);
      const craters = 5 + rng.below(8);
      for (let crater = 0; crater < craters; crater++) {
        const dx = spread(rng);
        const dy = spread(rng);
        const dz = spread(rng);
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const size = reach * (0.24 + unit(rng) * 0.3);
        blob(
          voxels,
          middle + (dx / length) * reach,
          middle + (dy / length) * reach,
          middle + (dz / length) * reach,
          size,
          0,
        );
      }
      break;
    }
    case 20: {
      // A column given a twist.
      const height = reach * (0.8 + unit(rng) * 0.2);
      const twist = (1 + unit(rng) * 3) * Math.PI;
      const arm = reach * (0.4 + unit(rng) * 0.3);
      const arms = 2 + rng.below(3);
      const steps = Math.round(height * 4);
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const y = middle - height + t * height * 2;
        for (let a = 0; a < arms; a++) {
          const angle = t * twist + (a / arms) * Math.PI * 2;
          blob(voxels, middle + Math.cos(angle) * arm, y, middle + Math.sin(angle) * arm, 2, 1);
        }
      }
      blob(voxels, middle, middle, middle, reach * 0.22, 1);
      break;
    }
    case 21: {
      // A ball with one great bite taken out of it.
      blob(voxels, middle, middle, middle, reach * 0.95, 1);
      const dx = spread(rng);
      const dy = spread(rng);
      const dz = spread(rng);
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const out = reach * (0.85 + unit(rng) * 0.3);
      blob(
        voxels,
        middle + (dx / length) * out,
        middle + (dy / length) * out,
        middle + (dz / length) * out,
        reach * (0.6 + unit(rng) * 0.3),
        0,
      );
      break;
    }
    case 22: {
      // Stacked discs of different sizes: a spinning top, or a cake.
      const layers = 3 + rng.below(4);
      const step = (reach * 1.8) / layers;
      for (let layer = 0; layer < layers; layer++) {
        const wide = reach * (0.3 + unit(rng) * 0.6);
        slab(
          voxels,
          middle,
          middle - reach * 0.9 + step * (layer + 0.5),
          middle,
          wide,
          step * 0.55,
          wide,
          1,
        );
      }
      break;
    }
    default: {
      // A frame: the edges of a box with the faces missing.
      const half = reach * (0.7 + unit(rng) * 0.25);
      const bar = 1.4 + unit(rng) * 1.4;
      for (const a of [-1, 1]) {
        for (const b of [-1, 1]) {
          slab(voxels, middle, middle + a * half, middle + b * half, half, bar, bar, 1);
          slab(voxels, middle + a * half, middle, middle + b * half, bar, half, bar, 1);
          slab(voxels, middle + a * half, middle + b * half, middle, bar, bar, half, 1);
        }
      }
      break;
    }
  }

  // First how it is put together, which decides how even it turns out.
  let built: Uint8Array = voxels;
  switch (rng.below(RANDOM_BUILDS)) {
    case 1:
      built = mirrored(voxels, rng.below(3));
      break;
    case 2:
      built = twinned(voxels, rng.below(3));
      break;
    default:
      break;
  }
  voxels.set(built);

  // Then how it is finished off, which changes the kind of ball it is
  // rather than merely nudging the one that was built.
  let shaped: Uint8Array = voxels;
  switch (rng.below(RANDOM_FINISHES)) {
    case 1: {
      // Pulled out one way, or squashed flat the same way.
      const axis = rng.below(3);
      const pull = unit(rng) < 0.5 ? 1.45 + unit(rng) * 0.5 : 0.55 + unit(rng) * 0.2;
      shaped = stretched(voxels, axis, pull);
      break;
    }
    case 2:
      shaped = hollowed(voxels, rng);
      break;
    case 3:
      shaped = studded(voxels, rng);
      break;
    case 4:
      shaped = rounded(voxels, rng);
      break;
    default:
      break;
  }
  voxels.set(shaped);

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
  /**
   * How far the weight sits off the middle, from 0 to ONE.
   *
   * A ball with all its weight evenly spread turns about its own middle and
   * holds whatever line it is put on. Put the weight to one side and the
   * heavy part swings round as it rolls, throwing the ball off that line a
   * little more with every turn. This is what stops an odd shape going
   * where it is pointed.
   *
   * Measured as the distance from the middle of the block to the middle of
   * the weight, as a share of how far the ball reaches.
   */
  lopsided: number;
  /**
   * How differently the ball turns depending on which way it is turning,
   * from 0 to ONE.
   *
   * Weight gathered along one line is easy to turn about that line and hard
   * to turn about the others: a rolling pin is the extreme case. A ball like
   * that does not turn at a steady rate as it goes — it comes round easily
   * for part of every turn and fights the rest of it.
   *
   * Measured by comparing how hard it is to turn about each of the three
   * ways through the middle: a shape that answers the same in all three
   * scores nothing, one that answers very differently scores near ONE.
   */
  spinSpread: number;
}

/**
 * Where a weight has been placed inside the ball, if one has.
 *
 * Both numbers run from -1 to 1 across the ball: sideways and up. The
 * middle, 0 and 0, is a ball with nothing added, which behaves exactly as
 * its own shape says it should.
 */
export interface WeightAt {
  sideways: number;
  up: number;
}

/** A ball with no weight put in it. */
export const WEIGHT_MIDDLE: WeightAt = { sideways: 0, up: 0 };

/**
 * How far off the middle a weight pulls the balance point, at full tilt.
 *
 * A share of the ball's own reach, chosen so that the whole of the control
 * does something: at the very edge the ball is as unruly as the rules allow,
 * and halfway out it is halfway there. Any further and most of the control
 * would be wasted on a ball that is already as bad as it can get.
 */
const WEIGHT_REACH = 0.22;

/** Reads a placed weight, ignoring anything that is not a real position. */
export function readWeightAt(value: unknown): WeightAt {
  const held = value as Partial<WeightAt> | undefined;
  const one = (n: unknown): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : 0;
  return { sideways: one(held?.sideways), up: one(held?.up) };
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
export function measureShape(
  voxels: Uint8Array,
  weightAt: WeightAt = WEIGHT_MIDDLE,
): ShapeStats {
  let cubes = 0;
  // Where all the weight adds up to, in half-cube steps.
  let leanX = 0;
  let leanY = 0;
  let leanZ = 0;
  // How hard the shape is to turn about each of the three ways through it.
  let turnAboutX = 0;
  let turnAboutY = 0;
  let turnAboutZ = 0;
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

        // And the same split three ways, for how hard it is to turn about
        // each line through the middle.
        turnAboutX += midY * midY + midZ * midZ;
        turnAboutY += midX * midX + midZ * midZ;
        turnAboutZ += midX * midX + midY * midY;

        // And where the weight sits overall, for how lopsided it is.
        leanX += midX;
        leanY += midY;
        leanZ += midZ;

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
      lopsided: 0,
      spinSpread: 0,
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
  // How far the middle of the weight sits from the middle of the block,
  // as a share of the ball's own reach. Everything stays in half-cube steps
  // until the last division, so no fractions creep in.
  const halfCubes = Math.max(1, cubes);
  const offX = leanX / halfCubes;
  const offY = leanY / halfCubes;
  const offZ = leanZ / halfCubes;
  // A weight put in by hand moves the balance point the same way a lump of
  // cubes on one side would, and is felt in exactly the same way.
  const bodyOff = Math.max(1, outermost);
  const placedX = weightAt.sideways * WEIGHT_REACH * bodyOff;
  const placedY = weightAt.up * WEIGHT_REACH * bodyOff;
  const withX = offX + placedX;
  const withY = offY + placedY;
  const offBy = Math.sqrt(withX * withX + withY * withY + offZ * offZ);
  const lopsided = Math.min(ONE, Math.round((offBy / bodyOff) * ONE));

  // How lopsided the turning is: the gap between the easiest way round and
  // the hardest, as a share of the hardest.
  const hardest = Math.max(turnAboutX, turnAboutY, turnAboutZ);
  const easiest = Math.min(turnAboutX, turnAboutY, turnAboutZ);
  const spinSpread =
    hardest > 0 ? Math.min(ONE, Math.round(((hardest - easiest) / hardest) * ONE)) : 0;

  return {
    cubes,
    radius: Math.max(floor, radius),
    reach: Math.max(floor, reach),
    weight,
    smoothness,
    proudShare,
    spinResistance,
    lopsided,
    spinSpread,
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
