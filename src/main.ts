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
import { Session, type SessionOptions } from './game/session';
import { Playback } from './game/playback';
import { Ghost } from './game/ghost';
import { demoControls } from './game/demoDriver';
import { STAGES, Stage, courseFor } from './game/stages';
import type { Course } from './core/course';
import {
  BallDesign,
  Settings,
  clearGhosts,
  clearRecords,
  loadBall,
  loadGhost,
  saveGhost,
  loadRecords,
  loadSettings,
  saveBall,
  saveRecord,
  saveSettings,
} from './game/storage';
import { Sounds } from './audio/sound';
import { GameView } from './render/view';
import { ControlReader } from './ui/controls';
import { BallEditor } from './ui/editor';
import { Hud } from './ui/hud';
import { Screens, ScreenName } from './ui/screens';
import { button, el } from './ui/dom';
import { TEXT } from './ui/text';

type Mode = 'menu' | 'playing' | 'paused' | 'result' | 'editor' | 'replay';

/** How long a replay holds on the finish before starting over. */
const REPLAY_ENDING = 1.3;

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
  /** True while the finish is being shown, before the results panel. */
  let celebrating = false;
  let currentStage: Stage = STAGES[0];
  let demo: Session | null = null;
  /** The run being watched back, and what it takes to build it again. */
  let playback: Playback | null = null;
  let lastRun: {
    options: SessionOptions;
    controls: number[];
    finished: boolean;
  } | null = null;
  /** Seconds to hold on the end of a replay before it comes round again. */
  let replayHold = 0;
  /** The best run so far on this course, racing alongside. */
  let ghost: Ghost | null = null;

  const controls = new ControlReader(canvas);
  controls.invertPush = settings.invertPush;

  // Browsers stay silent until the player has touched the page, so the sound
  // waits for the first tap or key rather than trying and failing.
  const sounds = new Sounds();
  sounds.setEnabled(settings.sound);
  const wakeSound = (): void => sounds.wake();
  window.addEventListener('pointerdown', wakeSound, { passive: true });
  window.addEventListener('keydown', wakeSound);

  const hud = new Hud();
  hud.onStallTick = (left) => sounds.stallTick(left);
  hud.onCountIn = () => sounds.countIn();
  hud.onGo = () => {
    sounds.goSignal();
    hud.fireFlash();
    hud.showBanner(TEXT.countdownGo);
    if (session) {
      // A ring of sparks around the ball as it is let go.
      const world = session.world;
      for (let n = 0; n < 3; n++) {
        view.burst(world.x[0] / ONE, world.y[0] / ONE + 0.3, world.z[0] / ONE, currentStage.mood.edge, 5);
      }
    }
  };
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
      onBackToTitle: () => {
        session = null;
        show('title');
        startDemo();
      },
      onRetry: () => {
        if (session) {
          session.restart();
          hud.reset();
          // The ball was put away when it went through the finish. Going
          // again brings it back, or there would be nothing to steer.
          view.clearBreakthrough();
          // Going again picks up whatever the best run is now, which may be
          // the one just finished.
          hud.setBest(records[currentStage.id]);
          setUpGhost(currentStage, session.world.course);
          beginPlaying();
        }
      },
      onWatchAgain: () => startReplay(),
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

      onSettingsChange: (next) => {
        settings = next;
        controls.invertPush = settings.invertPush;
        sounds.setEnabled(settings.sound);
        view.zoom = settings.zoom;
        view.richGraphics = settings.richGraphics;
        saveSettings(settings);
      },
      onClearRecords: () => {
        clearRecords();
        // The times and the runs behind them go together.
        clearGhosts();
        ghost = null;
        view.hideGhost();
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

  // The controls that sit over a replay: where from, how fast, and out.
  const replayClock = el('span', { class: 'replay-clock', text: '0.00' });
  const speedButton = button('×1', () => {
    if (!playback) return;
    const speed = playback.nextSpeed();
    speedButton.textContent = `×${speed}`;
  });
  // A flag across the top, so nobody mistakes a replay for their own run.
  const replayFlag = el(
    'div',
    { class: 'replay-flag is-hidden' },
    el('span', { class: 'replay-dot' }),
    el('span', { text: TEXT.replayNow }),
  );
  const replayBar = el(
    'div',
    { class: 'replay-bar is-hidden' },
    el(
      'span',
      { class: 'replay-head' },
      el('span', { class: 'replay-label', text: TEXT.replayTitle }),
      replayClock,
    ),
    button(TEXT.replayAngle, () => playback?.nextAngle()),
    speedButton,
    button(TEXT.replayFromTop, () => {
      view.clearBreakthrough();
      replayHold = 0;
      playback?.restart();
    }),
    button(TEXT.close, () => endReplay(), 'ghost'),
  );

  const ui = el(
    'div',
    { class: 'ui' },
    screens.root,
    hud.root,
    tools,
    replayFlag,
    replayBar,
    editor.root,
  );
  app.append(ui);

  view.zoom = settings.zoom;
  view.richGraphics = settings.richGraphics;
  void view.setBall(design);
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
    void view.setBall(design);
    editor.close();
    editor.root.classList.remove('is-showing');
    canvas.classList.remove('is-hidden');
    mode = 'menu';
    show('title');
    startDemo();
  });

  function show(name: ScreenName): void {
    sounds.click();
    screens.show(name);
    const playing = name === 'none';
    // Leaving the course for any menu stops the ball being heard.
    if (!playing) sounds.quieten();
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
    playback = null;
    replayBar.classList.add('is-hidden');
    replayFlag.classList.add('is-hidden');
    view.clearBreakthrough();
    view.cameraStyle = 'chase';
    const course = courseFor(stage);
    view.setStage(stage, course);
    session = new Session({
      stage,
      course,
      ball: measureShape(design.voxels, design.weightAt),
      countdownSeconds: 3,
    });
    demo = null;
    view.prepareScenery(session.world);
    hud.reset();
    hud.setBest(records[stage.id]);
    setUpGhost(stage, course);
    beginPlaying();
  }

  /**
   * Watches the run that was just made, from wherever the camera fancies.
   *
   * The run is stored as the player's inputs alone, so this is the same
   * attempt over again rather than a recording of it.
   */
  function startReplay(): void {
    if (!lastRun || lastRun.controls.length === 0) return;
    sounds.quieten();
    view.clearBreakthrough();
    view.hideGhost();
    view.setStage(currentStage, lastRun.options.course);
    playback = new Playback(lastRun.options, lastRun.controls);
    replayHold = 0;
    view.prepareScenery(playback.session.world);
    speedButton.textContent = '×1';
    mode = 'replay';
    screens.show('none');
    hud.setVisible(false);
    tools.classList.add('is-hidden');
    controls.enabled = false;
    replayBar.classList.remove('is-hidden');
    replayFlag.classList.remove('is-hidden');
  }

  /** Back to the results, with the replay put away. */
  function endReplay(): void {
    playback = null;
    view.clearBreakthrough();
    // A ball that went through the finish is long gone, so it should not be
    // back on the line spinning away behind the results panel.
    if (lastRun?.finished) view.setBallVisible(false);
    view.cameraStyle = 'chase';
    replayBar.classList.add('is-hidden');
    replayFlag.classList.add('is-hidden');
    sounds.quieten();
    mode = 'result';
    show('result');
  }

  /**
   * Brings out the best run on this course to race against.
   *
   * Nothing here can touch the run in progress: the ghost has a world of
   * its own, fed only by what was done last time.
   */
  function setUpGhost(stage: Stage, course: Course): void {
    ghost = null;
    view.hideGhost();
    hud.setGap(null);
    if (!settings.ghost) return;
    const stored = loadGhost(stage.id);
    if (!stored) return;
    try {
      ghost = new Ghost(
        { stage, course, ball: measureShape(design.voxels, design.weightAt), countdownSeconds: 3 },
        stored,
      );
      void view.setGhostBall(design);
    } catch {
      // A stored run that no longer fits the course is simply not shown.
      ghost = null;
    }
  }

  function beginPlaying(): void {
    if (!session) return;
    session.paused = false;
    mode = 'playing';
    show('none');
  }

  function pause(): void {
    if (mode !== 'playing' || !session) return;
    sounds.quieten();
    session.paused = true;
    mode = 'paused';
    show('pause');
  }

  /** Rolls a ball down the first course behind the menus. */
  function startDemo(): void {
    sounds.quieten();
    ghost = null;
    view.hideGhost();
    hud.setGap(null);
    playback = null;
    replayBar.classList.add('is-hidden');
    replayFlag.classList.add('is-hidden');
    view.clearBreakthrough();
    view.cameraStyle = 'chase';
    const stage = STAGES[0];
    view.setStage(stage, courseFor(stage));
    demo = new Session({
      stage,
      course: courseFor(stage),
      ball: measureShape(design.voxels, design.weightAt),
      countdownSeconds: 0,
    });
    view.prepareScenery(demo.world);
    session = null;
  }

  /**
   * Marks the end of a run, then shows the results a moment later.
   *
   * The pause matters: crossing the line is the thing the player has been
   * working towards, and covering it instantly with a panel throws it away.
   */
  function finishRun(): void {
    if (!session || celebrating) return;
    const summary = session.summary();
    const world = session.world;
    const won = summary.finished;

    // Keep the attempt so it can be watched back from the results screen.
    lastRun = {
      options: {
        stage: currentStage,
        course: courseFor(currentStage),
        ball: measureShape(design.voxels, design.weightAt),
      },
      controls: session.replay(),
      finished: won,
    };

    if (won) {
      hud.fireFlash();
      hud.showBanner(TEXT.finished);
      sounds.quieten();
      // Straight on through the finish and away over the far side.
      view.startBreakthrough(world);
      // Confetti out of the ball, in the colours of the course.
      const colours = [currentStage.mood.edge, currentStage.mood.sky, '#ffffff', '#67e8a0'];
      for (const colour of colours) {
        view.burst(world.x[0] / ONE, world.y[0] / ONE + 0.5, world.z[0] / ONE, colour, 8);
      }
    } else {
      hud.showBanner(TEXT.stuckOver, '#ff7b7b');
      sounds.quieten();
    }

    celebrating = true;
    const isBest = won && saveRecord(currentStage.id, summary.seconds);
    if (isBest) {
      records = loadRecords();
      // The best run is kept as what the player did, ready to be raced.
      saveGhost(currentStage.id, session.replay());
    }
    view.hideGhost();
    hud.setGap(null);
    window.setTimeout(() => {
      celebrating = false;
      // Whatever the effect did or did not manage, a ball that crossed the
      // line is gone by the time the result is up. Nothing should still be
      // rolling about behind the panel.
      if (won) view.setBallVisible(false);
      screens.setResult(summary, currentStage, records[currentStage.id], isBest);
      mode = 'result';
      show('result');
    }, won ? 1600 : 1100);
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

    if (mode === 'replay' && playback) {
      const played = playback.advance(delta);
      view.cameraStyle = playback.angle;
      if (played > 0) {
        // Sitting on the ending replays no steps, so the finish is heard
        // once as it is crossed rather than on every frame afterwards.
        sounds.playMoments(playback.session.world.moments);
        sounds.followBall(playback.session.world);
      } else {
        sounds.quieten();
      }
      replayClock.textContent = playback.seconds.toFixed(2);
      view.render(
        playback.session.world,
        playback.session.alpha,
        playback.session.previous,
        delta,
        sceneTime,
      );
      // Show the ball go through the finish, then come round again while it
      // is still worth watching. Waiting for it to disappear into the
      // distance is a long time to sit looking at an empty course.
      if (playback.finished) {
        if (replayHold <= 0) {
          if (playback.session.outcome === 'finished') {
            view.startBreakthrough(playback.session.world);
          }
          replayHold = REPLAY_ENDING;
        }
        replayHold -= delta;
        if (replayHold <= 0) {
          view.clearBreakthrough();
          playback.restart();
          replayHold = 0;
        }
      }
      requestAnimationFrame(frame);
      return;
    }

    if (mode !== 'editor') {
      const active = session ?? demo;
      if (active) {
        if (active === session && mode === 'playing') {
          const before = active.world.step;
          active.update(delta, controls.read());
          // The ghost takes exactly the steps the live run just took, so the
          // two stay level however the frame rate wanders.
          if (ghost) {
            ghost.advance(active.world.step - before);
            view.showGhost(ghost.world, delta);
            hud.setGap(ghost.gapAt(active.world.travelled[0] / ONE, active.seconds));
          }
          hud.update(active);
          hud.setRush(active.world.speedFor(0) / ONE);
          sounds.playMoments(active.world.moments);
          // The rolling sound belongs to a ball that is still rolling. The
          // run can end several frames before the result panel arrives, and
          // without this the noise carries on into the results and stays.
          if (active.running) sounds.followBall(active.world);
          else sounds.quieten();
          for (const moment of active.world.moments) {
            const mx = moment.x / ONE;
            const my = moment.y / ONE;
            const mz = moment.z / ONE;
            // How hard it was, from nothing to a proper thump.
            const force = Math.min(1, moment.strength / ONE / 3);
            if (moment.kind === 'skid') {
              // A puff of dust where the ball is sliding rather than rolling.
              view.burst(mx, my - 0.3, mz, '#d5dbe8', 2);
            } else if (moment.kind === 'land') {
              view.burst(mx, my - 0.2, mz, '#ffffff', 3 + Math.round(force * 5));
              if (force > 0.25) view.shake(force * 0.7);
            } else if (moment.kind === 'wall') {
              // Sparks off the railing, in the colour of the railing, and a
              // knock to the camera so the hit is felt as well as seen.
              view.burst(mx, my, mz, currentStage.mood.edge, 3 + Math.round(force * 6));
              view.burst(mx, my, mz, '#ffffff', 2);
              view.shake(0.35 + force * 0.65);
            } else if (moment.kind === 'fall') {
              view.burst(mx, my, mz, '#ff7b7b', 6);
              view.shake(0.5);
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
