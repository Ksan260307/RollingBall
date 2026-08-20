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
  /** The glow at the edges of the screen when moving fast. */
  private readonly rush = el('div', { class: 'speed-rush' });
  /** Which way the wind is blowing, and how hard. */
  private readonly windArrow = el('span', { class: 'wind-arrow' });
  private readonly wind = el(
    'div',
    { class: 'hud-wind is-hidden' },
    this.windArrow,
    el('span', { class: 'wind-word', text: TEXT.windLabel }),
  );

  /** How far ahead of, or behind, the best run so far. */
  private readonly gap = el('div', { class: 'hud-gap is-hidden' });
  /** The arrow under the finger, showing which way the ball is being sent. */
  private readonly dragShaft = el('div', { class: 'drag-shaft' });
  private readonly dragArrow = el('div', { class: 'drag-arrow' }, this.dragShaft);
  private readonly dragGuide = el('div', { class: 'drag-guide is-hidden' }, this.dragArrow);
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
      this.rush,
      this.dragGuide,
      this.wind,
      this.gap,
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
  /**
   * Shows which way the wind is blowing and how hard.
   *
   * Being blown off a course by something invisible is the sort of thing
   * that reads as the game cheating. An arrow that leans over as the gust
   * comes up turns it into something to play against.
   *
   * @param blowing which way and how hard, from -1 (left) to 1 (right)
   */
  setWind(blowing: number): void {
    const force = Math.abs(blowing);
    if (force < 0.06) {
      this.wind.classList.add('is-hidden');
      return;
    }
    this.wind.classList.remove('is-hidden');
    this.windArrow.textContent = blowing > 0 ? '▶' : '◀';
    // Grows and brightens with the gust, so a lull is plain too.
    this.windArrow.style.transform = `scaleX(${(0.6 + force * 0.9).toFixed(2)})`;
    this.wind.style.opacity = String(0.45 + force * 0.55);
    this.wind.classList.toggle('is-strong', force > 0.6);
  }

  /**
   * Draws the arrow under the finger.
   *
   * It starts where the drag started and points where the finger has gone,
   * which is exactly what the ball is being told to do. It stops growing at
   * a full push and lights up there, so the limit shows without anything
   * else having to be drawn.
   *
   * @param reading what the player is doing, straight from the controls
   */
  showDrag(reading: {
    active: boolean;
    reach: number;
    originX: number;
    originY: number;
    currentX: number;
    currentY: number;
  }): void {
    if (!reading.active) {
      this.dragGuide.classList.add('is-hidden');
      return;
    }
    const dx = reading.currentX - reading.originX;
    const dy = reading.currentY - reading.originY;
    const away = Math.sqrt(dx * dx + dy * dy);

    this.dragGuide.style.left = `${reading.originX}px`;
    this.dragGuide.style.top = `${reading.originY}px`;

    // Below the point where it starts to do anything there is nothing to
    // point at, so the arrow waits rather than spinning about wildly.
    if (away < 10) {
      this.dragArrow.classList.add('is-waiting');
      return;
    }
    this.dragArrow.classList.remove('is-waiting');
    const shown = Math.min(away, reading.reach);
    this.dragArrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    this.dragShaft.style.width = `${shown}px`;
    // Full deflection lights it up, so the limit can be felt as well as seen.
    this.dragGuide.classList.toggle('is-full', away >= reading.reach - 1);
    this.dragGuide.classList.remove('is-hidden');
  }

  /**
   * Shows how the run compares with the best one so far.
   *
   * Read as a clock reads: a plus is time you have lost. It only appears
   * once there is something to say, so it never sits there at zero being
   * ignored.
   *
   * @param seconds behind (positive) or ahead (negative), or null for nothing
   */
  setGap(seconds: number | null): void {
    if (seconds === null) {
      this.gap.classList.add('is-hidden');
      return;
    }
    const behind = seconds > 0;
    const shown = Math.abs(seconds);
    this.gap.textContent = `${behind ? '+' : '−'}${shown.toFixed(2)}`;
    this.gap.classList.toggle('is-behind', behind);
    this.gap.classList.toggle('is-ahead', !behind);
    this.gap.classList.remove('is-hidden');
  }

  /**
   * Brightens the edges of the screen the faster the ball is going.
   *
   * Speed is hard to feel in a game where the camera keeps the ball in the
   * same place on screen. This gives the eye something that changes with it.
   */
  setRush(speed: number): void {
    // Six metres a second is a good roll; twelve is about as fast as it goes.
    const amount = Math.min(1, Math.max(0, (speed - 6) / 6));
    this.rush.style.opacity = String(amount);
  }

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
    this.gap.classList.add('is-hidden');
    this.wind.classList.add('is-hidden');
    this.dragGuide.classList.add('is-hidden');
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
