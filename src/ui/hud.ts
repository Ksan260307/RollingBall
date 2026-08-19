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
import { clear, el } from './dom';
import { TEXT, formatSpeed, formatTime } from './text';

export class Hud {
  readonly root: HTMLElement;
  private readonly timeValue: HTMLElement;
  private readonly speedValue: HTMLElement;
  private readonly bestValue: HTMLElement;
  private readonly fallsValue: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly stall: HTMLElement;
  private readonly flash: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerText: HTMLElement;
  private readonly countdown: HTMLElement;
  private readonly warning: HTMLElement;

  private lastCountdown = -1;
  private lastFalls = 0;
  private lastStallSecond = -1;
  /** Called when the stall count ticks down a second, so a sound can play. */
  onStallTick: ((secondsLeft: number) => void) | null = null;
  /** Called on each of the three counting numbers before the start. */
  onCountIn: ((secondsLeft: number) => void) | null = null;
  /** Called the moment the ball is let go. */
  onGo: (() => void) | null = null;

  constructor() {
    this.timeValue = el('div', { class: 'hud-time', text: '0:00.00' });
    this.speedValue = el('div', { class: 'hud-speed', text: '0 km/h' });
    this.bestValue = el('div', { class: 'hud-best', text: `${TEXT.bestTime} --:--.--` });
    this.fallsValue = el('div', { class: 'hud-falls', text: '' });
    this.notice = el('div', { class: 'hud-notice' });
    this.stall = el('div', { class: 'hud-stall' });
    this.flash = el('div', { class: 'hud-flash' });
    this.bannerText = el('div', { class: 'hud-banner-text' });
    this.banner = el('div', { class: 'hud-banner' }, this.bannerText);
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
          this.fallsValue,
        ),
      ),
      this.flash,
      this.banner,
      this.countdown,
      this.stall,
      this.notice,
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
    const falls = world.falls[0];
    this.fallsValue.textContent = falls > 0 ? `${TEXT.falls} ${falls}` : '';
    if (falls !== this.lastFalls) {
      this.lastFalls = falls;
      if (falls > 0) this.showNotice();
    }

    const remaining = session.countdownSeconds;
    if (world.state[0] === RunState.Ready && remaining > 0) {
      if (remaining !== this.lastCountdown) {
        this.countdown.textContent = String(remaining);
        this.countdown.classList.remove('is-pop');
        // Restarting the animation needs the browser to notice the change.
        void this.countdown.offsetWidth;
        this.countdown.classList.add('is-pop');
        this.lastCountdown = remaining;
        this.onCountIn?.(remaining);
      }
    } else if (this.lastCountdown !== 0) {
      this.countdown.textContent = TEXT.countdownGo;
      this.countdown.classList.remove('is-pop');
      void this.countdown.offsetWidth;
      this.countdown.classList.add('is-pop');
      this.lastCountdown = 0;
      this.onGo?.();
      window.setTimeout(() => {
        if (this.countdown.textContent === TEXT.countdownGo) this.countdown.textContent = '';
      }, 700);
    }

    // The count that runs while the ball is getting nowhere.
    if (world.isStalling(0) && world.state[0] === RunState.Rolling) {
      const left = Math.ceil(world.stallSecondsFor(0));
      this.stall.classList.add('is-showing');
      this.stall.classList.toggle('is-urgent', left <= 3);
      clear(this.stall);
      this.stall.append(
        el('div', { class: 'hud-stall-title', text: TEXT.stuckTitle }),
        el('div', { class: 'hud-stall-count', text: `${TEXT.stuckHint} ${left}` }),
      );
      if (left !== this.lastStallSecond) {
        this.lastStallSecond = left;
        this.onStallTick?.(left);
      }
    } else if (this.stall.classList.contains('is-showing')) {
      this.stall.classList.remove('is-showing');
      this.lastStallSecond = -1;
    }

    // A gentle nudge when the ball strays towards the edge.
    const halfWidth = world.halfWidth[0];
    const nearEdge =
      halfWidth > 0 && Math.abs(world.sideways[0]) > halfWidth - Math.round(0.8 * ONE);
    this.warning.classList.toggle('is-showing', nearEdge && world.state[0] === RunState.Rolling);
  }

  /** A wash of light across the screen, for a moment worth marking. */
  fireFlash(): void {
    this.flash.classList.remove('is-firing');
    void this.flash.offsetWidth;
    this.flash.classList.add('is-firing');
  }

  /** Big words across the middle: GO, or the finish. */
  showBanner(words: string, colour?: string): void {
    this.bannerText.textContent = words;
    this.bannerText.style.color = colour ?? '';
    this.banner.classList.remove('is-firing');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-firing');
  }

  /** Says, briefly, that the ball went over the edge and has been put back. */
  private showNotice(): void {
    clear(this.notice);
    this.notice.append(
      el('div', { class: 'hud-notice-title', text: TEXT.fellOff }),
      el('div', { class: 'hud-notice-line', text: TEXT.fellOffHint }),
    );
    this.notice.classList.remove('is-showing');
    void this.notice.offsetWidth;
    this.notice.classList.add('is-showing');
    window.setTimeout(() => this.notice.classList.remove('is-showing'), 1400);
  }

  /** Puts the countdown back to the start for a fresh attempt. */
  reset(): void {
    this.lastCountdown = -1;
    this.lastFalls = 0;
    this.lastStallSecond = -1;
    this.stall.classList.remove('is-showing');
    this.countdown.textContent = '';
    this.fallsValue.textContent = '';
    this.notice.classList.remove('is-showing');
    this.warning.classList.remove('is-showing');
  }
}
