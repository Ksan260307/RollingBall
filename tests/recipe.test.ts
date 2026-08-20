/**
 * Writing a ball down, keeping it, and handing it to somebody.
 *
 * The share picture is checked by actually reading it back with a decoder
 * that knows nothing about how it was drawn. Anything less would only show
 * that a square of black and white had been produced, which is not the same
 * as one a camera can use.
 */

import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';
import {
  cubeShape,
  defaultShape,
  measureShape,
  pebbleShape,
  randomShape,
} from '../src/core/ballShape';
import { readRecipe, recipeFromLink, recipeLink, writeRecipe } from '../src/game/recipe';
import type { BallDesign } from '../src/game/storage';

function ballOf(voxels: Uint8Array, extra: Partial<BallDesign> = {}): BallDesign {
  return {
    voxels,
    photo: null,
    photoStrength: 0.85,
    shine: 0.4,
    mixed: [],
    weightAt: { sideways: 0, up: 0 },
    ...extra,
  };
}

/**
 * Draws a recipe the way the game draws it, then reads it back.
 *
 * The picture is built at three pixels a cell with a white border, which is
 * what ends up on the screen, and handed to a decoder as raw pixels.
 */
function throughTheCamera(text: string): string | null {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const across = code.getModuleCount();
  const cell = 3;
  const edge = cell * 2;
  const size = across * cell + edge * 2;

  // White page, black cells, exactly as on screen.
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let row = 0; row < across; row++) {
    for (let column = 0; column < across; column++) {
      if (!code.isDark(row, column)) continue;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const at = ((edge + row * cell + y) * size + (edge + column * cell + x)) * 4;
          pixels[at] = 0;
          pixels[at + 1] = 0;
          pixels[at + 2] = 0;
        }
      }
    }
  }
  return jsQR(pixels, size, size)?.data ?? null;
}

describe('writing a ball down', () => {
  it('gives back the same ball it was given', async () => {
    for (const voxels of [defaultShape(), cubeShape(), pebbleShape(), randomShape(42)]) {
      const design = ballOf(voxels, {
        shine: 0.65,
        mixed: ['#28dcff', '#ff7700'],
        weightAt: { sideways: 0.5, up: -0.25 },
      });
      const back = await readRecipe(await writeRecipe(design));
      expect(back).not.toBeNull();
      expect(Array.from(back!.voxels)).toEqual(Array.from(voxels));
      expect(back!.mixed).toEqual(['#28dcff', '#ff7700']);
      expect(back!.shine).toBeCloseTo(0.65, 2);
      expect(back!.weightAt).toEqual({ sideways: 0.5, up: -0.25 });
    }
  });

  it('gives a ball that rolls exactly as the one it came from', async () => {
    // The point of a recipe is that the ball behaves the same, not merely
    // that it looks the same.
    const design = ballOf(randomShape(7), { weightAt: { sideways: -0.4, up: 0.2 } });
    const back = await readRecipe(await writeRecipe(design));
    const was = measureShape(design.voxels, design.weightAt);
    const now = measureShape(back!.voxels, back!.weightAt);
    expect(now).toEqual(was);
  });

  it('stays short enough to be worth making a picture of', async () => {
    for (const voxels of [defaultShape(), cubeShape(), randomShape(3), randomShape(42)]) {
      const text = await writeRecipe(ballOf(voxels));
      expect(text.length).toBeLessThan(700);
    }
  });

  it('turns down anything that is not a recipe', async () => {
    expect(await readRecipe('')).toBeNull();
    expect(await readRecipe('   ')).toBeNull();
    expect(await readRecipe('hello')).toBeNull();
    expect(await readRecipe('B2~~~~')).toBeNull();
    expect(await readRecipe('B9~abc~~0.4~0|0')).toBeNull();
    // Right shape, wrong contents: the squashed part is not squashed data.
    expect(await readRecipe('B2~AAAAAAAA~~0.4~0|0')).toBeNull();
    expect(await readRecipe(`B2~${'A'.repeat(9000)}~~0.4~0|0`)).toBeNull();
  });

  it('refuses a ball with nothing in it', async () => {
    const empty = ballOf(new Uint8Array(defaultShape().length));
    expect(await readRecipe(await writeRecipe(empty))).toBeNull();
  });
});

describe('handing a ball over by web address', () => {
  it('carries the recipe and drops whatever was in the address before', async () => {
    const design = ballOf(randomShape(11));
    const link = await recipeLink(design, 'https://example.test/game/?something=else#here');
    expect(link.startsWith('https://example.test/game/?ball=')).toBe(true);
    const held = recipeFromLink(link.slice(link.indexOf('?')));
    expect(held).not.toBeNull();
    const back = await readRecipe(decodeURIComponent(held!));
    expect(Array.from(back!.voxels)).toEqual(Array.from(design.voxels));
  });

  it('finds nothing in an address that carries nothing', () => {
    expect(recipeFromLink('')).toBeNull();
    expect(recipeFromLink('?other=1')).toBeNull();
    expect(recipeFromLink('?ball=')).toBeNull();
  });
});

describe('the picture somebody points a camera at', () => {
  it('reads back as exactly the address it was made from', async () => {
    // Read by a decoder that knows nothing about how it was drawn.
    for (const voxels of [defaultShape(), cubeShape(), randomShape(42)]) {
      const link = await recipeLink(ballOf(voxels), 'https://example.test/g/');
      const seen = throughTheCamera(link);
      expect(seen).toBe(link);
    }
  });

  it('survives the whole way round: ball, picture, camera, ball', async () => {
    const design = ballOf(randomShape(23), {
      shine: 0.2,
      mixed: ['#abcdef'],
      weightAt: { sideways: 0.75, up: 0.5 },
    });
    const link = await recipeLink(design, 'https://example.test/g/');
    const seen = throughTheCamera(link);
    expect(seen).not.toBeNull();

    const held = recipeFromLink(seen!.slice(seen!.indexOf('?')));
    const back = await readRecipe(decodeURIComponent(held!));
    expect(Array.from(back!.voxels)).toEqual(Array.from(design.voxels));
    expect(back!.mixed).toEqual(['#abcdef']);
    expect(back!.weightAt).toEqual({ sideways: 0.75, up: 0.5 });
  });
});
