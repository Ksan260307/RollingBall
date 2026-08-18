/**
 * Turns the player's block of cubes into a mesh.
 *
 * Only the sides that are actually visible are built: a cube buried inside
 * the ball contributes nothing. A solid nine-by-nine-by-nine block would be
 * over four thousand faces, but as a ball it comes out around four hundred,
 * which matters on a phone.
 *
 * Each face also remembers which cube it belongs to and which way it points,
 * so the editor can work out what the player just tapped.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from 'three';
import {
  CUBE_METRES,
  PALETTE,
  SHAPE_CENTRE,
  SHAPE_SIZE,
  cellAt,
  cellIndex,
} from '../core/ballShape';

/** Which cube a face belongs to, and which way it faces. */
export interface FaceInfo {
  cell: number;
  x: number;
  y: number;
  z: number;
  /** The direction the face points, as whole steps of -1, 0 or 1. */
  nx: number;
  ny: number;
  nz: number;
}

export interface BallGeometry {
  geometry: BufferGeometry;
  /** One entry per triangle, in the same order as the geometry. */
  faces: FaceInfo[];
}

/** The six directions a cube face can point, with the corner layout for each. */
const DIRECTIONS: {
  normal: [number, number, number];
  corners: [number, number, number][];
  /** Which axes of the cube are used for the picture, and which way round. */
  uAxis: 0 | 1 | 2;
  vAxis: 0 | 1 | 2;
  uFlip: boolean;
  vFlip: boolean;
}[] = [
  {
    normal: [1, 0, 0],
    corners: [
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    uAxis: 2,
    vAxis: 1,
    uFlip: true,
    vFlip: false,
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [0, 0, 1],
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    uAxis: 2,
    vAxis: 1,
    uFlip: false,
    vFlip: false,
  },
  {
    normal: [0, 1, 0],
    corners: [
      [0, 1, 0],
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ],
    uAxis: 0,
    vAxis: 2,
    uFlip: false,
    vFlip: true,
  },
  {
    normal: [0, -1, 0],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 0],
    ],
    uAxis: 0,
    vAxis: 2,
    uFlip: false,
    vFlip: false,
  },
  {
    normal: [0, 0, 1],
    corners: [
      [1, 0, 1],
      [0, 0, 1],
      [0, 1, 1],
      [1, 1, 1],
    ],
    uAxis: 0,
    vAxis: 1,
    uFlip: true,
    vFlip: false,
  },
  {
    normal: [0, 0, -1],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
    uAxis: 0,
    vAxis: 1,
    uFlip: false,
    vFlip: false,
  },
];

const paletteColours = PALETTE.map((hex) => new Color(hex));

/**
 * Builds the mesh for a design.
 *
 * @param voxels the cube slots
 * @param scale how much to stretch the result, where 1 is the standard size
 */
export function buildBallGeometry(voxels: Uint8Array, scale = 1): BallGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colours: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces: FaceInfo[] = [];

  const cube = CUBE_METRES * scale;
  const offset = SHAPE_CENTRE;
  const span = SHAPE_SIZE;

  for (let x = 0; x < SHAPE_SIZE; x++) {
    for (let y = 0; y < SHAPE_SIZE; y++) {
      for (let z = 0; z < SHAPE_SIZE; z++) {
        const slot = voxels[cellIndex(x, y, z)];
        if (slot === 0) continue;
        const colour = paletteColours[slot] ?? paletteColours[8];

        for (const dir of DIRECTIONS) {
          const [nx, ny, nz] = dir.normal;
          if (cellAt(voxels, x + nx, y + ny, z + nz) !== 0) continue;

          const base = positions.length / 3;
          for (const corner of dir.corners) {
            const cx = x + corner[0];
            const cy = y + corner[1];
            const cz = z + corner[2];
            positions.push(
              (cx - offset - 0.5) * cube,
              (cy - offset - 0.5) * cube,
              (cz - offset - 0.5) * cube,
            );
            normals.push(nx, ny, nz);
            colours.push(colour.r, colour.g, colour.b);

            // The photo is laid over the whole ball like a sticker, one copy
            // per side, so it reads the same however the ball is turned.
            const axes = [cx, cy, cz];
            let u = axes[dir.uAxis] / span;
            let v = axes[dir.vAxis] / span;
            if (dir.uFlip) u = 1 - u;
            if (dir.vFlip) v = 1 - v;
            uvs.push(u, v);
          }
          // Wound so the front of each triangle faces out of the ball. Get
          // this backwards and the near side of the ball is culled away,
          // leaving it looking see-through, and a tap aimed at the surface
          // lands on the cube on the far side instead.
          indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
          const info: FaceInfo = { cell: cellIndex(x, y, z), x, y, z, nx, ny, nz };
          faces.push(info, info);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, faces };
}

/**
 * Softens a photo towards white so that the colours painted on the cubes
 * still show through. Doing it once here means the drawing itself stays a
 * plain, fast material.
 */
export function makePhotoTexture(image: HTMLImageElement, strength: number): Texture | null {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return null;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);

  // Fill the square without squashing the picture.
  const ratio = Math.max(size / image.width, size / image.height);
  const drawWidth = image.width * ratio;
  const drawHeight = image.height * ratio;
  context.drawImage(
    image,
    (size - drawWidth) / 2,
    (size - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  const fade = 1 - Math.min(1, Math.max(0, strength));
  if (fade > 0) {
    context.fillStyle = `rgba(255, 255, 255, ${fade})`;
    context.fillRect(0, 0, size, size);
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Loads a picture from a data address, ready for {@link makePhotoTexture}. */
export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('picture could not be read'));
    image.src = source;
  });
}

/** Builds the material used for the ball. */
export function makeBallMaterial(shine: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true,
    roughness: 1 - Math.min(0.85, Math.max(0, shine)),
    metalness: Math.min(0.6, Math.max(0, shine) * 0.5),
    flatShading: true,
  });
}

/** Builds a ready-to-use ball mesh. */
export function buildBallMesh(
  voxels: Uint8Array,
  shine: number,
  scale = 1,
): { mesh: Mesh; faces: FaceInfo[]; material: MeshStandardMaterial } {
  const { geometry, faces } = buildBallGeometry(voxels, scale);
  const material = makeBallMaterial(shine);
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  return { mesh, faces, material };
}
