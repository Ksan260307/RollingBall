/**
 * Everything you can see.
 *
 * The rules of the game never touch this file, and this file never changes
 * the rules. It reads the world, blends between the last two steps so motion
 * looks smooth at any refresh rate, and draws the result.
 */

import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Course } from '../core/course';
import { ONE } from '../core/fixed';
import { Stage as LifeStage } from '../core/entities';
import { World } from '../core/simulation';
import { Stage } from '../game/stages';
import { BallDesign } from '../game/storage';
import { buildCourseMesh, disposeCourseMesh, toMetres } from './courseMesh';
import { drawnSpin, emptySpin, spinRate } from './ballSpin';
import { buildBallMesh, loadImage, makePhotoTexture } from './ballMesh';

/** How far behind the ball the camera sits at the standard zoom. */
const BASE_DISTANCE = 7.5;

/** How high above the ball the camera sits at the standard zoom. */
const BASE_HEIGHT = 3.1;

/** How far ahead of the ball the camera looks. */
const LOOK_AHEAD = 6.0;

/** How many sparkle pieces can be in the air at once. */
const SPARKLE_COUNT = 72;

/** How long the ball takes to burst through the finish and vanish. */
const BREAKTHROUGH_SECONDS = 2.6;

/** The ways the camera can watch a replay. */
export const CAMERA_STYLES = [
  'chase',
  'low',
  'high',
  'side',
  'ahead',
  'close',
] as const;

export type CameraStyle = (typeof CAMERA_STYLES)[number];

const scratchPosition = new Vector3();
const scratchTarget = new Vector3();
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3(1, 1, 1);
const scratchAxis = new Vector3();
const scratchForward = new Vector3();
const scratchRight = new Vector3();
const spinScratch = emptySpin();

/** Builds a soft top-to-bottom gradient for the sky dome. */
function skyTexture(top: string, bottom: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.55, bottom);
    gradient.addColorStop(1, bottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 256);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

interface SceneryLayer {
  mesh: InstancedMesh;
  slots: number[];
}

export class GameView {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;

  private courseMesh: Group | null = null;
  private ballGroup = new Group();
  private ballMesh: Mesh | null = null;
  private ballMaterial: MeshStandardMaterial | null = null;
  private ballSpin = new Quaternion();

  private sky: Mesh;
  private ground: Mesh;
  private sunlight: DirectionalLight;
  private ambience: HemisphereLight;

  private sceneryLayers: SceneryLayer[] = [];
  private sparkles: Mesh[] = [];
  private sparkleLife: number[] = [];
  private nextSparkle = 0;

  private cameraPosition = new Vector3();
  private cameraTarget = new Vector3();
  private cameraReady = false;
  private lastStyle: CameraStyle = 'chase';

  /** How far back the camera sits, as a multiplier of the standard distance. */
  zoom = 1;
  /** Turns the heavier effects off on slower devices. */
  richGraphics = true;
  /** How the camera watches the ball. Replays cycle through the lot. */
  cameraStyle: CameraStyle = 'chase';

  /** Set while the ball is bursting through the finish and away. */
  private breakthrough = 0;
  private readonly breakAway = new Vector3();
  /** The colour of the course edging, for the pieces that fly off. */
  private edgeColour = '#ffd166';

  private readonly canvas: HTMLCanvasElement;
  private lastWidth = 0;
  private lastHeight = 0;
  private watcher: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const wide = window.innerWidth >= 900;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: wide,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, wide ? 2 : 1.5));
    this.renderer.shadowMap.enabled = false;

    this.camera = new PerspectiveCamera(58, 1, 0.1, 600);
    this.scene.add(this.camera);

    this.sky = new Mesh(
      new SphereGeometry(320, 24, 16),
      new MeshBasicMaterial({ side: BackSide, depthWrite: false }),
    );
    this.scene.add(this.sky);

    this.ground = new Mesh(
      new PlaneGeometry(800, 800),
      new MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -40;
    this.scene.add(this.ground);

    this.ambience = new HemisphereLight(0xffffff, 0x404060, 1.1);
    this.scene.add(this.ambience);
    this.scene.add(new AmbientLight(0xffffff, 0.25));

    this.sunlight = new DirectionalLight(0xffffff, 1.5);
    this.sunlight.position.set(-30, 60, -20);
    this.scene.add(this.sunlight);
    this.scene.add(this.sunlight.target);

    this.scene.add(this.ballGroup);
    this.buildSceneryLayers();
    this.buildSparkles();
    this.resize();

    // Follow the canvas itself, so the picture is right however the page was
    // laid out when it loaded.
    if (typeof ResizeObserver !== 'undefined') {
      this.watcher = new ResizeObserver(() => this.resize());
      this.watcher.observe(canvas);
    }
  }

  private buildSceneryLayers(): void {
    const shapes = [
      new IcosahedronGeometry(0.34, 0),
      new BoxGeometry(0.36, 0.5, 0.36),
      new ConeGeometry(0.3, 0.8, 6),
      new OctahedronGeometry(0.32, 0),
    ];
    for (const geometry of shapes) {
      const material = new MeshStandardMaterial({
        roughness: 0.4,
        metalness: 0.1,
        emissive: new Color('#000000'),
      });
      const mesh = new InstancedMesh(geometry, material, 128);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.scene.add(mesh);
      this.sceneryLayers.push({ mesh, slots: [] });
    }
  }

  private buildSparkles(): void {
    const geometry = new IcosahedronGeometry(0.12, 0);
    for (let i = 0; i < SPARKLE_COUNT; i++) {
      const material = new MeshBasicMaterial({ transparent: true, opacity: 0 });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparkles.push(mesh);
      this.sparkleLife.push(0);
    }
  }

  /**
   * Fits the picture to the box the canvas actually occupies.
   *
   * Reading the canvas rather than the window matters when the page starts
   * out hidden or in a panel that has not been laid out yet: the window can
   * report nothing at all, and a picture sized to nothing never appears.
   */
  resize(): void {
    const width = Math.max(1, Math.round(this.canvas.clientWidth || window.innerWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight || window.innerHeight));
    if (width === this.lastWidth && height === this.lastHeight) return;
    this.lastWidth = width;
    this.lastHeight = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Swaps in a new course and its colours. */
  setStage(stage: Stage, course: Course): void {
    this.edgeColour = stage.mood.edge;
    if (this.courseMesh) {
      this.scene.remove(this.courseMesh);
      disposeCourseMesh(this.courseMesh);
    }
    this.courseMesh = buildCourseMesh(course, {
      floor: stage.mood.floor,
      edge: stage.mood.edge,
      ground: stage.mood.ground,
    });
    this.scene.add(this.courseMesh);

    const skyMaterial = this.sky.material as MeshBasicMaterial;
    skyMaterial.map?.dispose();
    skyMaterial.map = skyTexture(stage.mood.sky, stage.mood.horizon);
    skyMaterial.needsUpdate = true;

    (this.ground.material as MeshStandardMaterial).color = new Color(stage.mood.ground);
    this.scene.fog = new Fog(new Color(stage.mood.horizon).getHex(), 24, stage.mood.fog);
    this.ambience.color = new Color(stage.mood.sky);
    this.ambience.groundColor = new Color(stage.mood.ground);

    this.cameraReady = false;
    this.addGates(course, stage);
  }

  /** Puts a start gate and a finish banner on the course. */
  private addGates(course: Course, stage: Stage): void {
    if (!this.courseMesh) return;
    const banner = new Color(stage.mood.edge);
    const postGeometry = new BoxGeometry(0.35, 3.2, 0.35);
    const beamGeometry = new BoxGeometry(1, 0.5, 0.3);
    const material = new MeshStandardMaterial({ color: banner, roughness: 0.5 });

    for (const index of [0, course.count - 1]) {
      const gate = new Group();
      const centre = new Vector3(
        toMetres(course.x[index]),
        toMetres(course.y[index]),
        toMetres(course.z[index]),
      );
      const right = new Vector3(
        toMetres(course.rightX[index]),
        toMetres(course.rightY[index]),
        toMetres(course.rightZ[index]),
      );
      const up = new Vector3(
        toMetres(course.upX[index]),
        toMetres(course.upY[index]),
        toMetres(course.upZ[index]),
      );
      const half = toMetres(course.halfWidth[index]) + 0.4;

      for (const side of [-1, 1]) {
        const post = new Mesh(postGeometry, material);
        post.position
          .copy(centre)
          .addScaledVector(right, half * side)
          .addScaledVector(up, 1.6);
        gate.add(post);
      }
      const beam = new Mesh(beamGeometry, material);
      beam.scale.x = half * 2;
      beam.position.copy(centre).addScaledVector(up, 3.2);
      beam.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), right.clone().normalize());
      gate.add(beam);
      this.courseMesh.add(gate);
    }
  }

  /** Swaps in the ball the player built. */
  async setBall(design: BallDesign): Promise<void> {
    if (this.ballMesh) {
      this.ballGroup.remove(this.ballMesh);
      this.ballMesh.geometry.dispose();
      this.ballMaterial?.map?.dispose();
      this.ballMaterial?.dispose();
    }
    const built = buildBallMesh(design.voxels, design.shine, 1);
    this.ballMesh = built.mesh;
    this.ballMaterial = built.material;
    this.ballGroup.add(built.mesh);
    this.ballSpin.identity();

    if (design.photo) {
      try {
        const image = await loadImage(design.photo);
        const texture = makePhotoTexture(image, design.photoStrength);
        if (texture && this.ballMaterial) {
          this.ballMaterial.map = texture;
          this.ballMaterial.needsUpdate = true;
        }
      } catch {
        // A picture that will not load simply leaves the ball plain.
      }
    }
  }

  /** Fills in the scenery from the world, once per run. */
  prepareScenery(world: World): void {
    for (const layer of this.sceneryLayers) {
      layer.slots.length = 0;
      layer.mesh.count = 0;
    }
    for (let i = 0; i < world.scenery.count; i++) {
      const kind = world.scenery.kindOf(i);
      const layer = this.sceneryLayers[kind] ?? this.sceneryLayers[0];
      if (layer.slots.length >= layer.mesh.instanceMatrix.count) continue;
      layer.slots.push(i);
    }
    for (const layer of this.sceneryLayers) {
      layer.mesh.count = layer.slots.length;
    }
  }

  /** Moves the scenery for this frame. */
  private updateScenery(world: World, seconds: number): void {
    for (let l = 0; l < this.sceneryLayers.length; l++) {
      const layer = this.sceneryLayers[l];
      const store = world.scenery;
      for (let s = 0; s < layer.slots.length; s++) {
        const i = layer.slots[s];
        const asleep = store.stageOf(i) === LifeStage.Sleeping;
        const progress = store.progressOf(i) / 65536;
        const wobble = Math.sin(progress * Math.PI * 2 + seconds * 0.6);
        const energy = store.energyOf(i) / 65535;
        const size = asleep ? 0 : 0.55 + energy * 0.65;

        scratchPosition.set(
          toMetres(store.x[i]),
          toMetres(store.y[i]) + wobble * 0.25,
          toMetres(store.z[i]),
        );
        scratchQuaternion.setFromAxisAngle(
          scratchAxis.set(0, 1, 0),
          progress * Math.PI * 2 + l,
        );
        scratchScale.set(size, size, size);
        scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
        layer.mesh.setMatrixAt(s, scratchMatrix);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
      const material = layer.mesh.material as MeshStandardMaterial;
      const glow = world.surroundings.liveliness / 65535;
      material.emissiveIntensity = 0.25 + glow * 0.5;
      material.emissive.setHSL(0.55 + l * 0.1, 0.7, 0.25 + glow * 0.2);
      material.color.setHSL(0.1 + l * 0.17, 0.65, 0.62);
    }
  }

  /**
   * Sends the ball crashing on through the finish and away into the
   * distance, rather than stopping dead on the line.
   *
   * The rules have already finished the run by this point, so nothing here
   * can change the result: this is the ball taking its bow.
   */
  startBreakthrough(world: World): void {
    const speed = Math.max(6, world.speedFor(0) / ONE);
    const point = Math.min(world.course.count - 1, Math.max(0, courseIndexOf(world)));
    this.breakAway
      .set(
        toMetres(world.course.forwardX[point]),
        toMetres(world.course.forwardY[point]),
        toMetres(world.course.forwardZ[point]),
      )
      .normalize()
      .multiplyScalar(speed * 1.35);
    // A shove upward as well, so it arcs away rather than boring into the hill.
    this.breakAway.y += speed * 0.35;
    this.breakthrough = BREAKTHROUGH_SECONDS;

    // Pieces flying off where it went through.
    const at = this.ballGroup.position;
    this.burst(at.x, at.y, at.z, '#ffffff', 10);
    this.burst(at.x, at.y, at.z, this.edgeColour, 8);
  }

  /** True while the ball is still flying off past the finish. */
  get breakingThrough(): boolean {
    return this.breakthrough > 0;
  }

  /** Puts the ball back to normal, ready for another run. */
  clearBreakthrough(): void {
    this.breakthrough = 0;
    this.setBallVisible(true);
  }

  /**
   * Shows or hides the ball.
   *
   * Once it has gone through the finish it is somewhere over the hill, so
   * it should not still be sitting on the line behind the results.
   */
  setBallVisible(on: boolean): void {
    this.ballGroup.visible = on;
    if (on) this.ballGroup.scale.setScalar(1);
  }

  /** Starts a burst of sparkles at a point. */
  burst(x: number, y: number, z: number, colour: string, count = 6): void {
    for (let n = 0; n < count; n++) {
      const mesh = this.sparkles[this.nextSparkle];
      const material = mesh.material as MeshBasicMaterial;
      material.color = new Color(colour);
      material.opacity = 1;
      mesh.visible = true;
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.5,
        y + (Math.random() - 0.5) * 0.5,
        z + (Math.random() - 0.5) * 0.5,
      );
      mesh.scale.setScalar(1);
      this.sparkleLife[this.nextSparkle] = 0.7;
      this.nextSparkle = (this.nextSparkle + 1) % SPARKLE_COUNT;
    }
  }

  private updateSparkles(delta: number): void {
    for (let i = 0; i < this.sparkles.length; i++) {
      if (this.sparkleLife[i] <= 0) continue;
      this.sparkleLife[i] -= delta;
      const mesh = this.sparkles[i];
      const material = mesh.material as MeshBasicMaterial;
      const life = Math.max(0, this.sparkleLife[i]) / 0.7;
      material.opacity = life;
      material.transparent = true;
      mesh.position.y += delta * 1.6;
      mesh.scale.setScalar(0.4 + life);
      if (this.sparkleLife[i] <= 0) mesh.visible = false;
    }
  }

  /**
   * Draws one frame.
   *
   * @param world     the world being played
   * @param alpha     how far between the last two steps the picture sits
   * @param previous  where the ball was on the previous step
   * @param delta     seconds since the last frame
   * @param seconds   seconds since the run began, for gentle idle motion
   */
  render(
    world: World,
    alpha: number,
    previous: { x: number; y: number; z: number },
    delta: number,
    seconds: number,
  ): void {
    // Cheap when nothing changed, and it means a page that loaded while it
    // was hidden or in a collapsed panel puts itself right on the first frame
    // it actually gets to draw.
    this.resize();

    const px = toMetres(previous.x);
    const py = toMetres(previous.y);
    const pz = toMetres(previous.z);
    const nx = toMetres(world.x[0]);
    const ny = toMetres(world.y[0]);
    const nz = toMetres(world.z[0]);
    const bx = px + (nx - px) * alpha;
    const by = py + (ny - py) * alpha;
    const bz = pz + (nz - pz) * alpha;

    if (this.breakthrough > 0) {
      // Carrying on past the line under its own steam, shrinking away.
      this.breakthrough = Math.max(0, this.breakthrough - delta);
      const gone = 1 - this.breakthrough / BREAKTHROUGH_SECONDS;
      this.breakAway.y -= 9.8 * delta * 0.25;
      this.ballGroup.position.addScaledVector(this.breakAway, delta);
      // Holds its size while it is still worth watching, then goes.
      this.ballGroup.scale.setScalar(Math.max(0.001, 1 - gone * gone * gone));
      this.ballGroup.visible = this.breakthrough > 0;
      this.spinBall(world, delta * 2.4);
      // The camera plants itself where it was and turns to watch, so the
      // course stays in the foreground while the ball tears away from it.
      this.camera.position.copy(this.cameraPosition);
      this.cameraTarget.lerp(this.ballGroup.position, 1 - Math.exp(-11 * delta));
      this.camera.lookAt(this.cameraTarget);
      this.updateScenery(world, seconds);
      this.updateSparkles(delta);
      this.sunlight.position.set(bx - 24, by + 46, bz - 18);
      this.sunlight.target.position.set(bx, by, bz);
      this.sky.position.set(bx, by, bz);
      this.ground.position.set(bx, by - 34, bz);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.ballGroup.position.set(bx, by, bz);
    this.spinBall(world, delta);

    this.followBall(world, bx, by, bz, delta);

    this.updateScenery(world, seconds);
    this.updateSparkles(delta);

    this.sunlight.position.set(bx - 24, by + 46, bz - 18);
    this.sunlight.target.position.set(bx, by, bz);
    this.sky.position.set(bx, by, bz);
    this.ground.position.set(bx, by - 34, bz);

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Turns the ball by the turning speed the rules worked out.
   *
   * A skid therefore looks like a skid: on ice the ball slides on without
   * its surface keeping pace with the ground, because it genuinely is not
   * rolling.
   */
  private spinBall(world: World, delta: number): void {
    const spin = drawnSpin(world, spinScratch);
    const rate = spinRate(spin);
    if (rate > 1e-5) {
      scratchAxis.set(spin.x / rate, spin.y / rate, spin.z / rate);
      scratchQuaternion.setFromAxisAngle(scratchAxis, rate * delta);
      this.ballSpin.premultiply(scratchQuaternion);
    }
    this.ballGroup.quaternion.copy(this.ballSpin);
  }

  /** Keeps the camera behind and a little above the ball. */
  private followBall(world: World, bx: number, by: number, bz: number, delta: number): void {
    const course = world.course;
    const point = Math.min(course.count - 1, Math.max(0, courseIndexOf(world)));
    const forward = scratchForward.set(
      toMetres(course.forwardX[point]),
      toMetres(course.forwardY[point]),
      toMetres(course.forwardZ[point]),
    );
    let distance = BASE_DISTANCE * this.zoom;
    let height = BASE_HEIGHT * Math.max(0.6, this.zoom);
    let sideways = 0;
    let facing = 1;

    // Replays wander around the ball; play stays behind it where it belongs.
    switch (this.cameraStyle) {
      case 'low':
        distance *= 0.8;
        height = 0.5;
        break;
      case 'high':
        distance *= 1.5;
        height *= 4.2;
        break;
      case 'side':
        distance *= 0.35;
        sideways = 7.5;
        height *= 0.7;
        break;
      case 'ahead':
        // Out in front, looking back at the ball as it comes on.
        facing = -1;
        distance *= 0.9;
        height *= 0.8;
        break;
      case 'close':
        distance *= 0.42;
        height *= 0.5;
        sideways = 1.6;
        break;
      default:
        break;
    }

    const right = scratchRight.set(-forward.z, 0, forward.x).normalize();
    scratchTarget.set(
      bx - forward.x * distance * facing + right.x * sideways,
      by + height - forward.y * distance * 0.4 * facing,
      bz - forward.z * distance * facing + right.z * sideways,
    );
    if (!this.cameraReady || this.cameraStyle !== this.lastStyle) {
      this.cameraPosition.copy(scratchTarget);
      this.cameraTarget.set(bx, by, bz);
      this.cameraReady = true;
      this.lastStyle = this.cameraStyle;
    }
    // Frame-rate independent easing: the same feel at 30 or 144 frames a second.
    const ease = 1 - Math.exp(-9 * delta);
    this.cameraPosition.lerp(scratchTarget, ease);
    // Looking ahead down the course while chasing; straight at the ball for
    // any of the replay angles, where the ball is the whole point.
    const ahead = this.cameraStyle === 'chase' ? LOOK_AHEAD : 0.5;
    scratchPosition.set(
      bx + forward.x * ahead,
      by + forward.y * ahead + (this.cameraStyle === 'chase' ? 0.6 : 0.2),
      bz + forward.z * ahead,
    );
    this.cameraTarget.lerp(scratchPosition, 1 - Math.exp(-7 * delta));

    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraTarget);
  }

  /** Releases everything held by the view. */
  dispose(): void {
    this.watcher?.disconnect();
    if (this.courseMesh) disposeCourseMesh(this.courseMesh);
    this.renderer.dispose();
  }
}

/** Which point of the course chain the ball is nearest, for the camera. */
function courseIndexOf(world: World): number {
  const spacing = 2 * ONE;
  return Math.round(world.travelled[0] / spacing);
}
