/**
 * The workshop where the player builds their ball.
 *
 * The ball is a small block of cubes. Tapping a cube carves it away, adds a
 * new one against the side you tapped, or paints it, depending on the tool.
 * Dragging on empty space turns the ball around, and a photo can be stuck
 * over the whole thing.
 *
 * How the ball then rolls falls straight out of what was built: a smooth
 * round ball steers crisply, a lumpy one scrubs off speed, and a big heavy
 * one takes more shifting.
 */

import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import {
  CUBE_METRES,
  PALETTE,
  SHAPE_CENTRE,
  cellIndex,
  cubeShape,
  defaultShape,
  insideShape,
  largestConnectedPart,
  measureShape,
  pebbleShape,
  randomShape,
} from '../core/ballShape';
import { ONE } from '../core/fixed';
import { ballFeelFrom } from '../core/simulation';
import { BallDesign } from '../game/storage';
import { FaceInfo, buildBallGeometry, loadImage, makeBallMaterial, makePhotoTexture } from '../render/ballMesh';
import { button, clear, el, slider } from './dom';
import { TEXT } from './text';

type Tool = 'add' | 'remove' | 'paint';

/** The cube a tap is aimed at, and whether it is about to be created. */
interface EditTarget {
  x: number;
  y: number;
  z: number;
  cell: number;
  adding: boolean;
}

/** Largest picture the game will try to read, in bytes. */
const MAX_PHOTO_BYTES = 24 * 1024 * 1024;

/** How wide the stored copy of a photo is, in pixels. */
const PHOTO_SIZE = 512;

export class BallEditor {
  readonly root: HTMLElement;

  private canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(42, 1, 0.1, 60);
  private ballGroup = new Group();
  private mesh: Mesh | null = null;
  private material: MeshStandardMaterial | null = null;
  private faces: FaceInfo[] = [];

  private design: BallDesign;
  private tool: Tool = 'remove';
  private colour = 5;

  /** The outline showing which cube a tap would act on. */
  private marker: Group | null = null;
  private markerFace: Mesh | null = null;
  private markerEdges: LineSegments | null = null;
  /** Designs from before the last few changes, so they can be taken back. */
  private readonly history: Uint8Array[] = [];
  /** What this gesture is doing: turning the ball, or working on it. */
  private gesture: 'none' | 'turn' | 'edit' = 'none';
  /** The last cube this gesture changed, so a drag does not redo the same one. */
  private lastTouched = -1;
  private changesThisGesture = 0;
  /** Keeps every press of the random button giving a different shape. */
  private seedCounter = 0;

  private spinX = 0.5;
  private spinY = 0.6;
  private distance = 2.6;
  private animating = false;

  private readonly statsRow: HTMLElement;
  private readonly readout: HTMLElement;
  private undoButton: HTMLButtonElement | null = null;
  private readonly paletteRow: HTMLElement;
  private readonly toolRow: HTMLElement;
  private readonly noticeRow: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private saveHandler: ((design: BallDesign) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  private watcher: ResizeObserver | null = null;
  private pointerStart: { x: number; y: number; id: number } | null = null;
  private readonly pinch = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;

  constructor(design: BallDesign) {
    this.design = { ...design, voxels: Uint8Array.from(design.voxels) };

    this.canvas = el('canvas', { class: 'editor-canvas' }) as HTMLCanvasElement;
    this.statsRow = el('div', { class: 'editor-stats' });
    this.readout = el('div', { class: 'editor-readout' });
    this.paletteRow = el('div', { class: 'palette' });
    this.toolRow = el('div', { class: 'tool-row' });
    this.noticeRow = el('div', { class: 'editor-notice' });
    this.fileInput = el('input', {
      class: 'hidden-input',
      attrs: { type: 'file', accept: 'image/*' },
      on: { change: () => void this.readChosenPhoto() },
    }) as HTMLInputElement;

    this.buildTools();
    this.buildPalette();

    this.root = el(
      'section',
      { class: 'screen screen-editor' },
      el(
        'div',
        { class: 'editor' },
        el(
          'header',
          { class: 'panel-head' },
          el('h2', { text: TEXT.editorTitle }),
          button(TEXT.back, () => this.closeHandler?.(), 'ghost'),
        ),
        el(
          'div',
          { class: 'editor-body' },
          el(
            'div',
            { class: 'editor-view' },
            this.canvas,
            el('p', { class: 'editor-hint', text: TEXT.rotateHint }),
          ),
          el(
            'div',
            { class: 'editor-side' },
            el('p', { class: 'editor-hint', text: TEXT.editorHint }),
            this.toolRow,
            this.readout,
            this.paletteRow,
            el(
              'div',
              { class: 'tool-row' },
              button(TEXT.presetRound, () => this.usePreset(defaultShape(this.colour))),
              button(TEXT.presetCube, () => this.usePreset(cubeShape(this.colour))),
              button(TEXT.presetPebble, () => this.usePreset(pebbleShape(this.colour))),
              button(TEXT.presetRandom, () => this.usePreset(randomShape(this.nextSeed(), this.colour))),
            ),
            el(
              'div',
              { class: 'tool-row' },
              button(TEXT.choosePhoto, () => this.fileInput.click()),
              button(TEXT.removePhoto, () => this.clearPhoto(), 'ghost'),
            ),
            slider(TEXT.photoStrength, 0, 1, 0.05, this.design.photoStrength, (value) => {
              this.design.photoStrength = value;
              void this.applyPhoto();
            }),
            slider(TEXT.shine, 0, 1, 0.05, this.design.shine, (value) => {
              this.design.shine = value;
              this.rebuild();
            }),
            this.statsRow,
            this.noticeRow,
            el(
              'div',
              { class: 'tool-row' },
              (this.undoButton = button(TEXT.undo, () => this.undo(), 'ghost')),
              button(TEXT.reset, () => this.usePreset(defaultShape(5)), 'ghost'),
            ),
            button(TEXT.save, () => this.saveHandler?.(this.currentDesign()), 'primary'),
            this.fileInput,
          ),
        ),
      ),
    );

    this.setupScene();
    this.attachPointer();
  }

  private buildTools(): void {
    clear(this.toolRow);
    const tools: { id: Tool; label: string }[] = [
      { id: 'remove', label: TEXT.toolRemove },
      { id: 'add', label: TEXT.toolAdd },
      { id: 'paint', label: TEXT.toolPaint },
    ];
    for (const tool of tools) {
      const node = button(tool.label, () => {
        this.tool = tool.id;
        this.buildTools();
        this.refreshReadout();
      });
      node.classList.toggle('is-active', this.tool === tool.id);
      this.toolRow.append(node);
    }
  }

  /**
   * The colours, laid out as a proper palette rather than one long line.
   *
   * Each row holds the same nine hues at a different strength — bright,
   * deep, then soft — so the row you are on tells you the mood and the
   * column tells you the colour. The last row is the odds and ends that do
   * not belong to any of the nine.
   */
  private buildPalette(): void {
    clear(this.paletteRow);
    for (let i = 1; i < PALETTE.length; i++) {
      const chosen = this.colour === i;
      const swatch = el('button', {
        class: `swatch${chosen ? ' is-active' : ''}`,
        attrs: {
          type: 'button',
          style: `background:${PALETTE[i]}`,
          'aria-label': `${TEXT.colour} ${i}`,
          'aria-pressed': chosen ? 'true' : 'false',
          title: PALETTE[i],
        },
        on: {
          click: () => {
            this.colour = i;
            // Picking a colour means you want to paint with it.
            this.tool = 'paint';
            this.buildTools();
            this.buildPalette();
            this.refreshReadout();
          },
        },
      });
      this.paletteRow.append(swatch);
    }
  }

  private setupScene(): void {
    this.scene.add(this.ballGroup);
    this.scene.add(new AmbientLight(0xffffff, 0.55));
    const sky = new HemisphereLight(0xf4f8ff, 0x4a4a66, 1.0);
    this.scene.add(sky);
    const sun = new DirectionalLight(0xffffff, 1.4);
    sun.position.set(2.5, 4, 3);
    this.scene.add(sun);
    this.scene.background = new Color('#1a1f33');
    this.buildMarker();
    this.rebuild();
    this.refreshReadout();
  }

  /**
   * Builds the outline that shows which cube is about to be worked on.
   *
   * Without it, tapping a ball made of thousands of small cubes is guesswork:
   * the outline says exactly which one will go, or exactly where a new one
   * will appear, before anything is changed.
   */
  private buildMarker(): void {
    const size = CUBE_METRES * 1.02;
    const box = new BoxGeometry(size, size, size);
    const face = new Mesh(
      box,
      new MeshBasicMaterial({ transparent: true, opacity: 0.32, depthTest: false }),
    );
    const edges = new LineSegments(
      new EdgesGeometry(box),
      new LineBasicMaterial({ depthTest: false }),
    );
    const group = new Group();
    group.add(face, edges);
    group.visible = false;
    // Drawn last so it is never hidden inside the ball.
    group.renderOrder = 10;
    this.scene.add(group);
    this.marker = group;
    this.markerFace = face;
    this.markerEdges = edges;
  }

  /** Starts drawing and shows the workshop. */
  open(design: BallDesign): void {
    this.design = { ...design, voxels: Uint8Array.from(design.voxels) };
    this.history.length = 0;
    this.gesture = 'none';
    this.lastTouched = -1;
    this.showTarget(null);
    this.refreshUndo();
    this.refreshReadout();
    this.rebuild();
    void this.applyPhoto();
    if (!this.renderer) {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    this.animating = true;
    // Put the camera where it belongs straight away rather than waiting for
    // the first frame, so a tap made immediately still aims from the right
    // place.
    this.updateCamera();
    this.resize();
    if (typeof ResizeObserver !== 'undefined' && !this.watcher) {
      this.watcher = new ResizeObserver(() => this.resize());
      this.watcher.observe(this.canvas);
    }
    requestAnimationFrame(this.frame);
  }

  /** Stops drawing and lets go of the graphics card. */
  close(): void {
    this.animating = false;
    this.watcher?.disconnect();
    this.watcher = null;
    this.renderer?.dispose();
    this.renderer = null;
  }

  onSave(handler: (design: BallDesign) => void): void {
    this.saveHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  /** A copy of what the player has built. */
  currentDesign(): BallDesign {
    return {
      voxels: Uint8Array.from(this.design.voxels),
      photo: this.design.photo,
      photoStrength: this.design.photoStrength,
      shine: this.design.shine,
    };
  }

  private frame = (): void => {
    if (!this.animating || !this.renderer) return;
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  private updateCamera(): void {
    const x = Math.sin(this.spinY) * Math.cos(this.spinX) * this.distance;
    const y = Math.sin(this.spinX) * this.distance;
    const z = Math.cos(this.spinY) * Math.cos(this.spinX) * this.distance;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  /** Fits the workshop view to its box on the page. */
  resize(): void {
    if (!this.renderer) return;
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private rebuild(): void {
    if (this.mesh) {
      this.ballGroup.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const previousMap = this.material?.map ?? null;
    this.material?.dispose();
    const built = buildBallGeometry(this.design.voxels, 1);
    this.faces = built.faces;
    this.material = makeBallMaterial(this.design.shine);
    if (previousMap) this.material.map = previousMap;
    this.mesh = new Mesh(built.geometry, this.material);
    this.ballGroup.add(this.mesh);
    this.refreshStats();
  }

  private refreshStats(): void {
    const stats = measureShape(this.design.voxels);
    clear(this.statsRow);
    // How quickly the ball gets going is not a made-up number: it is what
    // the rules actually work out from where the cubes sit. Weight gathered
    // near the middle spins up faster than weight out at the rim.
    const pickup = ONE / (1 + stats.spinResistance / ONE);
    // How badly the shape catches on itself is what the rules actually use,
    // so it is shown rather than left for the player to discover on a course.
    const bumpiness = ballFeelFrom(stats).bumpiness;
    const rows: [string, string][] = [
      [TEXT.ballSize, `${Math.round((stats.radius / ONE) * 200)} cm`],
      [TEXT.ballWeight, `${Math.round((stats.weight / ONE) * 100)} %`],
      [TEXT.ballRoundness, `${Math.round((stats.smoothness / ONE) * 100)} %`],
      [TEXT.ballPickup, `${Math.round((pickup / ONE) * 100)} %`],
      [TEXT.ballBumpiness, `${Math.round((bumpiness / ONE) * 100)} %`],
      [TEXT.ballBlocks, String(stats.cubes)],
    ];
    for (const [label, value] of rows) {
      this.statsRow.append(
        el(
          'div',
          { class: 'stat' },
          el('span', { class: 'stat-label', text: label }),
          el('span', { class: 'stat-value', text: value }),
        ),
      );
    }
  }

  private notice(message: string): void {
    clear(this.noticeRow);
    if (!message) return;
    this.noticeRow.append(el('p', { class: 'note', text: message }));
    window.setTimeout(() => clear(this.noticeRow), 3200);
  }

  /** A fresh number each time, so the random shape is never the same twice. */
  private nextSeed(): number {
    this.seedCounter = (this.seedCounter + 1) | 0;
    return (Date.now() + this.seedCounter * 2654435761) >>> 0;
  }

  private usePreset(voxels: Uint8Array): void {
    this.rememberForUndo();
    this.design.voxels = voxels;
    this.showTarget(null);
    this.rebuild();
  }

  private attachPointer(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch.size === 2) {
        this.pinchDistance = this.pinchSpread();
        this.pointerStart = null;
        this.gesture = 'none';
        this.showTarget(null);
        return;
      }
      this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
      capturePointer(this.canvas, event.pointerId);

      // Pressing on the ball works on it; pressing on empty space turns it.
      // Nothing has to be learned: whatever is under the finger is what
      // responds, and the outline has already shown which cube that is.
      const target = this.targetAt(event.clientX, event.clientY);
      if (target) {
        this.gesture = 'edit';
        this.lastTouched = -1;
        this.changesThisGesture = 0;
        this.rememberForUndo();
        this.applyTo(target);
      } else {
        this.gesture = 'turn';
      }
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (this.pinch.has(event.pointerId)) {
        this.pinch.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (this.pinch.size === 2) {
        const spread = this.pinchSpread();
        if (this.pinchDistance > 0 && spread > 0) {
          this.distance = clampRange(this.distance * (this.pinchDistance / spread), 1.4, 6);
        }
        this.pinchDistance = spread;
        return;
      }

      if (this.gesture === 'none') {
        // Nothing held down: just show what a tap would do.
        this.showTarget(this.targetAt(event.clientX, event.clientY));
        return;
      }
      if (!this.pointerStart || event.pointerId !== this.pointerStart.id) return;

      if (this.gesture === 'turn') {
        const dx = event.clientX - this.pointerStart.x;
        const dy = event.clientY - this.pointerStart.y;
        this.spinY -= dx * 0.008;
        this.spinX = clampRange(this.spinX + dy * 0.008, -1.35, 1.35);
        this.pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
        return;
      }

      // Still working on the ball: carry on into whatever the finger reaches,
      // so a whole groove or ridge can be drawn in one stroke.
      const target = this.targetAt(event.clientX, event.clientY);
      this.showTarget(target);
      if (target) this.applyTo(target);
    });

    const finish = (event: PointerEvent): void => {
      this.pinch.delete(event.pointerId);
      if (this.pinch.size < 2) this.pinchDistance = 0;
      if (!this.pointerStart || event.pointerId !== this.pointerStart.id) return;
      this.pointerStart = null;
      this.gesture = 'none';
      this.lastTouched = -1;
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', finish);
    this.canvas.addEventListener('pointerleave', () => {
      if (this.gesture === 'none') this.showTarget(null);
    });

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distance = clampRange(this.distance + event.deltaY * 0.0025, 1.4, 6);
      },
      { passive: false },
    );
  }

  private pinchSpread(): number {
    const points = [...this.pinch.values()];
    if (points.length < 2) return 0;
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Works out which cube is under a point on screen, and what the current
   * tool would do to it.
   *
   * @returns the cube to act on, or null when the ball is not under the point
   */
  private targetAt(clientX: number, clientY: number): EditTarget | null {
    if (!this.mesh) return null;
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    const pointer = new Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    const caster = new Raycaster();
    this.camera.updateMatrixWorld();
    caster.setFromCamera(pointer, this.camera);
    const hits = caster.intersectObject(this.mesh, false);
    if (hits.length === 0) return null;
    const faceIndex = hits[0].faceIndex;
    if (faceIndex === undefined || faceIndex === null) return null;
    const face = this.faces[faceIndex];
    if (!face) return null;

    if (this.tool === 'add') {
      // A new cube goes against the side that was pointed at.
      const x = face.x + face.nx;
      const y = face.y + face.ny;
      const z = face.z + face.nz;
      if (!insideShape(x, y, z)) return null;
      return { x, y, z, cell: cellIndex(x, y, z), adding: true };
    }
    return { x: face.x, y: face.y, z: face.z, cell: face.cell, adding: false };
  }

  /** Moves the outline onto a cube, or hides it. */
  private showTarget(target: EditTarget | null): void {
    if (!this.marker) return;
    if (!target) {
      this.marker.visible = false;
      return;
    }
    this.marker.visible = true;
    this.marker.position.set(
      (target.x - SHAPE_CENTRE) * CUBE_METRES,
      (target.y - SHAPE_CENTRE) * CUBE_METRES,
      (target.z - SHAPE_CENTRE) * CUBE_METRES,
    );
    const tint =
      this.tool === 'remove' ? '#ff7b7b' : this.tool === 'add' ? '#ffd166' : PALETTE[this.colour];
    (this.markerFace?.material as MeshBasicMaterial | undefined)?.color.set(tint);
    (this.markerEdges?.material as LineBasicMaterial | undefined)?.color.set('#ffffff');
  }

  /** Does whatever the current tool does to one cube. */
  private applyTo(target: EditTarget): void {
    if (target.cell === this.lastTouched) return;
    // One stroke is not allowed to run away with the whole ball.
    if (this.changesThisGesture >= 200) return;
    const voxels = this.design.voxels;

    if (this.tool === 'remove') {
      if (voxels[target.cell] === 0) return;
      if (countCubes(voxels) <= 1) {
        this.notice(TEXT.needBlocks);
        return;
      }
      voxels[target.cell] = 0;
      // Carving can leave a cube floating on its own; drop the strays.
      this.design.voxels = largestConnectedPart(voxels);
    } else if (this.tool === 'add') {
      if (voxels[target.cell] !== 0) return;
      voxels[target.cell] = this.colour;
    } else {
      if (voxels[target.cell] === 0 || voxels[target.cell] === this.colour) return;
      voxels[target.cell] = this.colour;
    }

    this.lastTouched = target.cell;
    this.changesThisGesture++;
    this.rebuild();
    this.showTarget(target);
  }

  /** Keeps a copy of the design so the last change can be taken back. */
  private rememberForUndo(): void {
    this.history.push(Uint8Array.from(this.design.voxels));
    if (this.history.length > 30) this.history.shift();
    this.refreshUndo();
  }

  /** Takes back the last change. */
  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.design.voxels = previous;
    this.rebuild();
    this.refreshUndo();
  }

  private refreshUndo(): void {
    if (!this.undoButton) return;
    this.undoButton.disabled = this.history.length === 0;
    this.undoButton.style.opacity = this.history.length === 0 ? '0.4' : '1';
  }

  /** Says in words what a tap will do right now. */
  private refreshReadout(): void {
    clear(this.readout);
    const label =
      this.tool === 'remove'
        ? TEXT.toolRemove
        : this.tool === 'add'
          ? TEXT.toolAdd
          : TEXT.toolPaint;
    const tint =
      this.tool === 'remove' ? '#ff7b7b' : this.tool === 'add' ? '#ffd166' : PALETTE[this.colour];
    this.readout.append(
      el('span', { class: 'editor-readout-swatch', attrs: { style: `background:${tint}` } }),
      el('span', { text: `${TEXT.editorTarget}: ${label}` }),
    );
  }

  /** Reads the picture the player picked and shrinks it down for storage. */
  private async readChosenPhoto(): Promise<void> {
    const file = this.fileInput.files?.[0];
    this.fileInput.value = '';
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      this.notice(TEXT.photoTooLarge);
      return;
    }
    try {
      const source = await readAsDataUrl(file);
      const image = await loadImage(source);
      this.design.photo = shrinkPhoto(image);
      await this.applyPhoto();
    } catch {
      this.notice(TEXT.photoFailed);
    }
  }

  private clearPhoto(): void {
    this.design.photo = null;
    if (this.material) {
      this.material.map?.dispose();
      this.material.map = null;
      this.material.needsUpdate = true;
    }
  }

  private async applyPhoto(): Promise<void> {
    if (!this.material) return;
    if (!this.design.photo) {
      this.material.map?.dispose();
      this.material.map = null;
      this.material.needsUpdate = true;
      return;
    }
    try {
      const image = await loadImage(this.design.photo);
      const texture = makePhotoTexture(image, this.design.photoStrength);
      if (!texture) return;
      this.material.map?.dispose();
      this.material.map = texture;
      this.material.needsUpdate = true;
    } catch {
      this.notice(TEXT.photoFailed);
    }
  }
}

/**
 * Asks the browser to keep sending us this pointer even if it wanders off the
 * canvas. Some browsers refuse if the pointer has already been let go, and a
 * refusal is not worth interrupting anything over.
 */
function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Carry on without capture; the pointer still works, just not off-canvas.
  }
}

function countCubes(voxels: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < voxels.length; i++) if (voxels[i] !== 0) n++;
  return n;
}

function clampRange(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('picture could not be read'));
    reader.readAsDataURL(file);
  });
}

/**
 * Shrinks a photo to a modest square. Phone photos are far bigger than the
 * ball needs, and browser storage is small, so this keeps saving reliable.
 */
function shrinkPhoto(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = PHOTO_SIZE;
  canvas.height = PHOTO_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const ratio = Math.max(PHOTO_SIZE / image.width, PHOTO_SIZE / image.height);
  const width = image.width * ratio;
  const height = image.height * ratio;
  context.drawImage(image, (PHOTO_SIZE - width) / 2, (PHOTO_SIZE - height) / 2, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** How wide one cube is on screen, for anyone laying out the workshop. */
export const EDITOR_CUBE_METRES = CUBE_METRES;
