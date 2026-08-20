/**
 * Writing a ball down, so it can be kept or handed to somebody.
 *
 * A recipe is the whole ball as one line of text: the cubes, the colours
 * mixed for it, how shiny it is and where its weight sits.
 *
 * Written plainly it runs to a couple of thousand characters, which is far
 * more than a picture on a screen can carry. Squashed first it comes to
 * three or four hundred, which fits with room to spare — so the cubes are
 * squashed and the few loose numbers are left as they are.
 *
 * The photo stuck to a ball is deliberately left out. A photo is hundreds of
 * kilobytes and could never fit; a recipe that quietly dropped it would be
 * worse than one that never promised it.
 */

import {
  MIXED_LIMIT,
  SHAPE_CELLS,
  isColour,
  readWeightAt,
} from '../core/ballShape';
import { fromText, squashed, toText, unsquashed } from './pack';
import type { BallDesign } from './storage';

/** What this format is called, so a later one can be told apart from it. */
const MARK = 'B2';

/** The same, for a recipe made where the squashing was not available. */
const PLAIN_MARK = 'B2P';

/** How long a recipe may be before it is refused, in characters. */
const MOST_CHARACTERS = 8000;

/** What a recipe holds. A photo is not part of it; see the note above. */
export type Recipe = Omit<BallDesign, 'photo' | 'photoStrength'>;

/** Turns a ball into one line of text. */
export async function writeRecipe(design: BallDesign): Promise<string> {
  const packed = await squashed(design.voxels);
  const cubes = packed ? toText(packed) : toText(design.voxels);
  const mark = packed ? MARK : PLAIN_MARK;
  const weight = `${round(design.weightAt.sideways)}|${round(design.weightAt.up)}`;
  const mixed = design.mixed.map((hex) => hex.slice(1)).join('.');
  return [mark, cubes, mixed, round(design.shine), weight].join('~');
}

/**
 * Reads a recipe back, or gives nothing if it is not one.
 *
 * Everything here arrives from outside — a scanned picture, a pasted line, a
 * web address somebody edited — so nothing in it is believed without being
 * checked first.
 */
export async function readRecipe(text: string): Promise<Recipe | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MOST_CHARACTERS) return null;

  const parts = trimmed.split('~');
  if (parts.length < 5) return null;
  if (parts[0] !== MARK && parts[0] !== PLAIN_MARK) return null;

  const held = fromText(parts[1]);
  if (!held) return null;
  const voxels = parts[0] === MARK ? await unsquashed(held) : held;
  if (!voxels || voxels.length !== SHAPE_CELLS) return null;

  let used = 0;
  for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) used++;
  if (used === 0) return null;

  const mixed = parts[2]
    .split('.')
    .filter((piece) => piece.length > 0)
    .map((piece) => `#${piece}`)
    .filter(isColour)
    .slice(0, MIXED_LIMIT);

  const shine = Number(parts[3]);
  const [sideways, up] = parts[4].split('|').map(Number);

  return {
    voxels,
    mixed,
    shine: Number.isFinite(shine) ? Math.min(1, Math.max(0, shine)) : 0.35,
    weightAt: readWeightAt({ sideways, up }),
  };
}

/** The web address that opens the game with this ball already in it. */
export async function recipeLink(design: BallDesign, base: string): Promise<string> {
  const at = base.split('#')[0].split('?')[0];
  return `${at}?ball=${encodeURIComponent(await writeRecipe(design))}`;
}

/** The recipe carried by a web address, if it carries one. */
export function recipeFromLink(search: string): string | null {
  try {
    const held = new URLSearchParams(search).get('ball');
    return held && held.length > 0 ? held : null;
  } catch {
    return null;
  }
}

/** Keeps a couple of decimal places and no more, so recipes stay short. */
function round(value: number): string {
  return String(Math.round(value * 100) / 100);
}
