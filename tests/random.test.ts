import { describe, expect, it } from 'vitest';
import { Checksum, Generator, generatorFor, mix, seedFromText } from '../src/core/random';

describe('repeatable randomness', () => {
  it('gives the same run of numbers for the same seed', () => {
    const a = new Generator(12345);
    const b = new Generator(12345);
    for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next());
  });

  it('gives different runs for different seeds', () => {
    const a = new Generator(1);
    const b = new Generator(2);
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });

  it('stays inside the range it was asked for', () => {
    const rng = new Generator(99);
    for (let i = 0; i < 1000; i++) {
      const value = rng.below(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it('covers the whole range it was asked for', () => {
    const rng = new Generator(4242);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.between(3, 9));
    expect([...seen].sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('spreads roughly evenly', () => {
    const rng = new Generator(7);
    const buckets = new Array(10).fill(0);
    const draws = 20000;
    for (let i = 0; i < draws; i++) buckets[rng.below(10)]++;
    for (const count of buckets) {
      expect(count).toBeGreaterThan(draws / 10 - draws / 40);
      expect(count).toBeLessThan(draws / 10 + draws / 40);
    }
  });

  it('keeps unit values inside their bounds', () => {
    const rng = new Generator(31337);
    for (let i = 0; i < 2000; i++) {
      const unit = rng.unit();
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThanOrEqual(65535);
      const signed = rng.signedUnit();
      expect(signed).toBeGreaterThanOrEqual(-65536);
      expect(signed).toBeLessThanOrEqual(65536);
    }
  });
});

describe('mixing', () => {
  it('is settled by its three inputs alone', () => {
    expect(mix(1, 2, 3)).toBe(mix(1, 2, 3));
    expect(mix(1, 2, 3)).not.toBe(mix(3, 2, 1));
  });

  it('always returns a plain positive whole number', () => {
    for (let i = -50; i < 50; i++) {
      const value = mix(i, i * 31, -i);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('turns text into a seed the same way every time', () => {
    expect(seedFromText('meadow')).toBe(seedFromText('meadow'));
    expect(seedFromText('meadow')).not.toBe(seedFromText('valley'));
  });

  it('can be asked for the same thing at the same moment twice', () => {
    const a = generatorFor(555, 12, 900);
    const b = generatorFor(555, 12, 900);
    expect(a.next()).toBe(b.next());
  });
});

describe('checksums', () => {
  it('matches for matching input', () => {
    const a = new Checksum().add(1).add(2).add(3);
    const b = new Checksum().add(1).add(2).add(3);
    expect(a.result).toBe(b.result);
  });

  it('notices a single changed number', () => {
    const a = new Checksum().add(1).add(2).add(3);
    const b = new Checksum().add(1).add(2).add(4);
    expect(a.result).not.toBe(b.result);
  });

  it('notices numbers arriving in a different order', () => {
    const a = new Checksum().add(1).add(2);
    const b = new Checksum().add(2).add(1);
    expect(a.result).not.toBe(b.result);
  });

  it('handles whole arrays', () => {
    const values = new Int32Array([5, -7, 900000, 0]);
    const a = new Checksum().addAll(values);
    const b = new Checksum().add(5).add(-7).add(900000).add(0);
    expect(a.result).toBe(b.result);
  });
});
