import { describe, expect, it } from 'vitest';
import {
  EntityStore,
  Kind,
  REST_THRESHOLD,
  RHYTHM_SPEED,
  Stage,
  advanceEntities,
  rebuild,
  restoreGroup,
  summarise,
} from '../src/core/entities';
import { Checksum } from '../src/core/random';

function storeWithOne(kind: number = Kind.Orb): EntityStore {
  const store = new EntityStore(8);
  store.add(100, 200, 300, kind, 42, 1234, 30000);
  return store;
}

describe('packing a whole condition into two slots', () => {
  it('reads back everything that was written', () => {
    const store = storeWithOne(Kind.Lantern);
    expect(store.count).toBe(1);
    expect(store.x[0]).toBe(100);
    expect(store.progressOf(0)).toBe(1234);
    expect(store.energyOf(0)).toBe(30000);
    expect(store.kindOf(0)).toBe(Kind.Lantern);
    expect(store.looksOf(0)).toBe(42);
    expect(store.stageOf(0)).toBe(Stage.Appearing);
    expect(store.isMoving(0)).toBe(true);
  });

  it('keeps the fields from treading on each other', () => {
    const store = storeWithOne();
    store.setProgress(0, 65535);
    store.setEnergy(0, 65535);
    store.setTiredness(0, 65535);
    store.setStage(0, Stage.Shifting);
    store.setKind(0, Kind.Plant);
    store.setLooks(0, 255);
    store.setMoving(0, false);
    expect(store.progressOf(0)).toBe(65535);
    expect(store.energyOf(0)).toBe(65535);
    expect(store.tirednessOf(0)).toBe(65535);
    expect(store.stageOf(0)).toBe(Stage.Shifting);
    expect(store.kindOf(0)).toBe(Kind.Plant);
    expect(store.looksOf(0)).toBe(255);
    expect(store.isMoving(0)).toBe(false);
  });

  it('holds values inside their limits instead of wrapping unexpectedly', () => {
    const store = storeWithOne();
    store.setEnergy(0, 99999);
    expect(store.energyOf(0)).toBe(65535);
    store.setTiredness(0, -50);
    expect(store.tirednessOf(0)).toBe(0);
  });

  it('refuses to grow past the pool it was given', () => {
    const store = new EntityStore(2);
    expect(store.add(0, 0, 0, 0, 0, 0, 0)).toBe(0);
    expect(store.add(0, 0, 0, 0, 0, 0, 0)).toBe(1);
    expect(store.add(0, 0, 0, 0, 0, 0, 0)).toBe(-1);
    expect(store.count).toBe(2);
  });
});

describe('living out a rhythm', () => {
  it('moves forward and tires out', () => {
    const store = storeWithOne();
    const before = store.progressOf(0);
    advanceEntities(store, 0);
    expect(store.progressOf(0)).toBe(before + RHYTHM_SPEED[Kind.Orb]);
    expect(store.tirednessOf(0)).toBeGreaterThan(0);
  });

  it('takes a break once it is worn out, and skips the busy work', () => {
    const store = storeWithOne();
    store.setTiredness(0, REST_THRESHOLD);
    const busy = advanceEntities(store, 0);
    expect(busy).toBe(1);
    expect(store.isMoving(0)).toBe(false);

    const resting = store.progressOf(0);
    const busyAgain = advanceEntities(store, 0);
    expect(busyAgain).toBe(0);
    expect(store.progressOf(0)).toBe(resting);
    expect(store.tirednessOf(0)).toBeLessThan(REST_THRESHOLD);
  });

  it('gets going again once it has recovered', () => {
    const store = storeWithOne();
    store.setMoving(0, false);
    store.setTiredness(0, REST_THRESHOLD);
    let stepsResting = 0;
    while (!store.isMoving(0) && stepsResting < 500) {
      advanceEntities(store, 0);
      stepsResting++;
    }
    expect(store.isMoving(0)).toBe(true);
    // A break is meant to be a real pause, not a single skipped step.
    expect(stepsResting).toBeGreaterThan(10);
  });

  it('is left completely alone once asleep', () => {
    const store = storeWithOne();
    store.setStage(0, Stage.Sleeping);
    const before = store.low[0];
    const after = advanceEntities(store, 65535);
    expect(after).toBe(0);
    expect(store.low[0]).toBe(before);
  });

  it('walks through its stages of life in order', () => {
    const store = storeWithOne();
    const seen = new Set<number>();
    for (let step = 0; step < 4000; step++) {
      advanceEntities(store, 0);
      seen.add(store.stageOf(0));
    }
    expect(seen.has(Stage.Growing)).toBe(true);
    expect(store.stageOf(0)).toBeGreaterThanOrEqual(Stage.Growing);
  });

  it('is busier when its surroundings are stirred up', () => {
    const calm = storeWithOne();
    const stirred = storeWithOne();
    advanceEntities(calm, 0);
    advanceEntities(stirred, 65535);
    expect(stirred.tirednessOf(0)).toBeGreaterThan(calm.tirednessOf(0));
  });
});

describe('looking ahead in one go', () => {
  it('matches stepping there one step at a time', () => {
    const stepwise = storeWithOne();
    const jumped = storeWithOne();
    const speed = RHYTHM_SPEED[Kind.Orb];
    const steps = 500;
    for (let i = 0; i < steps; i++) {
      stepwise.setProgress(0, (stepwise.progressOf(0) + speed) & 0xffff);
    }
    expect(jumped.jumpAhead(0, steps, speed)).toBe(stepwise.progressOf(0));
  });

  it('costs the same however far ahead it looks', () => {
    const store = storeWithOne();
    expect(store.jumpAhead(0, 1_000_000, 420)).toBe((1234 + 1_000_000 * 420) & 0xffff);
  });
});

describe('putting a group aside and bringing it back', () => {
  it('boils a group down to one short note', () => {
    const store = new EntityStore(16);
    for (let i = 0; i < 5; i++) store.add(i * 100, 50, i * 20, Kind.Orb, 0, i * 1000, 20000 + i);
    const note = summarise(store, 0, 5, 30, 7);
    expect(note.population).toBe(5);
    expect(note.groupId).toBe(7);
    expect(note.x).toBe(Math.floor((0 + 100 + 200 + 300 + 400) / 5));
    expect(note.energy).toBeGreaterThan(19999);
  });

  it('brings back exactly the same members from the same note', () => {
    const first = new EntityStore(16);
    const second = new EntityStore(16);
    for (let i = 0; i < 6; i++) {
      first.add(0, 0, 0, Kind.Orb, 0, 0, 0);
      second.add(0, 0, 0, Kind.Orb, 0, 0, 0);
    }
    const note = {
      x: 1000,
      y: 2000,
      z: 3000,
      population: 6,
      energy: 40000,
      tiredness: 5000,
      step: 0,
      groupId: 3,
    };
    restoreGroup(first, 0, 6, note, 0xabcdef, 200000);
    restoreGroup(second, 0, 6, note, 0xabcdef, 200000);
    expect([...second.x]).toEqual([...first.x]);
    expect([...second.low]).toEqual([...first.low]);
    expect([...second.high]).toEqual([...first.high]);
  });

  it('scatters the members around where the note says the group was', () => {
    const store = new EntityStore(16);
    for (let i = 0; i < 6; i++) store.add(0, 0, 0, Kind.Orb, 0, 0, 0);
    const spread = 200000;
    restoreGroup(
      store,
      0,
      6,
      { x: 0, y: 0, z: 0, population: 6, energy: 1, tiredness: 1, step: 0, groupId: 1 },
      1,
      spread,
    );
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(store.x[i])).toBeLessThanOrEqual(spread);
      expect(Math.abs(store.z[i])).toBeLessThanOrEqual(spread);
    }
  });

  it('can also rebuild a group as fresh entries', () => {
    const store = new EntityStore(16);
    const added = rebuild(
      store,
      { x: 5, y: 6, z: 7, population: 4, energy: 100, tiredness: 2, step: 9, groupId: 2 },
      42,
      1000,
    );
    expect(added).toBe(4);
    expect(store.count).toBe(4);
  });
});

describe('comparing two copies of a world', () => {
  it('agrees when the pools match and disagrees when they do not', () => {
    const a = storeWithOne();
    const b = storeWithOne();
    const sumA = new Checksum();
    const sumB = new Checksum();
    a.checksum(sumA);
    b.checksum(sumB);
    expect(sumA.result).toBe(sumB.result);

    b.setEnergy(0, 1);
    const sumC = new Checksum();
    b.checksum(sumC);
    expect(sumC.result).not.toBe(sumA.result);
  });

  it('copies a whole pool for winding back', () => {
    const source = storeWithOne();
    const target = new EntityStore(8);
    source.copyTo(target);
    expect(target.count).toBe(source.count);
    expect(target.low[0]).toBe(source.low[0]);
    source.setEnergy(0, 5);
    expect(target.energyOf(0)).not.toBe(5);
  });
});
