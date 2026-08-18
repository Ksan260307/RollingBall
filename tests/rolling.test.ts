import { describe, expect, it } from 'vitest';
import { ONE, fromNumber, toNumber } from '../src/core/fixed';
import {
  crossInto,
  dot,
  gripShare,
  magnitude,
  rollingSpinInto,
  slipInto,
  spinChangeInto,
  triple,
} from '../src/core/rolling';

const out = triple();

describe('directions', () => {
  it('measures how much two directions agree', () => {
    expect(dot(ONE, 0, 0, ONE, 0, 0)).toBe(ONE);
    expect(dot(ONE, 0, 0, 0, ONE, 0)).toBe(0);
    expect(dot(ONE, 0, 0, -ONE, 0, 0)).toBe(-ONE);
  });

  it('turns two directions into a third square to both', () => {
    crossInto(out, ONE, 0, 0, 0, ONE, 0);
    expect([out.x, out.y, out.z]).toEqual([0, 0, ONE]);
    crossInto(out, 0, ONE, 0, 0, 0, ONE);
    expect([out.x, out.y, out.z]).toEqual([ONE, 0, 0]);
  });

  it('gives nothing when the two directions are the same', () => {
    crossInto(out, ONE, 0, 0, ONE, 0, 0);
    expect(magnitude(out.x, out.y, out.z)).toBe(0);
  });

  it('is safe to write its answer over one of its inputs', () => {
    const shared = triple(ONE, 0, 0);
    crossInto(shared, shared.x, shared.y, shared.z, 0, ONE, 0);
    expect([shared.x, shared.y, shared.z]).toEqual([0, 0, ONE]);
  });
});

describe('how much of a skid the ground can take out at once', () => {
  it('matches the textbook figure for an evenly filled ball', () => {
    // A solid ball resists spinning by two fifths, and the ground can take
    // out two sevenths of a skid in one go, which is why such a ball rolls
    // down a slope at five sevenths of the speed a sliding one would.
    const share = gripShare(fromNumber(0.4));
    expect(toNumber(share)).toBeCloseTo(2 / 7, 3);
    expect(1 - toNumber(share)).toBeCloseTo(5 / 7, 3);
  });

  it('gives up more of a skid when the ball is harder to spin', () => {
    const easy = gripShare(fromNumber(0.3));
    const hard = gripShare(fromNumber(0.7));
    expect(hard).toBeGreaterThan(easy);
  });

  it('copes with a ball that offers no resistance at all', () => {
    expect(gripShare(0)).toBe(ONE);
  });
});

describe('the point where the ball touches the ground', () => {
  const radius = fromNumber(0.5);
  const up = { x: 0, y: ONE, z: 0 };

  it('reports no skid at all when the ball is rolling cleanly', () => {
    const speed = fromNumber(6);
    // Rolling forward along z means turning about x at speed divided by radius.
    const spin = fromNumber(12);
    slipInto(out, 0, 0, speed, spin, 0, 0, up.x, up.y, up.z, radius);
    expect(toNumber(magnitude(out.x, out.y, out.z))).toBeLessThan(0.01);
  });

  it('reports the whole speed as a skid when the ball is not turning', () => {
    const speed = fromNumber(6);
    slipInto(out, 0, 0, speed, 0, 0, 0, up.x, up.y, up.z, radius);
    expect(toNumber(magnitude(out.x, out.y, out.z))).toBeCloseTo(6, 1);
  });

  it('reports a skid when the ball is spinning without going anywhere', () => {
    slipInto(out, 0, 0, 0, fromNumber(12), 0, 0, up.x, up.y, up.z, radius);
    expect(toNumber(magnitude(out.x, out.y, out.z))).toBeCloseTo(6, 1);
  });

  it('ignores movement straight into or out of the ground', () => {
    slipInto(out, 0, fromNumber(-9), 0, 0, 0, 0, up.x, up.y, up.z, radius);
    expect(magnitude(out.x, out.y, out.z)).toBe(0);
  });
});

describe('the turning speed of a ball that is rolling cleanly', () => {
  it('turns about the sideways direction as it travels forward', () => {
    const radius = fromNumber(0.5);
    rollingSpinInto(out, 0, 0, fromNumber(6), 0, ONE, 0, radius);
    // Six metres a second on a half metre ball is twelve turns of a radian.
    expect(toNumber(out.x)).toBeCloseTo(12, 1);
    expect(toNumber(out.y)).toBeCloseTo(0, 3);
    expect(toNumber(out.z)).toBeCloseTo(0, 3);
  });

  it('turns the other way when the ball travels the other way', () => {
    const radius = fromNumber(0.5);
    rollingSpinInto(out, 0, 0, fromNumber(-6), 0, ONE, 0, radius);
    expect(toNumber(out.x)).toBeCloseTo(-12, 1);
  });
});

describe('a shove from the ground', () => {
  it('turns the ball backwards when the ground drags its base forwards', () => {
    const radius = fromNumber(0.5);
    const spinResistance = fromNumber(0.4);
    // The shove lands at the bottom of the ball, so pushing the base forwards
    // rolls the ball backwards, exactly as a ball on a belt that suddenly
    // starts moving would.
    spinChangeInto(out, 0, 0, fromNumber(1), 0, ONE, 0, spinResistance, radius);
    expect(toNumber(out.x)).toBeLessThan(0);
    expect(Math.abs(toNumber(out.y))).toBeLessThan(0.01);
    expect(Math.abs(toNumber(out.z))).toBeLessThan(0.01);
  });

  it('spins the ball up forwards when friction holds a forward skid back', () => {
    const radius = fromNumber(0.5);
    const spinResistance = fromNumber(0.4);
    // This is the everyday case: the ball is sliding forwards, the ground
    // drags backwards on its base, and that is what gets it rolling.
    spinChangeInto(out, 0, 0, fromNumber(-1), 0, ONE, 0, spinResistance, radius);
    expect(toNumber(out.x)).toBeGreaterThan(0);
  });

  it('turns a ball that is easy to spin further than a stubborn one', () => {
    const radius = fromNumber(0.5);
    const easy = spinChangeInto(triple(), 0, 0, ONE, 0, ONE, 0, fromNumber(0.25), radius);
    const stubborn = spinChangeInto(triple(), 0, 0, ONE, 0, ONE, 0, fromNumber(0.8), radius);
    expect(Math.abs(easy.x)).toBeGreaterThan(Math.abs(stubborn.x));
  });

  it('lands exactly on clean rolling from a standing skid', () => {
    // This is the whole point of the arrangement: one shove of the size the
    // ground can manage takes a sliding ball straight to rolling cleanly.
    const radius = fromNumber(0.5);
    const spinResistance = fromNumber(0.4);
    const speed = fromNumber(7);
    const share = gripShare(spinResistance);

    const change = -Math.floor((speed * share) / ONE);
    const velocityZ = speed + change;
    const spin = spinChangeInto(triple(), 0, 0, change, 0, ONE, 0, spinResistance, radius);

    // Rolling cleanly means the turning speed is the travel divided by radius.
    const wanted = rollingSpinInto(triple(), 0, 0, velocityZ, 0, ONE, 0, radius);
    expect(toNumber(spin.x)).toBeCloseTo(toNumber(wanted.x), 1);

    slipInto(out, 0, 0, velocityZ, spin.x, spin.y, spin.z, 0, ONE, 0, radius);
    expect(toNumber(magnitude(out.x, out.y, out.z))).toBeLessThan(0.02);
  });
});
