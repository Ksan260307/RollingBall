/**
 * The readout shown while a run is going: the clock, the speed, how much of
 * the course is left, and the countdown at the start.
 *
 * It is deliberately sparse. During a run the player is looking at the ball,
 * not at the numbers, so only what genuinely helps is on screen.
 */

import { ONE } from '../core/fixed';
import { RunState, World } from '../core/simulation';
import { Session } from '../game/session';
import { el } from './dom';
import { TEXT, formatSpeed, formatTime } from './text';

export class Hud {
  readonly root: HTMLElement;
  private readonly timeValue: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly lightsValue: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly warning: HTMLElement;
  private readonly moodFill: HTMLElement;

  private lastCountdown = -1;

  constructor() {
    this.timeValue = el('div', { class: 'hud-time', text: '0:00.00' });
    this.speedValue = el('div', { class: 'hud-speed', text: '0 km/h' });
    this.bestValue = el('div', { class: 'hud-best', text: `${TEXT.bestTime} --:--.--` });
    this.lightsValue = el('div', { class: 'hud-lights', text: '0' });
    this.progressFill = el('div', { class: 'hud-progress-fill' });
    this.moodFill = el('div', { class: 'hud-mood-fill' });
    this.countdown = el('div', { class: 'hud-countdown', text: '' });
    this.warning = el('div', { class: 'hud-warning', text: '' });

    this.root = el(
      'div',
      { class: 'hud', id: 'hud' },
      el(
        'div',
        { class: 'hud-top' },
        el(
          'div',
          { class: 'hud-block' },
          el('div', { class: 'hud-label', text: TEXT.time }),
          this.timeValue,
          this.bestValue,
        ),
        el(
          'div',
          { class: 'hud-block hud-right' },
          el('div', { class: 'hud-label', text: TEXT.speed }),
          this.speedValue,
          el(
            'div',
            { class: 'hud-lights-row' },
            el('span', { class: 'hud-light-dot', text: '✦' }),
            this.lightsValue,
          ),
        ),
      ),
      el(
        'div',
        { class: 'hud-progress' },
        this.progressFill,
        el('div', { class: 'hud-progress-label', text: TEXT.progress }),
      ),
      el(
        'div',
        { class: 'hud-mood', title: TEXT.neighbourhood },
        this.moodFill,
      ),
      this.countdown,
      this.warning,
    );
  }

  /** Shows or hides the whole readout. */
  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
  }

  /** Puts the player's best time for this course on screen. */
  setBest(seconds: number | undefined): void {
    this.bestValue.textContent =
      seconds === undefined
        ? `${TEXT.bestTime} ${TEXT.noRecord}`
        : `${TEXT.bestTime} ${formatTime(seconds)}`;
  }

  /** Refreshes everything from the run in progress. */
  update(session: Session): void {
    const world: World = session.world;
    this.timeValue.textContent = formatTime(session.seconds);
    this.speedValue.textContent = formatSpeed(world.speedFor(0) / ONE);
    this.lightsValue.textContent = String(world.collected[0]);

    const progress = world.progressFor(0) / ONE;
    this.progressFill.style.width = `${Math.round(progress * 100)}%`;

    const mood = world.surroundings.liveliness / 65535;
    this.moodFill.style.width = `${Math.round(Math.min(1, mood) * 100)}%`;

    const remaining = session.countdownSeconds;
    if (world.state[0] === RunState.Ready && remaining > 0) {
      if (remaining !== this.lastCountdown) {
        this.countdown.textContent = String(remaining);
        this.countdown.classList.remove('is-pop');
        // Restarting the animation needs the browser to notice the change.
        void this.countdown.offsetWidth;
        this.countdown.classList.add('is-pop');
        this.lastCountdown = remaining;
      }
    } else if (this.lastCountdown !== 0) {
      this.countdown.textContent = TEXT.countdownGo;
      this.countdown.classList.remove('is-pop');
      void this.countdown.offsetWidth;
      this.countdown.classList.add('is-pop');
      this.lastCountdown = 0;
      window.setTimeout(() => {
        if (this.countdown.textContent === TEXT.countdownGo) this.countdown.textContent = '';
      }, 700);
    }

    // A gentle nudge when the ball strays towards the edge.
    const halfWidth = world.halfWidth[0];
    const nearEdge =
      halfWidth > 0 && Math.abs(world.sideways[0]) > halfWidth - Math.round(0.8 * ONE);
    this.warning.classList.toggle('is-showing', nearEdge && world.state[0] === RunState.Rolling);
  }

  /** Puts the countdown back to the start for a fresh attempt. */
  reset(): void {
    this.lastCountdown = -1;
    this.countdown.textContent = '';
    this.warning.classList.remove('is-showing');
  }
}
