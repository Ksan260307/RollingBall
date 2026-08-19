/**
 * The noises the game makes.
 *
 * Every sound is built out of oscillators and noise on the spot, so the game
 * carries no audio files at all: nothing to download, nothing to wait for,
 * and the whole lot costs a couple of kilobytes of code.
 *
 * Sound is presentation and nothing more. It reads the world and never
 * changes it, so a run sounds different on different devices without the
 * result ever differing by a single step.
 *
 * Browsers refuse to make a noise until the player has touched the page, so
 * everything here waits politely for that first tap and stays silent until
 * then rather than throwing.
 */

import { ONE } from '../core/fixed';
import type { Moment, World } from '../core/simulation';

/** How loud the game is overall, before anything else is worked out. */
const MASTER = 0.5;

/** How quickly the rolling sound follows the ball, in seconds. */
const ROLL_EASE = 0.08;

export class Sounds {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  /** The steady sound of the ball on the floor. */
  private rollNoise: AudioBufferSourceNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollGain: GainNode | null = null;

  /** Shared white noise, made once and played over and over. */
  private noiseBuffer: AudioBuffer | null = null;

  private enabled = true;
  private started = false;

  /** Turns the sound on or off, as the settings ask. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(on ? MASTER : 0, this.context.currentTime, 0.05);
    }
    if (!on) this.stopRolling();
  }

  /**
   * Wakes the sound up. Browsers only allow this from something the player
   * did, so it is called from the first tap or key press.
   */
  wake(): void {
    if (this.started) {
      void this.context?.resume();
      return;
    }
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.enabled ? MASTER : 0;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.makeNoise(this.context);
      this.started = true;
    } catch {
      // No sound available. The game plays on in silence.
      this.context = null;
    }
  }

  /** Two seconds of white noise, reused for every rough sound. */
  private makeNoise(context: AudioContext): AudioBuffer {
    const frames = context.sampleRate * 2;
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const data = buffer.getChannelData(0);
    // A plain repeatable pattern; nobody can hear the difference from random.
    let value = 12345;
    for (let i = 0; i < frames; i++) {
      value = (value * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (value / 0x3fffffff) - 1;
    }
    return buffer;
  }

  private get live(): boolean {
    return this.enabled && this.context !== null && this.master !== null;
  }

  /** A short shaped tone. The workhorse behind most of the game's noises. */
  private tone(
    shape: OscillatorType,
    from: number,
    to: number,
    seconds: number,
    volume: number,
    delay = 0,
  ): void {
    if (!this.live || !this.context || !this.master) return;
    const at = this.context.currentTime + delay;
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.type = shape;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + Math.min(0.02, seconds / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(at);
    osc.stop(at + seconds + 0.05);
  }

  /** A burst of filtered noise: scrapes, thumps and skids. */
  private rush(centre: number, seconds: number, volume: number, quality = 1): void {
    if (!this.live || !this.context || !this.master || !this.noiseBuffer) return;
    const at = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(centre, at);
    filter.Q.value = quality;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(at);
    source.stop(at + seconds + 0.05);
  }

  /* ------------------------------------------------------------ the ball */

  private startRolling(): void {
    if (!this.live || !this.context || !this.master || !this.noiseBuffer) return;
    if (this.rollNoise) return;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 3;
    const gain = this.context.createGain();
    gain.gain.value = 0.0001;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    this.rollNoise = source;
    this.rollFilter = filter;
    this.rollGain = gain;
  }

  private stopRolling(): void {
    if (!this.rollNoise) return;
    try {
      this.rollNoise.stop();
    } catch {
      // Already stopped.
    }
    this.rollNoise.disconnect();
    this.rollFilter?.disconnect();
    this.rollGain?.disconnect();
    this.rollNoise = null;
    this.rollFilter = null;
    this.rollGain = null;
  }

  /**
   * Keeps the rolling sound in step with the ball: louder and brighter the
   * faster it goes, and gone the moment it leaves the floor.
   */
  followBall(world: World): void {
    if (!this.live || !this.context) {
      this.stopRolling();
      return;
    }
    this.startRolling();
    if (!this.rollGain || !this.rollFilter) return;

    const speed = world.speedFor(0) / ONE;
    const onFloor = world.grounded[0] === 1;
    const level = onFloor ? Math.min(0.3, speed * 0.016) : 0;
    const brightness = 180 + Math.min(1400, speed * 90);
    const now = this.context.currentTime;
    this.rollGain.gain.setTargetAtTime(Math.max(0.0001, level), now, ROLL_EASE);
    this.rollFilter.frequency.setTargetAtTime(brightness, now, ROLL_EASE);
  }

  /** Everything the rules said happened this step. */
  playMoments(moments: readonly Moment[]): void {
    for (const moment of moments) {
      const strength = Math.min(3, moment.strength / ONE);
      switch (moment.kind) {
        case 'land':
          this.rush(120 + strength * 40, 0.16, Math.min(0.35, 0.06 + strength * 0.06), 0.8);
          this.tone('sine', 90, 55, 0.14, Math.min(0.3, 0.05 + strength * 0.05));
          break;
        case 'wall':
          this.tone('triangle', 220, 120, 0.12, Math.min(0.28, 0.05 + strength * 0.05));
          break;
        case 'skid':
          this.rush(1400, 0.18, 0.05, 6);
          break;
        case 'fall':
          this.tone('sawtooth', 420, 60, 0.7, 0.22);
          break;
        case 'stuck':
          this.tone('square', 200, 90, 0.5, 0.2);
          break;
        case 'finish':
          this.fanfare();
          break;
        default:
          break;
      }
    }
  }

  /* --------------------------------------------------------- set pieces */

  /** One of the three counting blips before the start. */
  countIn(): void {
    this.tone('sine', 660, 660, 0.12, 0.18);
  }

  /** The one that lets the ball go. */
  goSignal(): void {
    this.tone('sine', 990, 990, 0.3, 0.22);
    this.tone('sine', 1320, 1320, 0.4, 0.14, 0.05);
    this.rush(900, 0.25, 0.08, 1.5);
  }

  /** Something to hear on crossing the line. */
  fanfare(): void {
    const notes = [523, 659, 784, 1047];
    notes.forEach((note, index) => {
      this.tone('triangle', note, note, 0.5, 0.16, index * 0.09);
    });
    this.rush(1200, 0.5, 0.07, 1);
  }

  /** A ticking count while the ball is getting nowhere. */
  stallTick(secondsLeft: number): void {
    const urgent = secondsLeft <= 3;
    this.tone('square', urgent ? 440 : 330, urgent ? 440 : 330, 0.09, urgent ? 0.16 : 0.1);
  }

  /** A tap on a button. */
  click(): void {
    this.tone('triangle', 520, 520, 0.06, 0.1);
  }

  /** Stops everything, for when the game leaves the course. */
  quieten(): void {
    this.stopRolling();
  }
}
