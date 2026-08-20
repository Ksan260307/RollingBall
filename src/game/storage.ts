/**
 * Everything that survives closing the tab: best times, the ball the player
 * built, and their settings.
 *
 * Browsers can refuse storage entirely (private windows, tight settings), so
 * every call here is written to fail quietly and carry on with defaults
 * rather than break the game.
 */

import {
  MIXED_LIMIT,
  SHAPE_CELLS,
  WEIGHT_MIDDLE,
  type WeightAt,
  readWeightAt,
  defaultShape,
  isColour,
  shapeFromText,
  shapeTextCells,
  shapeToText,
  upscaleShape,
} from '../core/ballShape';

/** How many cube slots a design saved before the cubes were made finer had. */
const OLD_SHAPE_SIZE = 9;
const OLD_SHAPE_CELLS = OLD_SHAPE_SIZE * OLD_SHAPE_SIZE * OLD_SHAPE_SIZE;

const RECORDS_KEY = 'rollingball.records.v1';
const BALL_KEY = 'rollingball.ball.v1';
const SETTINGS_KEY = 'rollingball.settings.v1';
const GHOST_KEY = 'rollingball.best-runs.v1';
const SHELF_KEY = 'rollingball.recipes.v1';

/** How many balls can be kept on the shelf at once. */
export const SHELF_LIMIT = 24;

/** One ball put away under a name. */
export interface KeptBall {
  name: string;
  recipe: string;
}

/** The balls that have been put away, newest first. */
export function loadShelf(): KeptBall[] {
  const raw = readStore(SHELF_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (one): one is KeptBall =>
          typeof one === 'object' &&
          one !== null &&
          typeof (one as KeptBall).name === 'string' &&
          typeof (one as KeptBall).recipe === 'string',
      )
      .slice(0, SHELF_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Puts a ball away under a name.
 *
 * A name already on the shelf is written over rather than doubled up, which
 * is what somebody means when they save the same ball twice.
 */
export function keepBall(name: string, recipe: string): KeptBall[] {
  const tidy = name.trim().slice(0, 24) || 'ボール';
  const shelf = loadShelf().filter((one) => one.name !== tidy);
  shelf.unshift({ name: tidy, recipe });
  const kept = shelf.slice(0, SHELF_LIMIT);
  writeStore(SHELF_KEY, JSON.stringify(kept));
  return kept;
}

/** Takes a ball off the shelf. */
export function dropBall(name: string): KeptBall[] {
  const kept = loadShelf().filter((one) => one.name !== name);
  writeStore(SHELF_KEY, JSON.stringify(kept));
  return kept;
}

/**
 * A best run is kept so it can be raced against.
 *
 * What is stored is the list of things the player did, one entry per step,
 * which is a few kilobytes rather than anything like a recording.
 */
export function saveGhost(stageId: string, controls: readonly number[]): void {
  const all = loadGhostStore();
  all[stageId] = Array.from(controls);
  writeStore(GHOST_KEY, JSON.stringify(all));
}

/** The best run for a course, or null if there is not one worth using. */
export function loadGhost(stageId: string): number[] | null {
  const one = loadGhostStore()[stageId];
  return Array.isArray(one) && one.length > 60 ? one : null;
}

/** Throws away every stored run, alongside the times. */
export function clearGhosts(): void {
  writeStore(GHOST_KEY, JSON.stringify({}));
}

function loadGhostStore(): Record<string, number[]> {
  const raw = readStore(GHOST_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number[]> = {};
    for (const [id, value] of Object.entries(parsed)) {
      // Anything that is not a list of whole numbers is dropped rather than
      // fed to the rules, where it would make a nonsense of the ghost.
      if (Array.isArray(value) && value.every(Number.isInteger)) out[id] = value as number[];
    }
    return out;
  } catch {
    return {};
  }
}

function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage is unavailable or full. The game still plays; nothing is kept.
  }
}

/** Best time for each course, in seconds. */
export type Records = Record<string, number>;

export function loadRecords(): Records {
  const raw = readStore(RECORDS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Records;
    const clean: Records = {};
    for (const [id, seconds] of Object.entries(parsed)) {
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
        clean[id] = seconds;
      }
    }
    return clean;
  } catch {
    return {};
  }
}

/**
 * Stores a time if it beats what was there before.
 * @returns true when it was a new best
 */
export function saveRecord(stageId: string, seconds: number): boolean {
  const records = loadRecords();
  const previous = records[stageId];
  if (previous !== undefined && previous <= seconds) return false;
  records[stageId] = seconds;
  writeStore(RECORDS_KEY, JSON.stringify(records));
  return true;
}

export function clearRecords(): void {
  writeStore(RECORDS_KEY, JSON.stringify({}));
}

/** The ball the player built. */
export interface BallDesign {
  /** One entry per cube slot: 0 for empty, otherwise a colour number. */
  voxels: Uint8Array;
  /** A photo stuck to the ball, as a data address, or null. */
  photo: string | null;
  /** How strongly the photo shows through the paint, 0 to 1. */
  photoStrength: number;
  /** How shiny the surface is, 0 to 1. */
  shine: number;
  /** Colours mixed by hand for this ball, as `#rrggbb`. */
  mixed: string[];
  /** Where a weight has been put inside the ball. */
  weightAt: WeightAt;
}

export function defaultBall(): BallDesign {
  return {
    voxels: defaultShape(),
    photo: null,
    photoStrength: 0.85,
    shine: 0.35,
    mixed: [],
    weightAt: { ...WEIGHT_MIDDLE },
  };
}

export function loadBall(): BallDesign {
  const raw = readStore(BALL_KEY);
  if (!raw) return defaultBall();
  try {
    const parsed = JSON.parse(raw) as {
      shape?: string;
      photo?: string | null;
      photoStrength?: number;
      shine?: number;
      mixed?: unknown;
      weightAt?: unknown;
    };
    const voxels = parsed.shape ? readShape(parsed.shape) : defaultShape();
    if (voxels.length !== SHAPE_CELLS) return defaultBall();
    let used = 0;
    for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) used++;
    if (used === 0) return defaultBall();
    return {
      voxels,
      photo: typeof parsed.photo === 'string' ? parsed.photo : null,
      photoStrength: clampUnit(parsed.photoStrength, 0.85),
      shine: clampUnit(parsed.shine, 0.35),
      // Anything that is not a colour is dropped rather than drawn.
      mixed: Array.isArray(parsed.mixed)
        ? parsed.mixed.filter(isColour).slice(0, MIXED_LIMIT)
        : [],
      weightAt: readWeightAt(parsed.weightAt),
    };
  } catch {
    return defaultBall();
  }
}

export function saveBall(design: BallDesign): void {
  writeStore(
    BALL_KEY,
    JSON.stringify({
      shape: shapeToText(design.voxels),
      photo: design.photo,
      photoStrength: design.photoStrength,
      shine: design.shine,
      mixed: design.mixed,
      weightAt: design.weightAt,
    }),
  );
}

/**
 * Reads a saved design, bringing one built with the old, coarser cubes up to
 * the finer ones so that nobody loses the ball they made.
 */
function readShape(text: string): Uint8Array {
  if (shapeTextCells(text) === OLD_SHAPE_CELLS) {
    return upscaleShape(shapeFromText(text, OLD_SHAPE_CELLS), OLD_SHAPE_SIZE);
  }
  return shapeFromText(text);
}

function clampUnit(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** Player settings that are not part of the rules. */
export interface Settings {
  /** How far the camera sits back, 0.5 to 2.0. */
  zoom: number;
  /** Turns the extra sparkle down on slower devices. */
  richGraphics: boolean;
  /** Turns sound on or off. */
  sound: boolean;
  /** Swaps which way dragging up and down works. */
  invertPush: boolean;
  /** Shows your best run alongside you as you go. Off unless asked for. */
  ghost: boolean;
}

export function defaultSettings(): Settings {
  return { zoom: 1, richGraphics: true, sound: true, invertPush: false, ghost: false };
}

export function loadSettings(): Settings {
  const raw = readStore(SETTINGS_KEY);
  if (!raw) return defaultSettings();
  try {
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const fallback = defaultSettings();
    return {
      zoom:
        typeof parsed.zoom === 'number' && Number.isFinite(parsed.zoom)
          ? Math.min(2, Math.max(0.5, parsed.zoom))
          : fallback.zoom,
      richGraphics: parsed.richGraphics ?? fallback.richGraphics,
      sound: parsed.sound ?? fallback.sound,
      invertPush: parsed.invertPush ?? fallback.invertPush,
      ghost: parsed.ghost ?? fallback.ghost,
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  writeStore(SETTINGS_KEY, JSON.stringify(settings));
}
