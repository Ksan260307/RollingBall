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
import { type ShapeStats, measureShape, randomShape } from './core/ballShape';
import { unpackControls } from './core/input';
import { Session, type SessionOptions } from './game/session';
import { Playback } from './game/playback';
import { Ghost } from './game/ghost';
import { Race, type Placing, type Seat } from './game/race';
import { Lobby, WindowTransport, type Player } from './game/lobby';
import { SteamTransport, steamAvailable } from './game/steamTransport';
import { readRecipe, writeRecipe } from './game/recipe';
import { demoControls } from './game/demoDriver';
import { STAGES, Stage, altCourseFor, courseFor, stageFromStored } from './game/stages';
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
import { SharePanel } from './ui/share';
import { recipeFromLink } from './game/recipe';
import { challengeFromLink, challengeLink, readChallenge } from './game/challenge';
import { DAILY_ID, dailyCourse, dayNumber } from './game/daily';
import { Hud } from './ui/hud';
import { Screens, ScreenName } from './ui/screens';
import { button, el } from './ui/dom';
import { TEXT } from './ui/text';

type Mode = 'menu' | 'playing' | 'paused' | 'result' | 'editor' | 'replay' | 'lobby' | 'racing';

/** How many can be on the course at once. */
const FIELD = 4;

/** How long a room waits before it gives up and calls in the robots. */
const HUNT_SECONDS = 20;

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
    seconds: number;
  } | null = null;
  /** Seconds to hold on the end of a replay before it comes round again. */
  let replayHold = 0;
  /** The best run so far on this course, racing alongside. */
  let ghost: Ghost | null = null;
  /**
   * A run somebody else handed over, to be raced instead of your own best.
   *
   * Cleared once it has been used, so going back to a course afterwards
   * puts you back to racing yourself rather than a stranger for ever.
   */
  let challenge: { ball: ShapeStats; controls: number[] } | null = null;
  /** The race everybody is in, and the room it was gathered in. */
  let race: Race | null = null;
  let lobby: Lobby | null = null;
  let huntedFor = 0;
  /** Which seat each rival ball belongs to, in the order they were built. */
  let rivalSeats: number[] = [];

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

  /**
   * Keeping a ball and handing one on.
   *
   * Reading a recipe can fail — it may be a scribble, or something from a
   * newer version — so the answer is always checked before anything on the
   * workbench is disturbed.
   */
  const share = new SharePanel({
    current: () => editor.currentDesign(),
    use: (recipe) => {
      void (async () => {
        const held = await readRecipe(recipe.trim().includes('?ball=')
          ? decodeURIComponent(recipeFromLink(recipe.slice(recipe.indexOf('?'))) ?? '')
          : recipe);
        if (!held) {
          share.say(TEXT.recipeUnreadable);
          return;
        }
        editor.takeRecipe(held);
        share.say(TEXT.recipeLoaded);
      })();
    },
  });
  editor.onShare(() => share.open());

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
        challenge = null;
        endRace();
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
      onTogether: () => openLobby(),
      onLobbyStart: () => beginRace(),
      onLobbyRobots: () => beginRace(true),
      onLobbyLeave: () => leaveLobby(),
      onRaceAgain: () => openLobby(),
      onShareRun: () => void shareRun(),
      onNextStage: () => {
        const index = STAGES.findIndex((s) => s.id === currentStage.id);
        startRun(STAGES[Math.min(STAGES.length - 1, index + 1)]);
      },
      onBackToStages: () => {
        challenge = null;
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
        leanTools.classList.toggle('is-hidden', mode !== 'playing' || !settings.leanButtons);
        if (!settings.leanButtons) controls.leanButton = 0;
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

  /**
   * The two buttons that throw the ball's weight about.
   *
   * Held rather than tapped, so they sit low on either side where a thumb
   * already is and do not fight the drag that steers.
   */
  function leanButton(label: string, way: number): HTMLElement {
    const node = button(label, () => {}, 'round');
    const press = (event: PointerEvent): void => {
      controls.leanButton = way;
      node.classList.add('is-held');
      node.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const release = (): void => {
      if (controls.leanButton === way) controls.leanButton = 0;
      node.classList.remove('is-held');
    };
    node.addEventListener('pointerdown', press);
    node.addEventListener('pointerup', release);
    node.addEventListener('pointercancel', release);
    node.addEventListener('pointerleave', release);
    return node;
  }

  const leanTools = el(
    'div',
    { class: 'lean-tools is-hidden' },
    leanButton('◀', -1),
    el('span', { class: 'lean-label', text: TEXT.leanLabel }),
    leanButton('▶', 1),
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
    share.root,
    screens.root,
    hud.root,
    tools,
    leanTools,
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
  leanTools.classList.add('is-hidden');

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
    void refreshRecipe();
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
    leanTools.classList.toggle('is-hidden', !playing || !settings.leanButtons);
    if (!playing) controls.leanButton = 0;
    controls.enabled = playing;
    if (!playing) controls.reset();
  }

  /**
   * The course a challenge was set on.
   *
   * The one made from the date is rebuilt for the day it was set, so a run
   * from yesterday can still be raced today on the hill it was set on.
   */
  function stageForChallenge(courseId: string, day: number): Stage | null {
    if (courseId === DAILY_ID) return stageFromStored(dailyCourse(day), 99);
    return STAGES.find((stage) => stage.id === courseId) ?? null;
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
    leanTools.classList.add('is-hidden');
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
    view.setStage(stage, course, altCourseFor(stage));
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
    view.setStage(currentStage, lastRun.options.course, altCourseFor(currentStage));
    playback = new Playback(lastRun.options, lastRun.controls);
    replayHold = 0;
    view.prepareScenery(playback.session.world);
    speedButton.textContent = '×1';
    mode = 'replay';
    screens.show('none');
    hud.setVisible(false);
    tools.classList.add('is-hidden');
    leanTools.classList.add('is-hidden');
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
    const taken = challenge;
    if (!taken && !settings.ghost) return;
    const stored = taken ? taken.controls : loadGhost(stage.id);
    if (!stored) return;
    try {
      ghost = new Ghost(
        {
          stage,
          course,
          ball: taken ? taken.ball : measureShape(design.voxels, design.weightAt),
          countdownSeconds: 3,
        },
        stored,
      );
      void view.setGhostBall(design);
    } catch {
      // A stored run that no longer fits the course is simply not shown.
      ghost = null;
    }
  }

  /** Hands the run just finished to somebody else. */
  async function shareRun(): Promise<void> {
    if (!lastRun || lastRun.controls.length === 0) return;
    const link = await challengeLink(
      currentStage.id,
      currentStage.id === DAILY_ID ? dayNumber() : 0,
      lastRun.seconds,
      design,
      lastRun.controls,
      window.location.href,
    );
    share.openRun(link, TEXT.challengeTitle);
  }

  /**
   * Sets up the ghost to race against.
   *
   * A run somebody handed over wins out over your own best: it is the thing
   * you came here to beat, and it is raced with their ball rather than
   * yours, because the same steering given to a different ball goes
   * somewhere else entirely.
   */
  /* ------------------------------------------------------- playing together */

  /**
   * Opens the waiting room and starts looking for somebody.
   *
   * Nobody is made to wait for a stranger who may never come: the robots
   * are always there, the button to start with them is always live, and
   * anybody who turns up in the meantime simply takes a robot's seat.
   */
  function openLobby(): void {
    endRace();
    // Steam where Steam is running, and the browser's own channel between
    // windows everywhere else. Everything above this line is the same
    // either way: the waiting room, the race and the rules never find out
    // which one carried the message.
    const transport = steamAvailable() ? new SteamTransport() : new WindowTransport();
    lobby = new Lobby({
      transport,
      room: 'lobby',
      name: TEXT.raceYou,
      ball: myRecipe,
      most: FIELD,
    });
    // Everybody's ball is worked out as they turn up, so the race can start
    // the moment somebody calls it rather than waiting on the unpacking.
    lobby.onPlayers = (players) => {
      for (const player of players) void learnBall(player);
      showLobby(players);
    };
    lobby.onStart = (order) => startRace(order);
    lobby.onDid = (who, step, packed) => {
      if (!race || !lobby) return;
      const seat = seatOf(who);
      if (seat >= 0) race.hear(seat, step, packed);
    };
    lobby.begin();
    huntedFor = 0;
    mode = 'lobby';
    show('lobby');
    showLobby(lobby.players);
  }

  /** Everybody in the room, in the order they were gathered. */
  let order: Player[] = [];

  /**
   * This player's ball, written down for the others.
   *
   * Kept up to date whenever the ball changes, because everybody in a race
   * has to be rolling what they actually built: the same steering given to
   * a different ball goes somewhere else entirely.
   */
  let myRecipe = '';
  void refreshRecipe();

  async function refreshRecipe(): Promise<void> {
    myRecipe = await writeRecipe(design);
  }

  /** What each player in the room is rolling, once it has been read. */
  const theirBalls = new Map<string, { stats: ShapeStats; design: BallDesign }>();

  /** Reads somebody's ball, so their seat can be filled with the real thing. */
  async function learnBall(player: Player): Promise<void> {
    if (player.ball.length === 0 || theirBalls.has(player.who)) return;
    const held = await readRecipe(player.ball);
    if (!held) return;
    theirBalls.set(player.who, {
      stats: measureShape(held.voxels, held.weightAt),
      design: {
        voxels: held.voxels,
        photo: null,
        photoStrength: 0.85,
        shine: held.shine,
        mixed: held.mixed,
        weightAt: held.weightAt,
      },
    });
  }

  function seatOf(who: string): number {
    return order.findIndex((player) => player.who === who);
  }

  function showLobby(players: Player[]): void {
    if (!lobby) return;
    const names = players.map((player, index) =>
      player.who === lobby?.me ? `${TEXT.raceYou}（${index + 1}）` : `${TEXT.raceFriend}（${index + 1}）`,
    );
    const note = !lobby.usable
      ? TEXT.lobbyNobody
      : players.length > 1
        ? `${TEXT.lobbyCourse}: ${currentStage.name}`
        : steamAvailable()
          ? TEXT.lobbySteam
          : TEXT.lobbyLocal;
    screens.setLobby(names, note, players.length >= 2);
  }

  /** Calls the start, either with whoever turned up or with robots. */
  function beginRace(robotsOnly = false, byItself = false): void {
    if (!lobby) return;
    if (!robotsOnly && lobby.players.length >= 2) {
      // A room that fills up on its own is started by one screen, so that
      // several noticing at the same moment do not all call it. A button is
      // pressed by a person, and whoever presses it does the calling.
      if (byItself && !lobby.callsTheStart) return;
      lobby.callStart(currentStage.id, 0);
      return;
    }
    startRace([{ who: lobby.me, name: TEXT.raceYou, ball: myRecipe }]);
  }

  /** Sets up the race and gets everybody rolling. */
  function startRace(field: Player[]): void {
    if (!lobby) return;
    order = field;
    const mine = measureShape(design.voxels, design.weightAt);
    const seats: Seat[] = [];
    /** The ball drawn for each seat, so rivals look like what they roll. */
    const looks: BallDesign[] = [];
    for (let index = 0; index < FIELD; index++) {
      const player = field[index];
      if (player) {
        const yours = player.who === lobby.me;
        const theirs = theirBalls.get(player.who);
        seats.push({
          kind: yours ? 'you' : 'friend',
          name: yours ? TEXT.raceYou : `${TEXT.raceFriend}${index + 1}`,
          // Their own ball where it has arrived; yours as a stand-in until
          // it does, which is better than an empty course.
          ball: yours ? mine : theirs?.stats ?? mine,
          keenness: 1,
        });
        looks.push(yours ? design : theirs?.design ?? design);
      } else {
        // Empty seats are filled, so a race is always a race. Each robot
        // gets its own ball and its own keenness, or four identical ones
        // would run nose to tail the whole way down.
        const shape = randomShape(1000 + index * 37);
        seats.push({
          kind: 'robot',
          name: `${TEXT.raceRobot}${index}`,
          ball: measureShape(shape),
          keenness: 0.98 - index * 0.06,
        });
        looks.push({
          voxels: shape,
          photo: null,
          photoStrength: 0.85,
          shine: 0.35,
          mixed: [],
          weightAt: { sideways: 0, up: 0 },
        });
      }
    }

    const you = Math.max(0, field.findIndex((player) => player.who === lobby?.me));
    race = new Race({ stage: currentStage, seats, you, countdownSeconds: 3 });
    session = null;
    demo = null;
    ghost = null;
    view.hideGhost();
    view.clearBreakthrough();
    view.setStage(currentStage, courseFor(currentStage), altCourseFor(currentStage));
    view.prepareScenery(race.world);
    view.watching = you;

    // Everybody else's ball, drawn solid beside yours.
    rivalSeats = seats.map((_, seat) => seat).filter((seat) => seat !== you);
    void view.setRivals(rivalSeats.map((seat) => looks[seat]));

    hud.reset();
    hud.setBest(records[currentStage.id]);
    mode = 'racing';
    show('none');
  }

  /** Packs the race away and lets go of the room. */
  function endRace(): void {
    race = null;
    rivalSeats = [];
    view.clearRivals();
    lobby?.end();
    lobby = null;
    order = [];
  }

  function leaveLobby(): void {
    endRace();
    show('title');
    startDemo();
  }

  /** The table at the end. */
  function finishRace(): void {
    if (!race) return;
    const placings: Placing[] = race.placings();
    screens.setRaceResult(
      placings.map((placing) => ({
        name: placing.name,
        you: placing.seat === race?.you,
        finished: placing.finished,
        seconds: placing.seconds,
      })),
    );
    const yours = placings.find((placing) => placing.seat === race?.you);
    if (yours?.finished) saveRecord(currentStage.id, yours.seconds);
    records = loadRecords();
    view.clearRivals();
    race = null;
    mode = 'result';
    show('raceResult');
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
    view.setStage(stage, courseFor(stage), altCourseFor(stage));
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
      seconds: summary.seconds,
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

    if (mode === 'racing' && race) {
      const asked = controls.read();
      hud.showDrag(asked);
      const { sent } = race.update(delta, asked);
      for (const [step, packed] of sent) lobby?.say(step, packed);

      const world = race.world;
      hud.setRush(world.speedFor(race.you) / ONE);
      hud.setWind(world.windNow() / ONE);
      sounds.playMoments(world.moments);
      if (race.running) sounds.followBall(world);
      else sounds.quieten();
      for (const moment of world.moments) {
        if (moment.kind === 'barge') {
          view.burst(moment.x / ONE, moment.y / ONE, moment.z / ONE, '#ffffff', 6);
          view.shake(0.4);
        }
      }
      view.showRivals(world, rivalSeats, delta);
      view.render(world, race.alpha, race.previous[race.you], delta, sceneTime);
      if (!race.running) finishRace();
      requestAnimationFrame(frame);
      return;
    }

    if (mode === 'lobby' && lobby) {
      // Looking for somebody, but never for ever.
      huntedFor += delta;
      if (huntedFor > HUNT_SECONDS && lobby.players.length < 2) beginRace(true);
      else if (lobby.players.length >= 2) beginRace(false, true);
      if (demo) {
        demo.update(delta, unpackControls(demoControls(demo.world, 0)));
        if (!demo.running) startDemo();
        view.render(demo.world, demo.alpha, demo.previous, delta, sceneTime);
      }
      requestAnimationFrame(frame);
      return;
    }

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
          const asked = controls.read();
          hud.showDrag(asked);
          active.update(delta, asked);
          // The ghost takes exactly the steps the live run just took, so the
          // two stay level however the frame rate wanders.
          if (ghost) {
            ghost.advance(active.world.step - before);
            view.showGhost(ghost.world, delta);
            hud.setGap(ghost.gapAt(active.world.travelled[0] / ONE, active.seconds));
          }
          hud.update(active);
          hud.setRush(active.world.speedFor(0) / ONE);
          hud.setWind(active.world.windNow() / ONE);
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

  // A run handed over by address: straight onto that course, racing it.
  const thrown = challengeFromLink(window.location.search);
  if (thrown) {
    void (async () => {
      const held = await readChallenge(decodeURIComponent(thrown));
      if (!held) return;
      const stage = stageForChallenge(held.courseId, held.day);
      if (!stage) return;
      challenge = {
        ball: measureShape(held.ball.voxels, held.ball.weightAt),
        controls: held.controls,
      };
      window.history.replaceState(null, '', window.location.pathname);
      startRun(stage);
    })();
  }

  // A ball handed over by address: open the workbench with it already there
  // rather than quietly replacing whatever the player had made.
  const handed = recipeFromLink(window.location.search);
  if (handed) {
    void (async () => {
      const held = await readRecipe(decodeURIComponent(handed));
      if (!held) return;
      openEditor();
      editor.takeRecipe(held);
      // Take it out of the address, so a reload does not do this again.
      window.history.replaceState(null, '', window.location.pathname);
    })();
  }

  startDemo();
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
