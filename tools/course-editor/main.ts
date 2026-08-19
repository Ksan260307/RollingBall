/**
 * The course editor. A workshop tool, not part of the game.
 *
 * It edits the very same file the game reads (src/game/courses.json), shows
 * the course being built in three dimensions as you change it, and can run
 * the game's own robot driver down it to check the course is finishable and
 * how long it takes. Saving writes the file through the development server,
 * so a course goes from edited to playable without anything being copied by
 * hand.
 *
 * Nothing here ships: it is served only while the development server runs,
 * and the build takes the game's index.html alone.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildCourse } from '../../src/core/course';
import { toNumber } from '../../src/core/fixed';
import { defaultShape, measureShape } from '../../src/core/ballShape';
import { RunState, STEPS_PER_SECOND, World } from '../../src/core/simulation';
import { demoControls } from '../../src/game/demoDriver';
import {
  COURSE_DEFAULTS,
  SURFACE_NAMES,
  type StoredCourse,
  type SurfaceName,
  pieceFromStored,
  stageFromStored,
} from '../../src/game/stages';
import { buildCourseMesh, disposeCourseMesh } from '../../src/render/courseMesh';
import { button, clear, el } from '../../src/ui/dom';

/** Where the courses are read from and written back to. */
const COURSE_URL = '/src/game/courses.json';
const SAVE_URL = '/__courses';

/** How long the robot driver is given before a course counts as unfinishable. */
const TEST_LIMIT_SECONDS = 180;

interface EditorState {
  courses: StoredCourse[];
  current: number;
  chosenPiece: number;
}

const state: EditorState = { courses: [], current: 0, chosenPiece: -1 };

const app = document.getElementById('app') as HTMLElement;
let sidePane: HTMLElement;
let readout: HTMLElement;
let noticeLine: HTMLElement;

/* ------------------------------------------------------------- the view */

const scene = new Scene();
const camera = new PerspectiveCamera(50, 1, 0.5, 4000);
let renderer: WebGLRenderer | null = null;
let viewCanvas: HTMLCanvasElement;
let courseMesh: Group | null = null;
let startMarker: Mesh | null = null;
const focus = new Vector3();
let orbit = 0.7;
let tilt = 0.75;
let distance = 160;

function setUpScene(): void {
  scene.background = new Color('#0d1120');
  scene.add(new AmbientLight(0xffffff, 0.7));
  scene.add(new HemisphereLight(0xdfe9ff, 0x2a3358, 1.1));
  const sun = new DirectionalLight(0xffffff, 1.5);
  sun.position.set(80, 220, 60);
  scene.add(sun);

  startMarker = new Mesh(
    new SphereGeometry(0.5, 16, 12),
    new MeshBasicMaterial({ color: '#ffd166' }),
  );
  scene.add(startMarker);
}

function sizeView(): void {
  if (!renderer) return;
  const width = Math.max(1, Math.round(viewCanvas.clientWidth));
  const height = Math.max(1, Math.round(viewCanvas.clientHeight));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function drawFrame(): void {
  if (!renderer) return;
  sizeView();
  const x = focus.x + Math.sin(orbit) * Math.cos(tilt) * distance;
  const y = focus.y + Math.sin(tilt) * distance;
  const z = focus.z + Math.cos(orbit) * Math.cos(tilt) * distance;
  camera.position.set(x, y, z);
  camera.lookAt(focus);
  renderer.render(scene, camera);
  requestAnimationFrame(drawFrame);
}

function attachViewControls(): void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  viewCanvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    viewCanvas.setPointerCapture(event.pointerId);
  });
  viewCanvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    orbit -= (event.clientX - lastX) * 0.006;
    tilt = Math.min(1.45, Math.max(0.05, tilt + (event.clientY - lastY) * 0.005));
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const stop = (): void => {
    dragging = false;
  };
  viewCanvas.addEventListener('pointerup', stop);
  viewCanvas.addEventListener('pointercancel', stop);
  viewCanvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      distance = Math.min(1200, Math.max(12, distance * (1 + event.deltaY * 0.0012)));
    },
    { passive: false },
  );
}

/* ------------------------------------------------------- course handling */

function currentCourse(): StoredCourse {
  return state.courses[state.current];
}

/** Rebuilds the three-dimensional preview from the course being edited. */
function refreshPreview(): void {
  const stage = stageFromStored(currentCourse(), state.current);
  const course = buildCourse(stage.pieces, 0);

  if (courseMesh) {
    scene.remove(courseMesh);
    disposeCourseMesh(courseMesh);
  }
  courseMesh = buildCourseMesh(course, {
    floor: stage.mood.floor,
    edge: stage.mood.edge,
    ground: stage.mood.ground,
  });
  scene.add(courseMesh);

  if (startMarker) {
    startMarker.position.set(
      toNumber(course.startX),
      toNumber(course.startY) + 1,
      toNumber(course.startZ),
    );
  }

  // Frame the whole thing, so a course of any length arrives on screen.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < course.count; i++) {
    minX = Math.min(minX, toNumber(course.x[i]));
    maxX = Math.max(maxX, toNumber(course.x[i]));
    minY = Math.min(minY, toNumber(course.y[i]));
    maxY = Math.max(maxY, toNumber(course.y[i]));
    minZ = Math.min(minZ, toNumber(course.z[i]));
    maxZ = Math.max(maxZ, toNumber(course.z[i]));
  }
  focus.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 10);
  distance = span * 1.5;

  const metres = toNumber(course.totalLength);
  const descent = toNumber(course.descent);
  readout.textContent = [
    `ながさ   ${metres.toFixed(1)} m`,
    `高低差   ${descent.toFixed(1)} m`,
    `平均勾配 ${((Math.asin(Math.min(1, descent / Math.max(1, metres))) * 180) / Math.PI).toFixed(1)}°`,
    `つなぎ目 ${currentCourse().pieces.length} 個`,
    `点の数   ${course.count}`,
  ].join('\n');
}

/** Runs the game's robot driver down the course and reports what happened. */
function testRun(): void {
  const stage = stageFromStored(currentCourse(), state.current);
  const world = new World({
    course: buildCourse(stage.pieces, 0),
    seed: stage.seed,
    ball: measureShape(defaultShape()),
    breeze: stage.breeze,
    countdownSeconds: 0,
  });

  let steps = 0;
  const limit = TEST_LIMIT_SECONDS * STEPS_PER_SECOND;
  while (world.state[0] === RunState.Rolling && steps < limit) {
    world.advance([demoControls(world, 0)]);
    steps++;
  }

  const seconds = world.secondsFor(0);
  const metres = toNumber(world.travelled[0]);
  const falls = world.falls[0];
  if (world.state[0] === RunState.Finished) {
    say(
      `完走 ${seconds.toFixed(2)} 秒 / ${metres.toFixed(1)} m` +
        (falls > 0 ? `（落下 ${falls} 回）` : '（落下なし）') +
        `。めやすタイムは ${stage.targetSeconds} 秒です。`,
      'good',
    );
  } else {
    say(
      `完走できませんでした。${seconds.toFixed(1)} 秒で ${metres.toFixed(1)} m 地点、落下 ${falls} 回。` +
        'まっすぐ走るだけで抜けられる作りか見なおしてください。',
      'bad',
    );
  }
}

function say(message: string, tone: '' | 'good' | 'bad' = ''): void {
  noticeLine.className = `note ${tone}`.trim();
  noticeLine.textContent = message;
}

/* ------------------------------------------------------------- the panel */

function numberField(
  label: string,
  value: number,
  step: number,
  onChange: (value: number) => void,
): HTMLElement {
  const input = el('input', {
    attrs: { type: 'number', step: String(step), value: String(value) },
    on: {
      change: (event) => {
        const next = Number((event.target as HTMLInputElement).value);
        if (Number.isFinite(next)) onChange(next);
      },
    },
  });
  return el('label', {}, el('span', { text: label }), input);
}

function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const input = el('input', {
    attrs: { type: 'text', value },
    on: { change: (event) => onChange((event.target as HTMLInputElement).value) },
  });
  return el('label', {}, el('span', { text: label }), input);
}

function colourField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  const input = el('input', {
    attrs: { type: 'color', value },
    on: { input: (event) => onChange((event.target as HTMLInputElement).value) },
  });
  return el('label', {}, el('span', { text: label }), input);
}

function renderTabs(): HTMLElement {
  const tabs = el('div', { class: 'tabs' });
  state.courses.forEach((course, index) => {
    const tab = button(
      `${index + 1}. ${course.name || course.id}`,
      () => {
        state.current = index;
        state.chosenPiece = -1;
        renderAll();
      },
      index === state.current ? 'on' : '',
    );
    tabs.append(tab);
  });
  return tabs;
}

function renderCourseFields(): HTMLElement {
  const course = currentCourse();
  const holder = el('div', {});
  holder.append(
    el('h2', { text: 'コース' }),
    el(
      'div',
      { class: 'grid2' },
      textField('よび名（id）', course.id, (value) => {
        course.id = value;
        renderAll();
      }),
      textField('なまえ', course.name, (value) => {
        course.name = value;
        renderAll();
      }),
    ),
    textField('せつめい', course.blurb, (value) => {
      course.blurb = value;
    }),
    el(
      'div',
      { class: 'grid3' },
      numberField('むずかしさ 1-3', course.difficulty, 1, (value) => {
        course.difficulty = Math.min(3, Math.max(1, Math.round(value)));
        refreshPreview();
      }),
      numberField('めやすタイム（秒）', course.targetSeconds, 1, (value) => {
        course.targetSeconds = value;
      }),
      numberField('横風 0-1', course.breeze, 0.05, (value) => {
        course.breeze = Math.min(1, Math.max(0, value));
      }),
    ),
    numberField('景色の種（同じ数なら同じ並び）', course.seed, 1, (value) => {
      course.seed = Math.max(0, Math.round(value));
    }),
    el('h2', { text: 'いろ' }),
    el(
      'div',
      { class: 'grid3' },
      colourField('空', course.mood.sky, (value) => {
        course.mood.sky = value;
        refreshPreview();
      }),
      colourField('地平', course.mood.horizon, (value) => {
        course.mood.horizon = value;
      }),
      colourField('地面', course.mood.ground, (value) => {
        course.mood.ground = value;
        refreshPreview();
      }),
      colourField('床', course.mood.floor, (value) => {
        course.mood.floor = value;
        refreshPreview();
      }),
      colourField('ふち', course.mood.edge, (value) => {
        course.mood.edge = value;
        refreshPreview();
      }),
      numberField('かすみ', course.mood.fog, 10, (value) => {
        course.mood.fog = value;
      }),
    ),
  );
  return holder;
}

/** How far along the course each stretch begins, for the list headings. */
function pieceStarts(course: StoredCourse): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const piece of course.pieces) {
    starts.push(at);
    at += pieceFromStored(piece).length;
  }
  return starts;
}

function renderPieces(): HTMLElement {
  const course = currentCourse();
  const starts = pieceStarts(course);
  const holder = el('div', {});
  holder.append(
    el('h2', { text: 'コースのつなぎ' }),
    el(
      'div',
      { class: 'tabs' },
      button('うしろに足す', () => {
        course.pieces.push({ ...COURSE_DEFAULTS.piece, walls: true });
        state.chosenPiece = course.pieces.length - 1;
        renderAll();
      }),
      button('えらんだ次に足す', () => {
        const at = state.chosenPiece >= 0 ? state.chosenPiece + 1 : course.pieces.length;
        course.pieces.splice(at, 0, { ...COURSE_DEFAULTS.piece, walls: true });
        state.chosenPiece = at;
        renderAll();
      }),
    ),
  );

  const list = el('div', { class: 'pieces' });
  course.pieces.forEach((piece, index) => {
    const row = el('div', {
      class: `piece${index === state.chosenPiece ? ' on' : ''}`,
      on: { pointerdown: () => {
        state.chosenPiece = index;
        renderAll();
      } },
    });

    const surfaceSelect = el('select', {
      on: {
        change: (event) => {
          piece.surface = (event.target as HTMLSelectElement).value as SurfaceName;
          refreshPreview();
        },
      },
    });
    const labels: Record<SurfaceName, string> = {
      normal: 'ふつう',
      slick: 'すべる',
      rough: 'あらい',
      boost: '加速',
    };
    for (const name of SURFACE_NAMES) {
      const option = el('option', { text: labels[name], attrs: { value: name } });
      if ((piece.surface ?? 'normal') === name) option.setAttribute('selected', 'selected');
      surfaceSelect.append(option);
    }

    row.append(
      el(
        'div',
        { class: 'piece-head' },
        el('span', { class: 'piece-no', text: String(index + 1) }),
        el('span', { class: 'piece-at', text: `${starts[index].toFixed(0)} m 地点から` }),
        button('↑', () => movePiece(index, -1), 'tiny'),
        button('↓', () => movePiece(index, 1), 'tiny'),
        button('複製', () => {
          course.pieces.splice(index + 1, 0, { ...piece });
          state.chosenPiece = index + 1;
          renderAll();
        }, 'tiny'),
        button('削除', () => {
          if (course.pieces.length <= 1) {
            say('コースには つなぎが ひとつ以上 必要です。', 'bad');
            return;
          }
          course.pieces.splice(index, 1);
          state.chosenPiece = -1;
          renderAll();
        }, 'tiny danger'),
      ),
      el(
        'div',
        { class: 'piece-fields' },
        numberField('長さ m', piece.length ?? 10, 1, (value) => {
          piece.length = value;
          renderAll();
        }),
        numberField('曲がり °', piece.turn ?? 0, 1, (value) => {
          piece.turn = value;
          refreshPreview();
        }),
        numberField('下り °', piece.drop ?? 0, 1, (value) => {
          piece.drop = value;
          refreshPreview();
        }),
        numberField('幅 m', piece.width ?? 8, 0.5, (value) => {
          piece.width = value;
          refreshPreview();
        }),
        numberField('傾き °', piece.bank ?? 0, 1, (value) => {
          piece.bank = value;
          refreshPreview();
        }),
      ),
      el(
        'div',
        { class: 'piece-flags' },
        el('label', {}, el('span', { text: '床' }), surfaceSelect),
        checkbox('壁', piece.walls === true, (on) => {
          piece.walls = on;
          refreshPreview();
        }),
        checkbox('とぎれ', piece.gap === true, (on) => {
          piece.gap = on;
          refreshPreview();
        }),
      ),
    );
    list.append(row);
  });

  holder.append(list);
  return holder;
}

function checkbox(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = el('input', {
    attrs: { type: 'checkbox', ...(value ? { checked: 'checked' } : {}) },
    on: { change: (event) => onChange((event.target as HTMLInputElement).checked) },
  });
  return el('label', {}, input, el('span', { text: label }));
}

function movePiece(index: number, by: number): void {
  const pieces = currentCourse().pieces;
  const to = index + by;
  if (to < 0 || to >= pieces.length) return;
  const [moved] = pieces.splice(index, 1);
  pieces.splice(to, 0, moved);
  state.chosenPiece = to;
  renderAll();
}

/* ------------------------------------------------------------- saving */

async function saveToProject(): Promise<void> {
  say('保存しています…');
  try {
    const response = await fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ courses: state.courses }),
    });
    const result = (await response.json()) as { saved?: number; error?: string };
    if (!response.ok) throw new Error(result.error ?? String(response.status));
    say(
      `本編に反映しました（${result.saved} コース）。src/game/courses.json を書きかえたので、` +
        'ゲームの画面を読みこみ直せば すぐ遊べます。',
      'good',
    );
  } catch (error) {
    say(`保存できませんでした: ${String(error)}`, 'bad');
    console.error('course save failed', error);
  }
}

async function copyJson(): Promise<void> {
  const text = `${JSON.stringify({ courses: state.courses }, null, 2)}\n`;
  try {
    await navigator.clipboard.writeText(text);
    say('JSON をコピーしました。', 'good');
  } catch {
    say('コピーできませんでした。開発ツールのコンソールに出しました。', 'bad');
    console.log(text);
  }
}

async function reload(): Promise<void> {
  const response = await fetch(`${COURSE_URL}?at=${Date.now()}`);
  const data = (await response.json()) as { courses?: StoredCourse[] };
  state.courses = (data.courses ?? []).map((course) => structuredClone(course));
  if (state.courses.length === 0) state.courses.push(blankCourse(0));
  state.current = Math.min(state.current, state.courses.length - 1);
  state.chosenPiece = -1;
  renderAll();
  say(`ファイルから読みこみました（${state.courses.length} コース）。`);
}

function blankCourse(index: number): StoredCourse {
  return {
    id: `course-${index + 1}`,
    name: `あたらしいコース ${index + 1}`,
    blurb: '',
    difficulty: 1,
    mood: { ...COURSE_DEFAULTS.mood },
    breeze: 0,
    seed: 1000 + index,
    targetSeconds: 20,
    pieces: [
      { length: 20, drop: 7, width: 9, walls: true },
      { length: 20, turn: 20, drop: 7, width: 8, walls: true },
      { length: 20, drop: 6, width: 9, walls: true },
    ],
  };
}

/* -------------------------------------------------------------- assembly */

function renderAll(): void {
  clear(sidePane);
  // The notice line goes back in each time, since redrawing empties the pane.
  sidePane.append(renderCourseFields(), renderPieces(), noticeLine);
  refreshPreview();
  const bar = document.getElementById('tab-holder');
  if (bar) {
    clear(bar);
    bar.append(renderTabs());
  }
}

function build(): void {
  clear(app);

  const tabHolder = el('div', { id: 'tab-holder', class: 'tabs' });
  const bar = el(
    'div',
    { class: 'bar' },
    el('h1', { text: 'コースエディタ（開発用）' }),
    tabHolder,
    el('span', { class: 'grow' }),
    button('コースを足す', () => {
      state.courses.push(blankCourse(state.courses.length));
      state.current = state.courses.length - 1;
      state.chosenPiece = -1;
      renderAll();
    }),
    button('このコースを消す', () => {
      if (state.courses.length <= 1) {
        say('コースは ひとつ以上 必要です。', 'bad');
        return;
      }
      state.courses.splice(state.current, 1);
      state.current = Math.max(0, state.current - 1);
      renderAll();
    }, 'danger'),
    button('ためし走行', () => testRun()),
    button('読みなおす', () => void reload()),
    button('JSONをコピー', () => void copyJson()),
    button('本編に反映', () => void saveToProject(), 'primary'),
  );

  sidePane = el('div', { class: 'side' });
  noticeLine = el('p', { class: 'note' });
  viewCanvas = el('canvas', {}) as HTMLCanvasElement;
  readout = el('div', { class: 'readout' });

  const view = el(
    'div',
    { class: 'view' },
    viewCanvas,
    readout,
    el('p', {
      class: 'view-hint',
      text: 'ドラッグでまわす／ホイールで寄る・引く。黄色い玉がスタート地点。',
    }),
  );

  app.append(bar, el('div', { class: 'panes' }, sidePane, view));

  renderer = new WebGLRenderer({ canvas: viewCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  setUpScene();
  attachViewControls();
  // Size it now as well as every frame, so the view is right even before the
  // first frame is drawn.
  sizeView();
  window.addEventListener('resize', sizeView);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(sizeView).observe(viewCanvas);
  requestAnimationFrame(drawFrame);
}

async function start(): Promise<void> {
  build();
  // The hint goes up before the file is read, not after: saying anything once
  // an await has finished can land on top of a message the player has since
  // caused, which is how a successful save came to look like it did nothing.
  say('コースを編集して「本編に反映」で src/game/courses.json に書きこみます。');
  await reload();
}

void start();

