/**
 * Turns a course into something you can look at: the floor ribbon, the low
 * walls that keep the ball on, the glowing edges, and the finish banner.
 *
 * The whole course becomes a handful of meshes built once when a run starts.
 * Nothing here is rebuilt while playing, which is what keeps the frame rate
 * steady on phones.
 */

import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { Course, PointFlag, Surface } from '../core/course';
import { ONE } from '../core/fixed';
import { WALL_HEIGHT as WALL_HEIGHT_UNITS } from '../core/simulation';

/** Turns a stored whole number into metres for the drawing code. */
export function toMetres(value: number): number {
  return value / ONE;
}

/**
 * How tall the railings stand, taken straight from the rules so the barrier
 * you can see is exactly the barrier the ball runs into.
 */
const WALL_HEIGHT = WALL_HEIGHT_UNITS / ONE;

/** How far the glowing edge strip reaches inward from the floor edge. */
const EDGE_WIDTH = 0.32;

export interface CourseColours {
  floor: string;
  edge: string;
  ground: string;
}

interface Ribbon {
  positions: number[];
  normals: number[];
  colours: number[];
  indices: number[];
}

function emptyRibbon(): Ribbon {
  return { positions: [], normals: [], colours: [], indices: [] };
}

function pushVertex(
  ribbon: Ribbon,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  colour: Color,
): number {
  const index = ribbon.positions.length / 3;
  ribbon.positions.push(x, y, z);
  ribbon.normals.push(nx, ny, nz);
  ribbon.colours.push(colour.r, colour.g, colour.b);
  return index;
}

function pushQuad(ribbon: Ribbon, a: number, b: number, c: number, d: number): void {
  ribbon.indices.push(a, b, d, b, c, d);
}

function finishGeometry(ribbon: Ribbon): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(ribbon.positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(ribbon.normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(ribbon.colours), 3));
  geometry.setIndex(ribbon.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Colours used for the different floor materials, as a hint to the player. */
function floorTint(base: Color, surface: number, striped: boolean): Color {
  const colour = base.clone();
  switch (surface) {
    case Surface.Slick:
      colour.lerp(new Color('#a8e8ff'), 0.55);
      break;
    case Surface.Rough:
      colour.lerp(new Color('#b08968'), 0.5);
      break;
    case Surface.Boost:
      colour.lerp(new Color('#ffd166'), 0.6);
      break;
    default:
      break;
  }
  // Alternating bands give a strong sense of speed without any texture.
  if (striped) colour.multiplyScalar(0.9);
  return colour;
}

/**
 * Only part of a course, in metres along it.
 *
 * Used for the second way down at a fork. Both ways are the same course
 * with a stretch swapped out, so drawing both of them whole puts two
 * identical floors in exactly the same place — which does not look like two
 * roads, it looks like one road flickering. Only the stretch that differs
 * is drawn for the second way; the shared parts are already there.
 */
export interface CourseStretch {
  /** Where to start drawing, in metres along the course. */
  from: number;
  /** Where to stop, in metres along the course. */
  to: number;
  /**
   * Drawn in front of anything else that is in the same place.
   *
   * Two roads that meet at a junction share floor for the few metres it
   * takes them to get apart — they leave the same point, so they must. Left
   * to themselves the two floors fight over which is nearer the eye and the
   * junction tears itself to pieces as the camera moves. Saying which one
   * wins settles it, and settles it the same way from every angle.
   */
  inFront?: boolean;
  /**
   * Where this stretch's railings may be built, if not the whole of it.
   *
   * A floor may lie inside another floor and be none the worse for it —
   * one simply hides the other. A railing may not. It stands up out of the
   * ground, so a railing built where two roads overlap is a fence running
   * down the middle of the other road, which is what a fork must never look
   * like. So the road is drawn from where it starts to show and its
   * railings only from where it is out on its own.
   */
  railsFrom?: number;
  railsTo?: number;
}

/**
 * Builds every piece of the course.
 * @param only draw just this stretch of it, or all of it where left out
 * @returns a group ready to be added to the scene
 */
export function buildCourseMesh(
  course: Course,
  colours: CourseColours,
  only: CourseStretch | null = null,
): Group {
  const group = new Group();
  group.name = 'course';

  const baseFloor = new Color(colours.floor);
  const edgeColour = new Color(colours.edge);
  const underside = new Color(colours.floor).multiplyScalar(0.45);

  const floor = emptyRibbon();
  const edges = emptyRibbon();
  const walls = emptyRibbon();
  const skirt = emptyRibbon();

  let previousFloor: [number, number, number, number] | null = null;
  let previousEdgeLeft: [number, number] | null = null;
  let previousEdgeRight: [number, number] | null = null;
  let previousWall: [number, number, number, number] | null = null;
  let previousSkirtLeft: [number, number] | null = null;
  let previousSkirtRight: [number, number] | null = null;

  for (let i = 0; i < course.count; i++) {
    if (only) {
      const along = toMetres(course.distance[i]);
      // The junction points themselves are kept, so this stretch meets the
      // road it leaves and the road it comes back to rather than floating.
      if (along < only.from || along > only.to) {
        previousFloor = null;
        previousEdgeLeft = null;
        previousEdgeRight = null;
        previousWall = null;
        previousSkirtLeft = null;
        previousSkirtRight = null;
        continue;
      }
    }
    const missing = (course.flags[i] & PointFlag.Gap) !== 0;
    const hasWalls = (course.flags[i] & PointFlag.Walls) !== 0;
    // At a junction the wall is left off on the side the other road is on,
    // so the way in is a way in rather than a railing.
    const openLeft = (course.flags[i] & PointFlag.OpenLeft) !== 0;
    const openRight = (course.flags[i] & PointFlag.OpenRight) !== 0;
    const striped = (i & 1) === 0;

    const cx = toMetres(course.x[i]);
    const cy = toMetres(course.y[i]);
    const cz = toMetres(course.z[i]);
    const rx = toMetres(course.rightX[i]);
    const ry = toMetres(course.rightY[i]);
    const rz = toMetres(course.rightZ[i]);
    const ux = toMetres(course.upX[i]);
    const uy = toMetres(course.upY[i]);
    const uz = toMetres(course.upZ[i]);
    const half = toMetres(course.halfWidth[i]);

    const tint = floorTint(baseFloor, course.surface[i], striped);
    const inner = half - EDGE_WIDTH;

    // Floor: from the inner left edge to the inner right edge.
    const leftX = cx - rx * inner;
    const leftY = cy - ry * inner;
    const leftZ = cz - rz * inner;
    const rightXp = cx + rx * inner;
    const rightYp = cy + ry * inner;
    const rightZp = cz + rz * inner;

    const a = pushVertex(floor, leftX, leftY, leftZ, ux, uy, uz, tint);
    const b = pushVertex(floor, rightXp, rightYp, rightZp, ux, uy, uz, tint);
    if (previousFloor && !missing) {
      pushQuad(floor, previousFloor[0], previousFloor[1], b, a);
    }
    previousFloor = [a, b, 0, 0];

    // Glowing strips along both edges.
    const outerLeftX = cx - rx * half;
    const outerLeftY = cy - ry * half;
    const outerLeftZ = cz - rz * half;
    const outerRightX = cx + rx * half;
    const outerRightY = cy + ry * half;
    const outerRightZ = cz + rz * half;

    const el = pushVertex(edges, leftX, leftY, leftZ, ux, uy, uz, edgeColour);
    const elo = pushVertex(edges, outerLeftX, outerLeftY, outerLeftZ, ux, uy, uz, edgeColour);
    const er = pushVertex(edges, rightXp, rightYp, rightZp, ux, uy, uz, edgeColour);
    const ero = pushVertex(edges, outerRightX, outerRightY, outerRightZ, ux, uy, uz, edgeColour);
    if (previousEdgeLeft && previousEdgeRight && !missing) {
      pushQuad(edges, previousEdgeLeft[0], previousEdgeLeft[1], elo, el);
      pushQuad(edges, previousEdgeRight[1], previousEdgeRight[0], er, ero);
    }
    previousEdgeLeft = [el, elo];
    previousEdgeRight = [er, ero];

    const along = toMetres(course.distance[i]);
    const railsHere =
      (only?.railsFrom === undefined || along >= only.railsFrom) &&
      (only?.railsTo === undefined || along <= only.railsTo);

    // Low walls, where the course has them and nothing else is there.
    if (hasWalls && railsHere && !(openLeft && openRight)) {
      const topLeftX = outerLeftX + ux * WALL_HEIGHT;
      const topLeftY = outerLeftY + uy * WALL_HEIGHT;
      const topLeftZ = outerLeftZ + uz * WALL_HEIGHT;
      const topRightX = outerRightX + ux * WALL_HEIGHT;
      const topRightY = outerRightY + uy * WALL_HEIGHT;
      const topRightZ = outerRightZ + uz * WALL_HEIGHT;
      const wl = pushVertex(walls, outerLeftX, outerLeftY, outerLeftZ, rx, ry, rz, edgeColour);
      const wlt = pushVertex(walls, topLeftX, topLeftY, topLeftZ, rx, ry, rz, tint);
      const wr = pushVertex(walls, outerRightX, outerRightY, outerRightZ, -rx, -ry, -rz, edgeColour);
      const wrt = pushVertex(walls, topRightX, topRightY, topRightZ, -rx, -ry, -rz, tint);
      if (previousWall && !missing) {
        if (!openLeft) pushQuad(walls, previousWall[0], previousWall[1], wlt, wl);
        if (!openRight) pushQuad(walls, previousWall[3], previousWall[2], wr, wrt);
      }
      previousWall = [wl, wlt, wr, wrt];
    } else {
      previousWall = null;
    }

    // A shallow wedge below the floor, so the course reads as solid rather
    // than as a sheet of paper when seen from the side or from underneath.
    const keelX = cx - ux * 0.55;
    const keelY = cy - uy * 0.55;
    const keelZ = cz - uz * 0.55;
    const sl = pushVertex(skirt, outerLeftX, outerLeftY, outerLeftZ, -ux, -uy, -uz, underside);
    const sk = pushVertex(skirt, keelX, keelY, keelZ, -ux, -uy, -uz, underside);
    const sr = pushVertex(skirt, outerRightX, outerRightY, outerRightZ, -ux, -uy, -uz, underside);
    if (previousSkirtLeft && previousSkirtRight && !missing) {
      pushQuad(skirt, previousSkirtLeft[0], previousSkirtLeft[1], sk, sl);
      pushQuad(skirt, previousSkirtRight[1], previousSkirtRight[0], sr, sk);
    }
    previousSkirtLeft = [sl, sk];
    previousSkirtRight = [sr, sk];
  }

  const floorMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.05,
    side: DoubleSide,
  });
  const edgeMaterial = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
  const wallMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.6,
    metalness: 0.1,
    side: DoubleSide,
  });
  const skirtMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    side: BackSide,
  });

  if (only?.inFront) {
    // Nudged towards the eye when the depth is worked out, not in space, so
    // the floor is exactly where the ball rolls and only the argument over
    // what is nearer is settled.
    for (const material of [floorMaterial, edgeMaterial, wallMaterial, skirtMaterial]) {
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -2;
    }
  }

  group.add(new Mesh(finishGeometry(floor), floorMaterial));
  group.add(new Mesh(finishGeometry(edges), edgeMaterial));
  group.add(new Mesh(finishGeometry(walls), wallMaterial));
  group.add(new Mesh(finishGeometry(skirt), skirtMaterial));
  return group;
}

/** Frees everything a course mesh was holding on to. */
export function disposeCourseMesh(group: Group): void {
  group.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const material = child.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
    }
  });
}
