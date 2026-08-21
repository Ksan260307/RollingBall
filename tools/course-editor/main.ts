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
import { type CoursePiece, buildCourse } from '../../src/core/course';
import {
  type JunctionName,
  type StoredPiece,
  type WallsName,
  BRANCH_TOLERANCE,
  branchCloses,
  branchGap,
  branchShows,
  branchSpread,
} from '../../src/game/stages';
import { describeGap, fitBranch } from './fit';
import { toNumber } from '../../src/core/fixed';
import { defaultShape, measureShape } from '../../src/core/ballShape';
import { RunState, STEPS_PER_SECOND, World } from '../../src/core/simulation';
import { demoControls } from '../../src/game/demoDriver';
import {
  COURSE_DEFAULTS,
  JUNCTION_NAMES,
  SURFACE_NAMES,
  wallsMeaning,
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
/**
 * The other way down, where the course being drawn has one.
 *
 * Drawn whether or not it closes yet. An author part way through a fork
 * needs to see what they are drawing, and a branch that does not close is
 * exactly the one worth looking at.
 */
let branchMesh: Group | null = null;
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
  const paint = {
    floor: stage.mood.floor,
    edge: stage.mood.edge,
    ground: stage.mood.ground,
  };
  courseMesh = buildCourseMesh(course, paint);
  scene.add(courseMesh);

  // The other way down, drawn only where it differs. Before the fork and
  // after the join it is the very same floor as the main line, and two of
  // those in one place look like one road flickering rather than two roads.
  if (branchMesh) {
    scene.remove(branchMesh);
    disposeCourseMesh(branchMesh);
    branchMesh = null;
  }
  const branch = currentCourse().branch;
  if (branch && Array.isArray(branch.pieces) && branch.pieces.length > 0) {
    const held = branch.pieces.map(pieceFromStored);
    const from = Math.max(0, Math.min(stage.pieces.length, Math.round(branch.from)));
    const to = Math.max(from, Math.min(stage.pieces.length, Math.round(branch.to)));
    const other = buildCourse([...stage.pieces.slice(0, from), ...held, ...stage.pieces.slice(to)], 0);
    // Held back from both junctions the same way the game holds it back, so
    // that what is drawn here is what will be drawn there. Nothing to draw where the second way never comes out from under the
    // first: that is the state the author is trying to get out of, and an
    // empty preview says so more plainly than a road drawn on top of a road.
    const shows = branchShows(stage.pieces, held, from, to);
    if (shows) {
      branchMesh = buildCourseMesh(other, paint, { ...shows, inFront: true });
      scene.add(branchMesh);
    }
  }

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

/**
 * The fork: which stretches are replaced, and by what.
 *
 * A branch is written as "instead of stretches 2 to 5, go this way", so it
 * is an edit to the course rather than a second course to keep in step.
 * Keeping left at the split takes the branch; keeping right stays on the
 * main line.
 */
/** Turns a built stretch back into the plain form the file keeps. */
function storedFromPiece(piece: CoursePiece): StoredPiece {
  const round = (value: number): number => Math.round(value * 100) / 100;
  const left = piece.wallLeft ?? piece.walls ?? false;
  const right = piece.wallRight ?? piece.walls ?? false;
  const stored: StoredPiece = {
    length: round(piece.length),
    width: round(piece.width ?? 8),
    walls: left && right ? true : left ? 'left' : right ? 'right' : false,
  };
  if (piece.turn) stored.turn = round(piece.turn);
  if (piece.drop) stored.drop = round(piece.drop);
  if (piece.bank) stored.bank = round(piece.bank);
  // What the floor is made of and whether this is a junction are the
  // author's, not the shape's. Dropping them here quietly turned a rough
  // narrow chute into ordinary road every time the closer was worked out.
  if (piece.surface) stored.surface = SURFACE_NAMES[piece.surface];
  if (piece.junction) stored.junction = JUNCTION_NAMES[piece.junction];
  return stored;
}

/**
 * The two ticks that say which edges of a stretch have railings.
 *
 * Written back as one value — true, false, or the name of the single edge
 * that has one — so a course file stays as readable as it was.
 */
function wallTicks(piece: StoredPiece): HTMLElement[] {
  const set = (left: boolean, right: boolean): void => {
    piece.walls = (left && right ? true : left ? 'left' : right ? 'right' : false) as WallsName;
    refreshPreview();
  };
  const has = wallsMeaning(piece.walls);
  return [
    checkbox('ひだりの柵', has.left, (on) => set(on, has.right)),
    checkbox('みぎの柵', has.right, (on) => set(has.left, on)),
  ];
}

/** The picker for what the floor is made of. */
const SURFACE_LABELS: Record<SurfaceName, string> = {
  normal: 'ふつう',
  slick: 'すべる',
  rough: 'あらい',
  boost: '加速',
};

function surfaceField(piece: StoredPiece): HTMLSelectElement {
  const select = el('select', {
    on: {
      change: (event) => {
        piece.surface = (event.target as HTMLSelectElement).value as SurfaceName;
        refreshPreview();
      },
    },
  }) as HTMLSelectElement;
  for (const name of SURFACE_NAMES) {
    const option = el('option', { text: SURFACE_LABELS[name], attrs: { value: name } });
    if ((piece.surface ?? 'normal') === name) option.setAttribute('selected', 'selected');
    select.append(option);
  }
  return select;
}

/**
 * The picker for where a road divides, or comes back together.
 *
 * Placing one of these is what stops a railing being built across the mouth
 * of a fork. They come in pairs: where one way says the other is on its
 * left, the other says the first is on its right, and the two open towards
 * each other.
 */
const JUNCTION_LABELS: Record<JunctionName, string> = {
  none: 'ふつうの道',
  'split-left': 'わかれ（ひだりへ）',
  'split-right': 'わかれ（みぎへ）',
  'join-left': 'あわさり（ひだりから）',
  'join-right': 'あわさり（みぎから）',
};

function junctionField(piece: StoredPiece): HTMLSelectElement {
  const select = el('select', {
    on: {
      change: (event) => {
        piece.junction = (event.target as HTMLSelectElement).value as JunctionName;
        refreshPreview();
      },
    },
  }) as HTMLSelectElement;
  for (const name of JUNCTION_NAMES) {
    const option = el('option', { text: JUNCTION_LABELS[name], attrs: { value: name } });
    if ((piece.junction ?? 'none') === name) option.setAttribute('selected', 'selected');
    select.append(option);
  }
  return select;
}

function branchPanel(course: StoredCourse): HTMLElement {
  const has = !!course.branch;
  const rows: HTMLElement[] = [
    tickField('わかれ道を つくる', has, (value) => {
      if (value) {
        course.branch = course.branch ?? {
          from: Math.min(2, course.pieces.length - 1),
          to: Math.min(course.pieces.length, 4),
          pieces: [{ length: 12, drop: 12, width: 3, walls: true }],
        };
      } else {
        delete course.branch;
      }
      renderAll();
    }),
  ];

  if (course.branch) {
    const branch = course.branch;
    rows.push(
      el(
        'div',
        { class: 'grid3' },
        numberField('どこから（つなぎ番号）', branch.from, 1, (value) => {
          branch.from = Math.max(0, Math.round(value));
          refreshPreview();
        }),
        numberField('どこまで（この番号は含まない）', branch.to, 1, (value) => {
          branch.to = Math.max(0, Math.round(value));
          refreshPreview();
        }),
        numberField('わかれ道の つなぎ数', branch.pieces.length, 1, (value) => {
          const wanted = Math.max(1, Math.min(12, Math.round(value)));
          while (branch.pieces.length > wanted) branch.pieces.pop();
          while (branch.pieces.length < wanted) {
            branch.pieces.push({ length: 12, drop: 10, width: 4, walls: true });
          }
          renderAll();
        }),
      ),
    );
    branch.pieces.forEach((piece, index) => {
      rows.push(
        el(
          'div',
          { class: 'grid3' },
          numberField(`わかれ${index + 1} 長さ m`, piece.length, 1, (value) => {
            piece.length = value;
            refreshPreview();
          }),
          numberField('曲がり °', piece.turn ?? 0, 1, (value) => {
            piece.turn = value;
            refreshPreview();
          }),
          numberField('下り °', piece.drop ?? 0, 1, (value) => {
            piece.drop = value;
            refreshPreview();
          }),
          numberField('幅 m', piece.width ?? 4, 0.2, (value) => {
            piece.width = value;
            refreshPreview();
          }),
          // A fork has two sides and both have to be told about it: the
          // branch needs its own junction pieces at each end, opening
          // towards the road it leaves.
          el('label', {}, el('span', { text: 'わかれ目' }), junctionField(piece)),
          el('label', {}, el('span', { text: '床' }), surfaceField(piece)),
          ...wallTicks(piece),
        ),
      );
    });
    // Whether it comes back, and a way to make it come back.
    const built = course.pieces.map(pieceFromStored);
    const detour = branch.pieces.map(pieceFromStored);
    const gap = branchGap(built, detour, branch.from, branch.to);
    const closes = branchCloses(gap);
    // Closing is half of it. A branch that comes back perfectly but never
    // comes out from under the road it left is invisible on screen, so how
    // far the two ways get from each other is shown just as plainly.
    const spread = branchSpread(built, detour, branch.from, branch.to);
    const shown = branchShows(built, detour, branch.from, branch.to);
    const clears = shown !== null && spread >= BRANCH_TOLERANCE.spread;
    rows.push(
      el('p', {
        class: closes ? 'note note-good' : 'note note-bad',
        text: `${closes ? '合流します' : '合流しません（このままでは 本編に出ません）'}： ${describeGap(gap)}`,
      }),
      el('p', {
        class: clears ? 'note note-good' : 'note note-bad',
        text: clears
          ? `二本の道は 見わけが つきます： いちばん ひらくところ ${spread.toFixed(1)}m` +
            `（わかれ道が 見えるのは ${(shown!.to - shown!.from).toFixed(0)}m ぶん）`
          : 'わかれ道が 本線に 隠れています（このままでは 本編に出ません）。' +
            'わかれ道を よこに ずらすか、上下に 離してください',
      }),
      el(
        'div',
        { class: 'row' },
        button('自動で つなぐ', () => {
          const holder = document.querySelector('.branch-panel .note') as HTMLElement | null;
          if (holder) holder.textContent = '計算中…';
          // Given back to the browser first, so the message is seen.
          window.setTimeout(() => {
            const fitted = fitBranch(built, detour, branch.from, branch.to);
            branch.pieces = fitted.pieces.map(storedFromPiece);
            renderAll();
          }, 30);
        }),
      ),
      el('p', {
        class: 'note',
        text: 'ひだりに よると わかれ道、みぎに よると 本線です。合流しない わかれ道は 本編では 使われません。',
      }),
    );
  }

  return el('div', { class: 'branch-panel' }, el('h2', { text: 'わかれ道' }), ...rows);
}

/** A plain yes/no switch. */
function tickField(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const input = el('input', {
    attrs: { type: 'checkbox' },
    on: { change: (event) => onChange((event.target as HTMLInputElement).checked) },
  }) as HTMLInputElement;
  input.checked = value;
  return el('label', { class: 'tick' }, input, el('span', { text: label }));
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
      `${index + 1}. ${course.name || course.id}${course.inGame === false ? '（本編に出ません）' : ''}`,
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
    // Parking a course beats deleting it: the work stays, the game stays tidy.
    tickField('本編に出す（外すと、ファイルには残るがゲームには出ません）', course.inGame !== false, (value) => {
      course.inGame = value;
      renderAll();
    }),
    branchPanel(course),
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

    const surfaceSelect = surfaceField(piece);

    const junctionSelect = junctionField(piece);

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
        // How exposed this stretch is. Nothing written means fully exposed,
        // which is how every course behaved before there was a choice.
        numberField('風あたり 0-1', piece.wind ?? 1, 0.1, (value) => {
          piece.wind = Math.min(1, Math.max(0, value));
        }),
      ),
      el(
        'div',
        { class: 'piece-flags' },
        el('label', {}, el('span', { text: '床' }), surfaceSelect),
        el('label', {}, el('span', { text: 'わかれ目' }), junctionSelect),
        // One tick per edge. A junction wants the inside open and the
        // outside held, and a single switch cannot say that.
        ...wallTicks(piece),
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
    inGame: true,
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

