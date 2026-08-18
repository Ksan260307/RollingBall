/**
 * Everything that survives closing the tab: best times, the ball the player
 * built, and their settings.
 *
 * Browsers can refuse storage entirely (private windows, tight settings), so
 * every call here is written to fail quietly and carry on with defaults
 * rather than break the game.
 */

import {
  SHAPE_CELLS,
  defaultShape,
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
}

export function defaultBall(): BallDesign {
  return { voxels: defaultShape(), photo: null, photoStrength: 0.85, shine: 0.35 };
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
}

export function defaultSettings(): Settings {
  return { zoom: 1, richGraphics: true, sound: true, invertPush: false };
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
    };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  writeStore(SETTINGS_KEY, JSON.stringify(settings));
}
