import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../src/core/spatialGrid';
import { Surroundings } from '../src/core/surroundings';
import { Checksum } from '../src/core/random';
import { ONE } from '../src/core/fixed';
import {
  ControlTrack,
  MAX_PLAYERS,
  PACKED_NEUTRAL,
  packControls,
  unpackControls,
} from '../src/core/input';

describe('finding what is nearby', () => {
  const x = new Int32Array([0, 1000, 100000, -100000, 5000]);
  const y = new Int32Array([0, 0, 0, 0, 0]);
  const z = new Int32Array([0, 500, 0, 0, 0]);

  it('offers up the things that really are close', () => {
    const grid = new SpatialGrid(4096, 64, 16);
    grid.build(x, y, z, 5);
    const near = grid.near(0, 0, 0, 4096);
    expect(near).toContain(0);
    expect(near).toContain(1);
    expect(near).not.toContain(2);
  });

  it('leaves out things that are far away', () => {
    const grid = new SpatialGrid(4096, 64, 16);
    grid.build(x, y, z, 5);
    expect(grid.near(100000, 0, 0, 2048)).not.toContain(3);
  });

  it('answers the same way however the things were filed', () => {
    const forward = new SpatialGrid(4096, 64, 16);
    forward.build(x, y, z, 5);
    const reverseX = Int32Array.from([...x].reverse());
    const reverseZ = Int32Array.from([...z].reverse());
    const backward = new SpatialGrid(4096, 64, 16);
    backward.build(reverseX, y, reverseZ, 5);
    const a = forward.near(0, 0, 0, 4096).length;
    const b = backward.near(0, 0, 0, 4096).length;
    expect(b).toBe(a);
  });

  it('copes with places a long way from the middle of the world', () => {
    const grid = new SpatialGrid(4096, 64, 16);
    const far = new Int32Array([-2_000_000_000, 2_000_000_000]);
    grid.build(far, new Int32Array(2), new Int32Array(2), 2);
    expect(grid.near(-2_000_000_000, 0, 0, 4096)).toContain(0);
  });

  it('grows its filing space when given more things than it expected', () => {
    const grid = new SpatialGrid(4096, 16, 2);
    const many = new Int32Array(100);
    for (let i = 0; i < 100; i++) many[i] = i * 100;
    expect(() => grid.build(many, new Int32Array(100), new Int32Array(100), 100)).not.toThrow();
    expect(grid.size).toBe(100);
  });
});

describe('the motion of the surroundings', () => {
  it('starts perfectly still', () => {
    const air = new Surroundings(12, 8);
    expect(air.at(5, 4)).toBe(0);
    expect(air.liveliness).toBe(0);
  });

  it('spreads a disturbance to its neighbours', () => {
    const air = new Surroundings(12, 8);
    air.disturb(6, 4, ONE);
    for (let step = 0; step < 6; step++) air.advance(step, 1, 0);
    expect(Math.abs(air.at(5, 4)) + Math.abs(air.at(7, 4))).toBeGreaterThan(0);
  });

  it('settles down again instead of growing without limit', () => {
    const air = new Surroundings(12, 8);
    air.disturb(6, 4, ONE * 3);
    let biggest = 0;
    for (let step = 0; step < 2000; step++) {
      air.advance(step, 1, 0);
      for (let a = 0; a < 12; a++) {
        for (let b = 0; b < 8; b++) biggest = Math.max(biggest, Math.abs(air.at(a, b)));
      }
    }
    expect(biggest).toBeLessThan(ONE * 8);
    expect(Math.abs(air.at(6, 4))).toBeLessThan(ONE);
  });

  it('behaves identically for the same seed', () => {
    const first = new Surroundings(10, 6);
    const second = new Surroundings(10, 6);
    for (let step = 0; step < 400; step++) {
      first.advance(step, 0xbeef, ONE);
      second.advance(step, 0xbeef, ONE);
    }
    const a = new Checksum();
    const b = new Checksum();
    first.checksum(a);
    second.checksum(b);
    expect(b.result).toBe(a.result);
  });

  it('behaves differently for a different seed', () => {
    const first = new Surroundings(10, 6);
    const second = new Surroundings(10, 6);
    for (let step = 0; step < 400; step++) {
      first.advance(step, 1, ONE);
      second.advance(step, 2, ONE);
    }
    const a = new Checksum();
    const b = new Checksum();
    first.checksum(a);
    second.checksum(b);
    expect(b.result).not.toBe(a.result);
  });

  it('reads smoothly between cells', () => {
    const air = new Surroundings(8, 8);
    air.disturb(3, 3, ONE);
    const left = air.sample(3 * ONE, 3 * ONE);
    const middle = air.sample(Math.round(3.5 * ONE), 3 * ONE);
    expect(Math.abs(middle)).toBeLessThanOrEqual(Math.abs(left));
  });

  it('reports still air outside its edges', () => {
    const air = new Surroundings(6, 6);
    expect(air.at(-1, 0)).toBe(0);
    expect(air.at(0, 99)).toBe(0);
  });

  it('can be copied for winding back', () => {
    const source = new Surroundings(8, 8);
    source.disturb(4, 4, ONE);
    for (let step = 0; step < 20; step++) source.advance(step, 5, 0);
    const target = new Surroundings(8, 8);
    source.copyTo(target);
    expect(target.at(4, 4)).toBe(source.at(4, 4));
  });
});

describe('recording what the player did', () => {
  it('packs and unpacks steering without losing the feel of it', () => {
    for (const steer of [-65536, -32768, 0, 20000, 65536]) {
      const back = unpackControls(packControls({ steer, push: 0, buttons: 0 }));
      expect(Math.abs(back.steer - steer)).toBeLessThan(600);
    }
  });

  it('keeps the switches intact', () => {
    const back = unpackControls(packControls({ steer: 0, push: 0, buttons: 3 }));
    expect(back.buttons).toBe(3);
  });

  it('holds a whole run in one number per step', () => {
    const packed = packControls({ steer: 40000, push: -20000, buttons: 1 });
    expect(Number.isInteger(packed)).toBe(true);
    expect(packed).toBeLessThanOrEqual(0xffffff);
  });

  it('reads back what was recorded', () => {
    const track = new ControlTrack(100, MAX_PLAYERS);
    const packed = packControls({ steer: 30000, push: 0, buttons: 0 });
    track.record(5, 0, packed);
    expect(track.read(5, 0)).toBe(packed);
    expect(track.lastRecorded(0)).toBe(5);
  });

  it('carries on with the last thing it saw when a step is missing', () => {
    const track = new ControlTrack(100, MAX_PLAYERS);
    const packed = packControls({ steer: 30000, push: 0, buttons: 0 });
    track.record(3, 0, packed);
    expect(track.read(9, 0)).toBe(packed);
  });

  it('reports doing nothing before anything has been recorded', () => {
    const track = new ControlTrack(100, MAX_PLAYERS);
    expect(track.read(0, 0)).toBe(PACKED_NEUTRAL);
    expect(track.read(-1, 0)).toBe(PACKED_NEUTRAL);
    expect(track.read(500, 0)).toBe(PACKED_NEUTRAL);
  });

  it('keeps four players apart, ready for a shared game', () => {
    const track = new ControlTrack(100, MAX_PLAYERS);
    for (let p = 0; p < MAX_PLAYERS; p++) {
      track.record(2, p, packControls({ steer: p * 10000, push: 0, buttons: 0 }));
    }
    for (let p = 0; p < MAX_PLAYERS; p++) {
      expect(unpackControls(track.read(2, p)).steer).toBeCloseTo(p * 10000, -3);
    }
  });

  it('sends a run out and takes it back in', () => {
    const track = new ControlTrack(100, MAX_PLAYERS);
    for (let i = 0; i < 20; i++) {
      track.record(i, 0, packControls({ steer: i * 1000, push: 0, buttons: 0 }));
    }
    const saved = track.export(0);
    expect(saved).toHaveLength(20);

    const other = new ControlTrack(100, MAX_PLAYERS);
    other.import(saved, 0);
    expect(other.export(0)).toEqual(saved);
  });

  it('forgets everything when asked', () => {
    const track = new ControlTrack(50, MAX_PLAYERS);
    track.record(1, 0, packControls({ steer: 100, push: 0, buttons: 0 }));
    track.clear();
    expect(track.lastRecorded(0)).toBe(-1);
    expect(track.read(1, 0)).toBe(PACKED_NEUTRAL);
  });
});
