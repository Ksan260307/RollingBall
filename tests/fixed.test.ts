import { describe, expect, it } from 'vitest';
import {
  FULL_TURN,
  ONE,
  blend,
  clamp,
  cosine,
  degrees,
  div,
  highestBit,
  length2,
  length3,
  mul,
  sine,
  sqrt,
  toNumber,
  fromNumber,
} from '../src/core/fixed';

describe('whole-number arithmetic', () => {
  it('converts back and forth without drifting', () => {
    for (const value of [0, 1, 0.5, -2.25, 9.80665, 123.456]) {
      expect(toNumber(fromNumber(value))).toBeCloseTo(value, 4);
    }
  });

  it('multiplies and divides', () => {
    expect(toNumber(mul(fromNumber(3), fromNumber(4)))).toBeCloseTo(12, 3);
    expect(toNumber(div(fromNumber(12), fromNumber(4)))).toBeCloseTo(3, 3);
    expect(toNumber(mul(fromNumber(-2.5), fromNumber(4)))).toBeCloseTo(-10, 3);
  });

  it('treats dividing by nothing as nothing, rather than as a broken number', () => {
    expect(div(ONE, 0)).toBe(0);
    expect(Number.isNaN(div(ONE, 0))).toBe(false);
  });

  it('keeps values inside a range', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('blends between two values', () => {
    expect(toNumber(blend(0, fromNumber(10), ONE / 2))).toBeCloseTo(5, 2);
    expect(blend(fromNumber(3), fromNumber(9), 0)).toBe(fromNumber(3));
  });

  it('finds the top bit without asking the maths library', () => {
    expect(highestBit(1)).toBe(0);
    expect(highestBit(2)).toBe(1);
    expect(highestBit(255)).toBe(7);
    expect(highestBit(256)).toBe(8);
  });
});

describe('square roots and lengths', () => {
  it('agrees with the usual square root', () => {
    for (const value of [0.25, 1, 2, 9, 16.5, 100, 1000]) {
      expect(toNumber(sqrt(fromNumber(value)))).toBeCloseTo(Math.sqrt(value), 2);
    }
  });

  it('treats a negative input as nothing', () => {
    expect(sqrt(-fromNumber(4))).toBe(0);
  });

  it('measures a three-four-five triangle', () => {
    expect(toNumber(length2(fromNumber(3), fromNumber(4)))).toBeCloseTo(5, 2);
  });

  it('measures long distances that would otherwise overflow', () => {
    const far = fromNumber(900);
    expect(toNumber(length3(far, 0, 0))).toBeCloseTo(900, 0);
    expect(toNumber(length3(far, far, far))).toBeCloseTo(900 * Math.sqrt(3), 0);
  });
});

describe('angles', () => {
  it('matches the usual sine closely enough for physics', () => {
    let worst = 0;
    for (let angle = 0; angle < FULL_TURN; angle += 37) {
      const expected = Math.sin((angle / FULL_TURN) * Math.PI * 2);
      const actual = toNumber(sine(angle));
      worst = Math.max(worst, Math.abs(expected - actual));
    }
    expect(worst).toBeLessThan(0.002);
  });

  it('matches the usual cosine', () => {
    for (let angle = 0; angle < FULL_TURN; angle += 211) {
      const expected = Math.cos((angle / FULL_TURN) * Math.PI * 2);
      expect(toNumber(cosine(angle))).toBeCloseTo(expected, 2);
    }
  });

  it('wraps round the way repeating motion needs', () => {
    expect(sine(0)).toBe(sine(FULL_TURN));
    expect(sine(1000)).toBe(sine(1000 + FULL_TURN * 3));
    expect(sine(-1000 & 0xffff)).toBe(sine(FULL_TURN - 1000));
  });

  it('hits the landmarks', () => {
    expect(toNumber(sine(0))).toBeCloseTo(0, 3);
    expect(toNumber(sine(FULL_TURN / 4))).toBeCloseTo(1, 3);
    expect(toNumber(sine(FULL_TURN / 2))).toBeCloseTo(0, 3);
    expect(toNumber(sine((FULL_TURN * 3) / 4))).toBeCloseTo(-1, 3);
  });

  it('turns degrees into its own angle unit', () => {
    expect(degrees(0)).toBe(0);
    expect(degrees(90)).toBe(FULL_TURN / 4);
    expect(degrees(360)).toBe(0);
    expect(toNumber(sine(degrees(30)))).toBeCloseTo(0.5, 2);
  });

  it('keeps sine and cosine squared adding up to one', () => {
    for (let angle = 0; angle < FULL_TURN; angle += 997) {
      const s = toNumber(sine(angle));
      const c = toNumber(cosine(angle));
      expect(s * s + c * c).toBeCloseTo(1, 2);
    }
  });
});

describe('repeatability', () => {
  it('gives the same answers every time it is asked', () => {
    const first: number[] = [];
    const second: number[] = [];
    for (let i = 0; i < 500; i++) {
      first.push(sine(i * 131), mul(i * 7919, ONE / 3), sqrt(fromNumber(i + 1)));
    }
    for (let i = 0; i < 500; i++) {
      second.push(sine(i * 131), mul(i * 7919, ONE / 3), sqrt(fromNumber(i + 1)));
    }
    expect(second).toEqual(first);
  });

  it('produces only whole numbers, never fractions', () => {
    const values = [
      mul(fromNumber(1.37), fromNumber(2.91)),
      div(fromNumber(7), fromNumber(3)),
      sqrt(fromNumber(2)),
      length3(fromNumber(1.1), fromNumber(2.2), fromNumber(3.3)),
      sine(12345),
    ];
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
