/**
 * Whole-number math helpers.
 *
 * Every value used by the simulation is stored as a whole number so that the
 * result of a calculation is bit-for-bit identical on every device: phones,
 * tablets and desktops all produce the same numbers, which is what makes
 * replays (and, later, playing together) reliable.
 *
 * A value of `ONE` (65536) means 1.0, so 32768 means 0.5 and -131072 means -2.0.
 * Only +, -, * and / on whole numbers are used, and those are exactly defined
 * by the JavaScript number spec. Library functions such as Math.sin are *not*
 * exactly defined, so this file builds its own tables instead.
 */

/** Number of fraction digits (in bits) kept for every value. */
export const FRACTION_BITS = 16;

/** The stored value that represents 1.0. */
export const ONE = 1 << FRACTION_BITS; // 65536

/** The stored value that represents 0.5. */
export const HALF = ONE >> 1;

/** A full turn, expressed in the angle unit used everywhere (0 .. 65535). */
export const FULL_TURN = 65536;

/**
 * Largest magnitude a value may reach before multiplication starts losing
 * digits. Products stay below 2^53 as long as both sides respect this.
 */
export const SAFE_LIMIT = 1 << 24; // 256.0 in real units

/** Converts a human readable decimal into the stored whole-number form. */
export function fromNumber(value: number): number {
  return Math.round(value * ONE);
}

/** Converts a stored whole number back into a decimal, for display only. */
export function toNumber(value: number): number {
  return value / ONE;
}

/** Multiplies two stored values. */
export function mul(a: number, b: number): number {
  return Math.floor((a * b) / ONE);
}

/** Divides two stored values. Dividing by zero yields zero instead of NaN. */
export function div(a: number, b: number): number {
  if (b === 0) return 0;
  return Math.floor((a * ONE) / b);
}

/** Keeps a value inside the given range. */
export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Absolute value. */
export function abs(value: number): number {
  return value < 0 ? -value : value;
}

/** Blends from `a` to `b`, where `amount` is a stored value in 0 .. ONE. */
export function blend(a: number, b: number, amount: number): number {
  return a + mul(b - a, amount);
}

/** Sign of a value: -1, 0 or 1. */
export function sign(value: number): number {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

/**
 * Highest bit position of a positive whole number (floor of log2).
 * Written as a loop instead of Math.log2 so that the answer cannot differ
 * between browsers.
 */
export function highestBit(value: number): number {
  let bit = 0;
  let v = Math.floor(value);
  while (v >= 2) {
    v = Math.floor(v / 2);
    bit++;
  }
  return bit;
}

/**
 * Square root of a stored value, using whole-number steps only.
 * Returns 0 for negative input.
 */
export function sqrt(value: number): number {
  if (value <= 0) return 0;
  // Work on the raw whole number: sqrt(v / ONE) * ONE === sqrt(v * ONE)
  const target = value * ONE;
  // Start above the answer, then walk down with halving steps.
  let guess = Math.pow(2, Math.ceil((highestBit(target) + 1) / 2));
  for (let i = 0; i < 40; i++) {
    const next = Math.floor((guess + Math.floor(target / guess)) / 2);
    if (next >= guess) break;
    guess = next;
  }
  // The halving step can stop one above the answer; nudge it back down.
  while (guess > 1 && guess * guess > target) guess--;
  return guess;
}

/** How far a value must be scaled down to stay inside the safe range. */
function shiftFor(largest: number): number {
  let shift = 0;
  let v = largest;
  while (v > SAFE_LIMIT) {
    v = Math.floor(v / 2);
    shift++;
  }
  return shift;
}

/** Length of a 2D vector made of stored values. */
export function length2(x: number, y: number): number {
  const big = Math.max(abs(x), abs(y));
  if (big === 0) return 0;
  const shift = shiftFor(big);
  const step = Math.pow(2, shift);
  const sx = shift ? Math.floor(x / step) : x;
  const sy = shift ? Math.floor(y / step) : y;
  return sqrt(mul(sx, sx) + mul(sy, sy)) * step;
}

/** Length of a 3D vector made of stored values. */
export function length3(x: number, y: number, z: number): number {
  const big = Math.max(abs(x), abs(y), abs(z));
  if (big === 0) return 0;
  const shift = shiftFor(big);
  const step = Math.pow(2, shift);
  const sx = shift ? Math.floor(x / step) : x;
  const sy = shift ? Math.floor(y / step) : y;
  const sz = shift ? Math.floor(z / step) : z;
  return sqrt(mul(sx, sx) + mul(sy, sy) + mul(sz, sz)) * step;
}

/* ------------------------------------------------------------------ *
 * Angle tables
 *
 * The table is filled with a plain power series (only +, -, * and /) so
 * that every device builds exactly the same table. Using Math.sin here
 * would be a mistake: its last digit is allowed to differ per browser.
 * ------------------------------------------------------------------ */

/** How many samples cover one full turn. */
export const TABLE_SIZE = 4096;

const TWO_PI = 6.283185307179586;

/** Power series for sine; accurate to well below one stored step near 0. */
function seriesSine(x: number): number {
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n <= 9; n++) {
    const d = (2 * n) * (2 * n + 1);
    term = (-term * x2) / d;
    sum += term;
  }
  return sum;
}

/** Power series for cosine, used where the sine series is least accurate. */
function seriesCosine(x: number): number {
  const x2 = x * x;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 9; n++) {
    const d = (2 * n - 1) * (2 * n);
    term = (-term * x2) / d;
    sum += term;
  }
  return sum;
}

function buildSineTable(): Int32Array {
  const table = new Int32Array(TABLE_SIZE);
  const quarter = TABLE_SIZE / 4;
  const eighth = TABLE_SIZE / 8;
  for (let i = 0; i <= quarter; i++) {
    const angle = (TWO_PI * i) / TABLE_SIZE;
    // Below 45 degrees the sine series converges fastest, above it the
    // cosine series does, so each half of the quadrant uses the better one.
    const value = i <= eighth ? seriesSine(angle) : seriesCosine(TWO_PI / 4 - angle);
    const stored = Math.round(value * ONE);
    if (i < TABLE_SIZE) table[i] = stored;
    // Mirror into the remaining three quadrants.
    const mirrored = quarter * 2 - i;
    if (mirrored < TABLE_SIZE) table[mirrored] = stored;
    if (quarter * 2 + i < TABLE_SIZE) table[quarter * 2 + i] = -stored;
    const last = TABLE_SIZE - i;
    if (last < TABLE_SIZE) table[last] = -stored;
  }
  table[0] = 0;
  return table;
}

const SINE_TABLE = buildSineTable();

/** Exposed for tests; the table itself must never be modified. */
export function sineTable(): Int32Array {
  return SINE_TABLE;
}

/**
 * Sine of an angle. The angle unit is a full turn split into 65536 steps,
 * and it simply wraps around, which is what keeps repeating motion exact.
 */
export function sine(angle: number): number {
  const wrapped = angle & 0xffff;
  const scaled = wrapped * TABLE_SIZE; // 0 .. 65536*TABLE_SIZE
  const index = Math.floor(scaled / FULL_TURN);
  const nextIndex = (index + 1) % TABLE_SIZE;
  const remainder = scaled - index * FULL_TURN; // 0 .. FULL_TURN-1
  const a = SINE_TABLE[index % TABLE_SIZE];
  const b = SINE_TABLE[nextIndex];
  return a + Math.floor(((b - a) * remainder) / FULL_TURN);
}

/** Cosine of an angle, in the same unit as {@link sine}. */
export function cosine(angle: number): number {
  return sine(angle + FULL_TURN / 4);
}

/** Turns degrees into the angle unit used by {@link sine}. */
export function degrees(value: number): number {
  return Math.round((value * FULL_TURN) / 360) & 0xffff;
}
