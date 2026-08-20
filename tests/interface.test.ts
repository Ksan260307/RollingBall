// @vitest-environment jsdom

/**
 * The parts of the game the player touches: the wording, the menus, the
 * on-screen readout, the control reading, and what gets kept between visits.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ONE } from '../src/core/fixed';
import { defaultShape, measureShape, shapeToText } from '../src/core/ballShape';
import { Session } from '../src/game/session';
import { STAGES, courseFor } from '../src/game/stages';
import {
  clearRecords,
  defaultBall,
  defaultSettings,
  loadBall,
  loadRecords,
  loadSettings,
  saveBall,
  saveRecord,
  saveSettings,
} from '../src/game/storage';
import { ControlReader } from '../src/ui/controls';
import { Hud } from '../src/ui/hud';
import { Screens } from '../src/ui/screens';
import { TEXT, difficultyDots, formatSpeed, formatTime } from '../src/ui/text';
import { button, clear, el, slider, toggle } from '../src/ui/dom';

describe('the words on screen', () => {
  it('shows times as a clock reading', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(9.5)).toBe('0:09.50');
    expect(formatTime(83.25)).toBe('1:23.25');
    expect(formatTime(-1)).toBe('--:--.--');
    expect(formatTime(Number.NaN)).toBe('--:--.--');
  });

  it('shows speed in the units people use for it', () => {
    expect(formatSpeed(0)).toBe('0 km/h');
    expect(formatSpeed(10)).toBe('36 km/h');
  });

  it('shows difficulty as filled and empty dots', () => {
    expect(difficultyDots(1)).toBe('●○○');
    expect(difficultyDots(3)).toBe('●●●');
    expect(difficultyDots(99)).toBe('●●●');
  });

  it('never puts a piece of workshop jargon in front of the player', () => {
    // The design this game is built on uses a private vocabulary. None of it
    // belongs on screen, so this checks the whole word list at once.
    const jargon = [
      'tick',
      'seed',
      'checksum',
      'hash',
      'buffer',
      'shader',
      'entropy',
      'lod',
      'cull',
      'deterministic',
      'rollback',
      'quantis',
      'fixed-point',
      'モートン',
      'ハッシュ',
      'シード',
      'ティック',
      'バッファ',
      'シェーダ',
      'エントロピー',
      'カリング',
      'ロールバック',
      'リスポーン',
      '決定論',
      '固定小数点',
      '状態遷移',
    ];
    const everything = JSON.stringify(TEXT).toLowerCase();
    for (const word of jargon) {
      expect(everything).not.toContain(word.toLowerCase());
    }
  });

  it('gives every course a name a child could read', () => {
    // The description is optional: a course made in the editor may not have
    // one yet, and an empty line should not stop the game listing it.
    for (const stage of STAGES) {
      expect(stage.name.trim().length).toBeGreaterThan(1);
    }
  });
});

describe('building the menus', () => {
  it('makes elements with text, classes and listeners', () => {
    let clicked = 0;
    const node = el('div', { class: 'x', text: 'hello', on: { click: () => clicked++ } });
    expect(node.className).toBe('x');
    expect(node.textContent).toBe('hello');
    node.dispatchEvent(new Event('click'));
    expect(clicked).toBe(1);
  });

  it('skips children that are not there', () => {
    const node = el('div', {}, 'a', null, false, undefined, 'b');
    expect(node.childNodes.length).toBe(2);
  });

  it('makes buttons, sliders and switches that report changes', () => {
    let pressed = 0;
    const b = button('go', () => pressed++);
    b.dispatchEvent(new Event('click'));
    expect(pressed).toBe(1);

    let value = 0;
    const s = slider('zoom', 0, 10, 1, 5, (v) => (value = v));
    const input = s.querySelector('input') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    expect(value).toBe(7);

    let flag = false;
    const t = toggle('sound', false, (v) => (flag = v));
    const box = t.querySelector('input') as HTMLInputElement;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(flag).toBe(true);
  });

  it('empties an element completely', () => {
    const node = el('div', {}, 'a', el('span', { text: 'b' }));
    clear(node);
    expect(node.childNodes.length).toBe(0);
  });
});

function makeScreens(overrides: Record<string, unknown> = {}): Screens {
  const noop = (): void => {};
  return new Screens(
    {
      onPlay: noop,
      onCustomise: noop,
      onHowTo: noop,
      onSettings: noop,
      onChooseStage: noop,
      onBackToTitle: noop,
      onRetry: noop,
      onNextStage: noop,
      onBackToStages: noop,
      onResume: noop,
      onGiveUp: noop,
      onSettingsChange: noop,
      onClearRecords: noop,
      ...overrides,
    } as never,
    defaultSettings(),
  );
}

describe('the screens', () => {
  it('starts on the title', () => {
    const screens = makeScreens();
    expect(screens.showing).toBe('title');
    expect(screens.root.querySelectorAll('.screen.is-showing')).toHaveLength(1);
  });

  it('shows one screen at a time', () => {
    const screens = makeScreens();
    screens.show('stages');
    expect(screens.showing).toBe('stages');
    expect(screens.root.querySelectorAll('.screen.is-showing')).toHaveLength(1);
    screens.show('none');
    expect(screens.root.querySelectorAll('.screen.is-showing')).toHaveLength(0);
  });

  it('lists every course, with its best time', () => {
    const screens = makeScreens();
    screens.setStages({ meadow: 21.5 });
    const cards = screens.root.querySelectorAll('.stage-card');
    expect(cards).toHaveLength(STAGES.length);
    expect(cards[0].textContent).toContain(STAGES[0].name);
    expect(cards[0].textContent).toContain('0:21.50');
    expect(cards[1].textContent).toContain(TEXT.noRecord);
  });

  it('passes on which course was chosen', () => {
    const chosen: string[] = [];
    const screens = makeScreens({ onChooseStage: (stage: { id: string }) => chosen.push(stage.id) });
    screens.setStages({});
    (screens.root.querySelectorAll('.stage-card')[2] as HTMLElement).click();
    expect(chosen).toEqual([STAGES[2].id]);
  });

  it('shows a finished run with its time', () => {
    const screens = makeScreens();
    screens.setResult(
      {
        stageId: 'meadow',
        seconds: 18.25,
        metres: 102,
        topSpeed: 12.5,
        falls: 2,
        finished: true,
        checksum: 1,
      },
      STAGES[0],
      18.25,
      true,
    );
    const text = screens.root.textContent ?? '';
    expect(text).toContain(TEXT.finished);
    expect(text).toContain('0:18.25');
    expect(text).toContain(TEXT.newRecord);
    expect(text).toContain('45 km/h');
    expect(text).toContain(TEXT.falls);
    expect(text).toContain(TEXT.backToTitle);
  });

  it('leaves the new-best flag off when the time was not a best', () => {
    const screens = makeScreens();
    screens.setResult(
      {
        stageId: 'skyway',
        seconds: 26,
        metres: 110,
        topSpeed: 9,
        falls: 0,
        finished: true,
        checksum: 1,
      },
      STAGES[2],
      20,
      false,
    );
    const text = screens.root.textContent ?? '';
    expect(text).toContain(TEXT.finished);
    expect(text).not.toContain(TEXT.newRecord);
  });

  it('offers the next course only when there is one after it', () => {
    const screens = makeScreens();
    const summary = {
      stageId: STAGES[STAGES.length - 1].id,
      seconds: 20,
      metres: 110,
      topSpeed: 12,
      falls: 0,
      finished: true,
      checksum: 1,
    };
    screens.setResult(summary, STAGES[STAGES.length - 1], 20, false);
    expect(screens.root.textContent).not.toContain(TEXT.nextStage);
    screens.setResult({ ...summary, stageId: 'meadow' }, STAGES[0], 20, false);
    expect(screens.root.textContent).toContain(TEXT.nextStage);
  });
});

describe('the readout during a run', () => {
  it('shows the clock and the speed, and nothing else in the way', () => {
    const hud = new Hud();
    const stage = STAGES[0];
    const session = new Session({
      stage,
      course: courseFor(stage),
      ball: measureShape(defaultShape()),
      countdownSeconds: 0,
    });
    for (let i = 0; i < 200; i++) session.update(1 / 120, { steer: 0, push: 0, buttons: 0 });
    hud.update(session);
    expect(hud.root.querySelector('.hud-time')?.textContent).not.toBe('0:00.00');
    expect(hud.root.querySelector('.hud-speed')?.textContent).toMatch(/km\/h$/);
    // The bars across the top were taking the eye off the ball, so they went.
    expect(hud.root.querySelector('.hud-progress')).toBeNull();
    expect(hud.root.querySelector('.hud-mood')).toBeNull();
    expect(hud.root.querySelector('.hud-lights')).toBeNull();
  });

  it('shows the best time, or says there is not one yet', () => {
    const hud = new Hud();
    hud.setBest(undefined);
    expect(hud.root.querySelector('.hud-best')?.textContent).toContain(TEXT.noRecord);
    hud.setBest(12.5);
    expect(hud.root.querySelector('.hud-best')?.textContent).toContain('0:12.50');
  });

  it('can be hidden and brought back', () => {
    const hud = new Hud();
    hud.setVisible(false);
    expect(hud.root.classList.contains('is-hidden')).toBe(true);
    hud.setVisible(true);
    expect(hud.root.classList.contains('is-hidden')).toBe(false);
  });
});

describe('reading the controls', () => {
  function drag(element: HTMLElement, dx: number, dy: number): void {
    element.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, clientX: 200, clientY: 200 }),
    );
    element.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 200 + dx, clientY: 200 + dy }),
    );
  }

  it('turns a drag to the right into steering to the right', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    drag(element, 200, 0);
    const reading = reader.read();
    expect(reading.steer).toBe(ONE);
    expect(reading.active).toBe(true);
    reader.dispose();
  });

  it('turns a drag upwards into a push forward', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    drag(element, 0, -200);
    expect(reader.read().push).toBe(ONE);
    reader.dispose();
  });

  it('swaps up and down when the player asks for it', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    reader.invertPush = true;
    drag(element, 0, -200);
    expect(reader.read().push).toBe(-ONE);
    reader.dispose();
  });

  it('reports nothing once the finger is lifted', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    drag(element, 200, 0);
    element.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
    const reading = reader.read();
    expect(reading.steer).toBe(0);
    expect(reading.active).toBe(false);
    reader.dispose();
  });

  it('reads the keyboard as well', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(reader.read().steer).toBe(-ONE);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    expect(reader.read().steer).toBe(ONE);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd' }));
    reader.dispose();
  });

  it('ignores everything while a menu is open', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    reader.enabled = false;
    drag(element, 200, 0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    expect(reader.read().steer).toBe(0);
    reader.dispose();
  });

  it('lets a second finger change the camera distance instead of steering', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    const changes: number[] = [];
    reader.onZoom((change) => changes.push(change));
    element.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }),
    );
    element.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 2, clientX: 200, clientY: 100 }),
    );
    element.dispatchEvent(
      new PointerEvent('pointermove', { pointerId: 2, clientX: 300, clientY: 100 }),
    );
    expect(changes.length).toBeGreaterThan(0);
    expect(reader.read().steer).toBe(0);
    reader.dispose();
  });

  it('never asks for more than the ball can be pushed', () => {
    const element = document.createElement('div');
    const reader = new ControlReader(element);
    drag(element, 5000, -5000);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    const reading = reader.read();
    expect(reading.steer).toBeLessThanOrEqual(ONE);
    expect(reading.push).toBeLessThanOrEqual(ONE);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }));
    reader.dispose();
  });
});

describe('what is kept between visits', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with no records at all', () => {
    expect(loadRecords()).toEqual({});
  });

  it('keeps a time, and only replaces it with a faster one', () => {
    expect(saveRecord('meadow', 30)).toBe(true);
    expect(loadRecords().meadow).toBe(30);
    expect(saveRecord('meadow', 35)).toBe(false);
    expect(loadRecords().meadow).toBe(30);
    expect(saveRecord('meadow', 25)).toBe(true);
    expect(loadRecords().meadow).toBe(25);
  });

  it('forgets the records when asked', () => {
    saveRecord('meadow', 20);
    clearRecords();
    expect(loadRecords()).toEqual({});
  });

  it('ignores nonsense left behind in storage', () => {
    window.localStorage.setItem('rollingball.records.v1', 'not json at all');
    expect(loadRecords()).toEqual({});
    window.localStorage.setItem('rollingball.records.v1', '{"meadow":"fast"}');
    expect(loadRecords()).toEqual({});
  });

  it('keeps the ball the player built', () => {
    const design = defaultBall();
    design.voxels[0] = 3;
    design.shine = 0.9;
    saveBall(design);
    const loaded = loadBall();
    expect(shapeToText(loaded.voxels)).toBe(shapeToText(design.voxels));
    expect(loaded.shine).toBeCloseTo(0.9, 5);
  });

  it('falls back to the standard ball when the saved one is unusable', () => {
    window.localStorage.setItem('rollingball.ball.v1', '{"shape":"729:0"}');
    const loaded = loadBall();
    expect(shapeToText(loaded.voxels)).toBe(shapeToText(defaultShape()));
  });

  it('keeps the settings, within sensible limits', () => {
    saveSettings({ zoom: 99, richGraphics: false, sound: false, invertPush: true, ghost: true, leanButtons: false });
    const loaded = loadSettings();
    expect(loaded.zoom).toBeLessThanOrEqual(2);
    expect(loaded.richGraphics).toBe(false);
    expect(loaded.invertPush).toBe(true);
  });

  it('carries on quietly when storage is not allowed at all', () => {
    const failing = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is switched off');
    });
    expect(() => saveRecord('meadow', 10)).not.toThrow();
    expect(() => saveSettings(defaultSettings())).not.toThrow();
    failing.mockRestore();
  });
});
