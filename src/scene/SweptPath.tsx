// Tracks and renders the swept envelope of the car's four body corners.
//
// ─── What is a "swept path"? ───────────────────────────────────────────────
// As the car drives, each of its four corners (front-left, front-right,
// rear-left, rear-right) traces a curve through the world. This module
// records each corner's position once per simulation frame. This produces
// four growing polylines: the colored trail lines. Together they show the
// envelope that the car's body swept through. An optional translucent fill
// shades the area between the trails. This makes the swept footprint easier
// to read at a glance.
//
// ─── Why pre-allocate GPU buffers? ─────────────────────────────────────────
// The GPU draws geometry from flat Float32Arrays of vertex positions. Each
// vertex is an (x, y, z) triple. Allocating a fresh array every frame, and
// uploading it in full, would be expensive. Instead, this module allocates
// one large array up front (MAX_POINTS entries per corner). It fills only the
// used prefix of that array. Two Three.js helpers keep uploads minimal:
//   • setDrawRange(0, n) tells the GPU to draw only the first n points.
//   • addUpdateRange(off, len), plus needsUpdate = true, re-uploads only the
//     handful of floats just written. It does not re-upload the entire
//     20 000-point array.
//
// ─── How is the fill built? ────────────────────────────────────────────────
// GPUs render triangles. This module describes which triangles to draw with
// an *index buffer*: a list of integers, where each integer indexes one
// vertex in the position array. Every three consecutive indices form one
// triangle.
//
// The fill uses a single shared position array. Each "row" holds one frame's
// worth of 4 corner positions (FL, FR, RL, RR, stored consecutively). Between
// any two adjacent rows there is one quad per car edge (front, right, left,
// rear). Each quad splits diagonally into two triangles. Each triangle pair
// forms the ribbon of area that the body's edge swept through in that one
// step. That is 4 edges × 2 triangles × 3 index entries = 24 new indices
// added per frame.
//
// The index buffer grows in place, the same way as the position buffer
// (addUpdateRange + setDrawRange). Only the 24 newest entries get re-uploaded.

import { useImperativeHandle, useMemo, type Ref } from 'react';
import * as THREE from 'three';
import type { BodyCorners } from '@/sim/CarModel.ts';

const CORNER_COLORS: Record<keyof BodyCorners, number> = {
  frontLeft: 0x00e5ff, // cyan
  frontRight: 0xff4081, // pink
  rearLeft: 0x69f0ae, // green
  rearRight: 0xffd740, // amber
};

const CORNER_KEYS: (keyof BodyCorners)[] = [
  'frontLeft',
  'frontRight',
  'rearLeft',
  'rearRight',
];

const MAX_POINTS = 20_000; // Points per corner trail.
const Z = 0.01; // Slightly above the grid.

export interface SweptPathHandle {
  /** Append a new set of corner positions. Call this each frame the car moves. */
  append(corners: BodyCorners): void;
  /** Reset all trails and the fill. */
  clear(): void;
}

// One corner's polyline trail, together with its GPU-side objects.
interface CornerLine {
  geometry: THREE.BufferGeometry;
  /** Flat (x, y, z) vertex array. Only indices [0, count*3) hold valid data. */
  positions: Float32Array;
  /** Number of points written so far. */
  count: number;
  line: THREE.Line;
}

// All GPU objects that one SweptPath instance owns.
interface Buffers {
  lines: Record<keyof BodyCorners, CornerLine>;
  fillGeo: THREE.BufferGeometry;
  /** Flat (x, y, z) vertex array for the fill mesh. 4 vertices per row. */
  fillPositions: Float32Array;
  /** Triangle index list. Each row pair appends 24 new entries. */
  fillIndices: Uint32Array;
  fillMesh: THREE.Mesh;
  /** Number of rows (frames) written to the fill so far. */
  fillCount: number;
}

function createBuffers(): Buffers {
  const lines = {} as Record<keyof BodyCorners, CornerLine>;
  for (const key of CORNER_KEYS) {
    const positions = new Float32Array(MAX_POINTS * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color: CORNER_COLORS[key],
        depthTest: false,
      }),
    );
    line.frustumCulled = false;
    lines[key] = { geometry, positions, count: 0, line };
  }

  // Fill mesh: each row has 4 vertices, one per corner. Successive rows form
  // 4 edge strips of 2 triangles each. That is 24 indices per row pair.
  const fillPositions = new Float32Array(MAX_POINTS * 4 * 3);
  const fillIndices = new Uint32Array((MAX_POINTS - 1) * 24);
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3));
  fillGeo.setIndex(new THREE.BufferAttribute(fillIndices, 1));
  fillGeo.setDrawRange(0, 0);
  const fillMesh = new THREE.Mesh(
    fillGeo,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      opacity: 0.08,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
    }),
  );
  fillMesh.frustumCulled = false;

  return { lines, fillGeo, fillPositions, fillIndices, fillMesh, fillCount: 0 };
}

const INDICES_PER_ROW_PAIR = 24; // 4 edge strips × 2 triangles × 3 verts.

/**
 * Triangulate the four edge strips for the single newest row pair. Grow the
 * draw range to include them. This writes and uploads only the 24 new
 * indices, so the cost stays constant per frame.
 *
 * Terms used below:
 *   "row"      One frame's 4 corner vertices, stored consecutively in the
 *              fill position array. Vertex layout within a row:
 *                rowStart + 0 = FL (front-left)
 *                rowStart + 1 = FR (front-right)
 *                rowStart + 2 = RL (rear-left)
 *                rowStart + 3 = RR (rear-right)
 *   "row pair" Two consecutive rows. Together they form a thin slice of the
 *              swept area. This function tessellates that slice into 8
 *              triangles (4 edges × 2).
 */
function appendFillIndices(buffers: Buffers): void {
  // Index of the older row in this pair. The loop wrote it two frames ago.
  const pairIndex = buffers.fillCount - 2;

  // Base vertex index for the older row and the newer row in this pair.
  const prevRowStart = pairIndex * 4;
  const currRowStart = (pairIndex + 1) * 4;

  // Start position, in the index array, for the 24 new entries.
  let writePos = pairIndex * INDICES_PER_ROW_PAIR;
  const firstIndex = writePos;

  // Each block below covers one car edge. It forms a quad (two triangles)
  // from the four vertices at the corners of that edge in the two rows.
  // Triangle winding is counter-clockwise, the Three.js default front face.

  // Front edge: FL → FR
  buffers.fillIndices[writePos++] = prevRowStart;
  buffers.fillIndices[writePos++] = prevRowStart + 1;
  buffers.fillIndices[writePos++] = currRowStart;
  buffers.fillIndices[writePos++] = prevRowStart + 1;
  buffers.fillIndices[writePos++] = currRowStart + 1;
  buffers.fillIndices[writePos++] = currRowStart;

  // Right edge: FR → RR
  buffers.fillIndices[writePos++] = prevRowStart + 1;
  buffers.fillIndices[writePos++] = prevRowStart + 3;
  buffers.fillIndices[writePos++] = currRowStart + 1;
  buffers.fillIndices[writePos++] = prevRowStart + 3;
  buffers.fillIndices[writePos++] = currRowStart + 3;
  buffers.fillIndices[writePos++] = currRowStart + 1;

  // Left edge: RL → FL
  buffers.fillIndices[writePos++] = prevRowStart + 2;
  buffers.fillIndices[writePos++] = prevRowStart;
  buffers.fillIndices[writePos++] = currRowStart + 2;
  buffers.fillIndices[writePos++] = prevRowStart;
  buffers.fillIndices[writePos++] = currRowStart;
  buffers.fillIndices[writePos++] = currRowStart + 2;

  // Rear edge: RR → RL
  buffers.fillIndices[writePos++] = prevRowStart + 3;
  buffers.fillIndices[writePos++] = prevRowStart + 2;
  buffers.fillIndices[writePos++] = currRowStart + 3;
  buffers.fillIndices[writePos++] = prevRowStart + 2;
  buffers.fillIndices[writePos++] = currRowStart + 2;
  buffers.fillIndices[writePos++] = currRowStart + 3;

  // Re-upload only the 24 entries just written, then extend the draw range.
  const index = buffers.fillGeo.index!;
  index.addUpdateRange(firstIndex, INDICES_PER_ROW_PAIR);
  index.needsUpdate = true;
  buffers.fillGeo.setDrawRange(0, writePos);
}

function append(buffers: Buffers, corners: BodyCorners): void {
  // Grow each corner's polyline trail by one point.
  for (const key of CORNER_KEYS) {
    const trail = buffers.lines[key];
    if (trail.count >= MAX_POINTS) continue;

    const worldX = corners[key][0];
    const worldY = corners[key][1];
    const offset = trail.count * 3; // Offset into the flat position array.
    trail.positions[offset] = worldX;
    trail.positions[offset + 1] = worldY;
    trail.positions[offset + 2] = Z;
    trail.count++;

    // Upload only the 3 floats just written. Do not upload the entire
    // 20 000-point buffer.
    const positionAttr = trail.geometry.attributes[
      'position'
    ] as THREE.BufferAttribute;
    positionAttr.addUpdateRange(offset, 3);
    positionAttr.needsUpdate = true;
    trail.geometry.setDrawRange(0, trail.count);
  }

  // Append a new row of 4 corner positions to the fill mesh. Triangulate the
  // strip that connects it to the previous row.
  if (buffers.fillCount < MAX_POINTS) {
    const offset = buffers.fillCount * 4 * 3; // Start of this row in fillPositions.
    for (let i = 0; i < 4; i++) {
      const worldX = corners[CORNER_KEYS[i]!][0];
      const worldY = corners[CORNER_KEYS[i]!][1];
      buffers.fillPositions[offset + i * 3] = worldX;
      buffers.fillPositions[offset + i * 3 + 1] = worldY;
      buffers.fillPositions[offset + i * 3 + 2] = Z;
    }
    // Upload only the 12 floats just written: 4 corners × 3 components.
    const positionAttr = buffers.fillGeo.attributes[
      'position'
    ] as THREE.BufferAttribute;
    positionAttr.addUpdateRange(offset, 12);
    positionAttr.needsUpdate = true;
    buffers.fillCount++;
    // Forming a triangle strip needs at least two rows.
    if (buffers.fillCount >= 2) appendFillIndices(buffers);
  }
}

function clear(buffers: Buffers): void {
  // Reset draw ranges to 0, so the GPU draws nothing. The underlying arrays
  // stay as-is. The next run overwrites them from the start.
  for (const key of CORNER_KEYS) {
    buffers.lines[key].count = 0;
    buffers.lines[key].geometry.setDrawRange(0, 0);
  }
  buffers.fillCount = 0;
  buffers.fillGeo.setDrawRange(0, 0);
}

export interface SweptPathProps {
  fillVisible: boolean;
  ref?: Ref<SweptPathHandle>;
}

export function SweptPath({
  fillVisible,
  ref,
}: SweptPathProps): React.ReactElement {
  const buffers = useMemo(createBuffers, []);

  useImperativeHandle(
    ref,
    () => ({
      append: (corners) => append(buffers, corners),
      clear: () => clear(buffers),
    }),
    [buffers],
  );

  return (
    <group>
      {CORNER_KEYS.map((key) => (
        <primitive key={key} object={buffers.lines[key].line} />
      ))}
      <primitive object={buffers.fillMesh} visible={fillVisible} />
    </group>
  );
}
