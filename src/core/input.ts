/**
 * What the player is doing, recorded step by step.
 *
 * Controls are boiled down to two numbers and a few on/off switches, then
 * squeezed into a single whole number. That keeps a whole run small enough
 * to save as a replay, and it is also the only thing that would have to
 * travel between devices for a play-together mode: because the world is
 * rebuilt from the same numbers everywhere, sending the controls is enough.
 */

/** How many players a run has room for. Solo play uses the first slot. */
export const MAX_PLAYERS = 4;

/** On/off switches carried alongside the steering. */
export const Button = {
  Brake: 1 << 0,
  Restart: 1 << 1,
} as const;

/** One moment of control input, in everyday numbers. */
export interface Controls {
  /** Left or right, from -1.0 to 1.0 as a stored value (-65536 .. 65536). */
  steer: number;
  /** Forward or back, in the same unit. */
  push: number;
  /** The switches listed in Button. */
  buttons: number;
}

export const NEUTRAL: Controls = { steer: 0, push: 0, buttons: 0 };

function toByte(value: number): number {
  // -65536..65536 squeezed into -127..127, then stored without a sign bit.
  const clamped = value < -65536 ? -65536 : value > 65536 ? 65536 : value;
  const scaled = Math.round((clamped * 127) / 65536);
  return (scaled + 128) & 0xff;
}

function fromByte(value: number): number {
  const scaled = (value & 0xff) - 128;
  return Math.round((scaled * 65536) / 127);
}

/** Packs one moment of control input into a single whole number. */
export function packControls(controls: Controls): number {
  return (
    ((toByte(controls.steer) & 0xff) |
      ((toByte(controls.push) & 0xff) << 8) |
      ((controls.buttons & 0xff) << 16)) >>>
    0
  );
}

/** Unpacks a number made by {@link packControls}. */
export function unpackControls(packed: number): Controls {
  return {
    steer: fromByte(packed & 0xff),
    push: fromByte((packed >>> 8) & 0xff),
    buttons: (packed >>> 16) & 0xff,
  };
}

/** The packed form of "hands off the controls". */
export const PACKED_NEUTRAL = packControls(NEUTRAL);

/**
 * Every player's controls for every step of a run.
 *
 * Steps that were never filled in report the last known value instead, which
 * is the same guess a play-together mode would make while it waits for a
 * slower device to catch up.
 */
export class ControlTrack {
  private readonly frames: Uint32Array[];
  private readonly filled: Int32Array;
  readonly players: number;
  readonly capacity: number;

  constructor(capacity = 120 * 60 * 6, players = MAX_PLAYERS) {
    this.players = players;
    this.capacity = capacity;
    this.frames = [];
    for (let p = 0; p < players; p++) {
      this.frames.push(new Uint32Array(capacity).fill(PACKED_NEUTRAL));
    }
    this.filled = new Int32Array(players).fill(-1);
  }

  /** Records what one player did on one step. */
  record(step: number, player: number, packed: number): void {
    if (step < 0 || step >= this.capacity || player < 0 || player >= this.players) return;
    this.frames[player][step] = packed >>> 0;
    if (step > this.filled[player]) this.filled[player] = step;
  }

  /** Reads what one player did on one step. */
  read(step: number, player = 0): number {
    if (player < 0 || player >= this.players) return PACKED_NEUTRAL;
    if (step < 0) return PACKED_NEUTRAL;
    if (step >= this.capacity) return PACKED_NEUTRAL;
    if (step > this.filled[player]) {
      // Nothing recorded yet: carry on with the last thing we saw.
      const last = this.filled[player];
      return last >= 0 ? this.frames[player][last] : PACKED_NEUTRAL;
    }
    return this.frames[player][step];
  }

  /** The last step that has a real recording for a player. */
  lastRecorded(player = 0): number {
    return this.filled[player];
  }

  /** Forgets everything. */
  clear(): void {
    for (let p = 0; p < this.players; p++) {
      this.frames[p].fill(PACKED_NEUTRAL);
      this.filled[p] = -1;
    }
  }

  /** Copies out one player's recording, ready to be saved as a replay. */
  export(player = 0): number[] {
    const end = this.filled[player];
    const out: number[] = [];
    for (let i = 0; i <= end; i++) out.push(this.frames[player][i]);
    return out;
  }

  /** Loads a recording back in. */
  import(values: ArrayLike<number>, player = 0): void {
    for (let i = 0; i < values.length; i++) this.record(i, player, values[i]);
  }
}
