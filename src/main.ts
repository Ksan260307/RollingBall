/**
 * Wiring.
 *
 * This file owns the loop and decides which screen is in front. It hands the
 * player's controls to the rules, hands the result of the rules to the
 * drawing, and keeps records and settings up to date. It contains no rules
 * of its own.
 */

import './ui/styles.css';
import { ONE } from './core/fixed';
import { measureShape } from './core/ballShape';
import { unpackControls } from './core/input';
import { Session } from './game/session';
import { demoControls } from './game/demoDriver';
import { STAGES, Stage, courseFor } from './game/stages';
import {
  BallDesign,
  Settings,
  clearRecords,
  loadBall,
  loadRecords,
  loadSettings,
  saveBall,
  saveRecord,
  saveSettings,
} from './game/storage';
import { GameView } from './render/view';
import { ControlReader } from './ui/controls';
import { BallEditor } from './ui/editor';
import { Hud } from './ui/hud';
import { Screens, ScreenName } from './ui/screens';
import { button, el } from './ui/dom';
import { TEXT } from './ui/text';

type Mode = 'menu' | 'playing' | 'paused' | 'result' | 'editor';

function main(): void {
  const app = document.getElementById('app');
  if (!app) return;

  const canvas = el('canvas', { class: 'stage-canvas', id: 'stage' }) as HTMLCanvasElement;
  app.append(canvas);

  let view: GameView;
  try {
    view = new GameView(canvas);
  } catch {
    app.append(el('div', { class: 'fatal', text: TEXT.webglMissing }));
    return;
  }

  let settings: Settings = loadSettings();
  let records = loadRecords();
  let design: BallDesign = loadBall();
  let mode: Mode = 'menu';
  let session: Session | null = null;
  let currentStage: Stage = STAGES[0];
  let demo: Session | null = null;

  const controls = new ControlReader(canvas);
  controls.invertPush = settings.invertPush;

  const hud = new Hud();
  const editor = new BallEditor(design);

  const screens = new Screens(
    {
      onPlay: () => {
        screens.setStages(records);
        show('stages');
      },
      onCustomise: () => openEditor(),
      onHowTo: () => show('howto'),
      onSettings: () => show('settings'),
      onChooseStage: (stage) => startRun(stage),
      onBackToTitle: () => show('title'),
      onRetry: () => {
        if (session) {
          session.restart();
          hud.reset();
          beginPlaying();
        }
      },
      onNextStage: () => {
        const index = STAGES.findIndex((s) => s.id === currentStage.id);
        startRun(STAGES[Math.min(STAGES.length - 1, index + 1)]);
      },
      onBackToStages: () => {
        session = null;
        screens.setStages(records);
        show('stages');
        startDemo();
      },
      onResume: () => beginPlaying(),
      onGiveUp: () => {
        session = null;
        screens.setStages(records);
        show('stages');
        startDemo();
      },
      onSettingsChange: (next) => {
        settings = next;
        controls.invertPush = settings.invertPush;
        view.zoom = settings.zoom;
        view.richGraphics = settings.richGraphics;
        saveSettings(settings);
      },
      onClearRecords: () => {
        clearRecords();
        records = loadRecords();
        screens.setStages(records);
      },
    },
    settings,
  );

  controls.onZoom((change) => nudgeZoom(change));

  // Buttons that stay on screen during a run: pause and camera distance.
  const tools = el(
    'div',
    { class: 'hud-tools' },
    button('－', () => nudgeZoom(0.15), 'round'),
    button('＋', () => nudgeZoom(-0.15), 'round'),
    button('II', () => pause(), 'round'),
  );

  const ui = el('div', { class: 'ui' }, screens.root, hud.root, tools, editor.root);
  app.append(ui);

  view.zoom = settings.zoom;
  view.richGraphics = settings.richGraphics;
  void view.setBall(design, measureShape(design.voxels).radius / ONE);
  screens.setStages(records);
  hud.setVisible(false);
  tools.classList.add('is-hidden');

  editor.onClose(() => {
    editor.close();
    editor.root.classList.remove('is-showing');
    canvas.classList.remove('is-hidden');
    mode = 'menu';
    show('title');
    startDemo();
  });
  editor.onSave((next) => {
    design = next;
    saveBall(design);
    void view.setBall(design, measureShape(design.voxels).radius / ONE);
    editor.close();
    editor.root.classList.remove('is-showing');
    canvas.classList.remove('is-hidden');
    mode = 'menu';
    show('title');
    startDemo();
  });

  function show(name: ScreenName): void {
    screens.show(name);
    const playing = name === 'none';
    hud.setVisible(playing);
    tools.classList.toggle('is-hidden', !playing);
    controls.enabled = playing;
    if (!playing) controls.reset();
  }

  function nudgeZoom(change: number): void {
    settings.zoom = Math.min(2, Math.max(0.5, settings.zoom + change));
    view.zoom = settings.zoom;
    saveSettings(settings);
    screens.updateSettings(settings);
  }

  function openEditor(): void {
    mode = 'editor';
    screens.show('none');
    hud.setVisible(false);
    tools.classList.add('is-hidden');
    controls.enabled = false;
    canvas.classList.add('is-hidden');
    editor.root.classList.add('is-showing');
    editor.open(design);
    window.requestAnimationFrame(() => editor.resize());
  }

  function startRun(stage: Stage): void {
    currentStage = stage;
    const course = courseFor(stage);
    view.setStage(stage, course);
    session = new Session({
      stage,
      course,
      ball: measureShape(design.voxels),
      countdownSeconds: 3,
    });
    demo = null;
    view.prepareScenery(session.world);
    hud.reset();
    hud.setBest(records[stage.id]);
    beginPlaying();
  }

  function beginPlaying(): void {
    if (!session) return;
    session.paused = false;
    mode = 'playing';
    show('none');
  }

  function pause(): void {
    if (mode !== 'playing' || !session) return;
    session.paused = true;
    mode = 'paused';
    show('pause');
  }

  /** Rolls a ball down the first course behind the menus. */
  function startDemo(): void {
    const stage = STAGES[0];
    view.setStage(stage, courseFor(stage));
    demo = new Session({
      stage,
      course: courseFor(stage),
      ball: measureShape(design.voxels),
      countdownSeconds: 0,
    });
    view.prepareScenery(demo.world);
    session = null;
  }

  function finishRun(): void {
    if (!session) return;
    const summary = session.summary();
    const isBest = summary.finished && saveRecord(currentStage.id, summary.seconds);
    if (isBest) records = loadRecords();
    screens.setResult(summary, currentStage, records[currentStage.id], isBest);
    mode = 'result';
    show('result');
  }

  window.addEventListener('resize', () => {
    view.resize();
    editor.resize();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (mode === 'playing') pause();
      else if (mode === 'paused') beginPlaying();
    }
    if (event.key === 'r' && (mode === 'playing' || mode === 'paused') && session) {
      session.restart();
      hud.reset();
      beginPlaying();
    }
  });

  let lastTime = performance.now();
  let sceneTime = 0;

  function frame(now: number): void {
    const delta = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    sceneTime += delta;

    if (mode !== 'editor') {
      const active = session ?? demo;
      if (active) {
        if (active === session && mode === 'playing') {
          active.update(delta, controls.read());
          hud.update(active);
          for (const moment of active.world.moments) {
            if (moment.kind === 'collect') {
              view.burst(
                moment.x / ONE,
                moment.y / ONE,
                moment.z / ONE,
                currentStage.mood.edge,
              );
            }
          }
          if (!active.running) finishRun();
        } else if (active === demo) {
          // The title screen rolls a ball down the first course on its own.
          active.update(delta, unpackControls(demoControls(active.world, 0)));
          if (!active.running) startDemo();
        }
        view.render(active.world, active.alpha, active.previous, delta, sceneTime);
      }
    }
    requestAnimationFrame(frame);
  }

  startDemo();
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
