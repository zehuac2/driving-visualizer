// Tracks and renders the swept envelope of the car's four body corners.
//
// ─── What is a "swept path"? ───────────────────────────────────────────────
// As the car drives, each of its four corners (front-left, front-right,
// rear-left, rear-right) traces a curve through the world. Recording every
// corner's position once per simulation frame produces four growing polylines —
// the colored trail lines — that together visualise the envelope the car's body
// swept through. An optional translucent fill shades the area between the trails
// to make the swept footprint easier to read at a glance.
//
// ─── Why pre-allocate GPU buffers? ─────────────────────────────────────────
// The GPU draws geometry from flat Float32Arrays of vertex positions packed as
// (x, y, z) triples. Allocating a fresh array every frame and uploading it in
// full would be expensive. Instead we allocate one large array up front
// (MAX_POINTS entries per corner) and only fill the used prefix. Two Three.js
// helpers keep uploads minimal:
//   • setDrawRange(0, n)      — tells the GPU to draw only the first n points.
//   • addUpdateRange(off, len) + needsUpdate = true
//                             — re-uploads only the handful of floats we just
//                               wrote rather than the entire 20 000-point array.
//
// ─── How is the fill built? ────────────────────────────────────────────────
// GPUs render triangles. We describe which triangles to draw via an *index
// buffer*: a list of integers, each indexing one vertex in the position array.
// Every three consecutive indices form one triangle.
//
// The fill uses a single shared position array. Each "row" is one frame's
// worth of 4 corner positions (FL, FR, RL, RR stored consecutively). Between
// any two adjacent rows we have a quad per car edge (front, right, left, rear),
// and each quad is split diagonally into two triangles — the ribbon of area the
// body's edge swept through in that one step. That's 4 edges × 2 triangles ×
// 3 index entries = 24 new indices added per frame.
//
// The index buffer is grown in place the same way as the position buffer
// (addUpdateRange + setDrawRange) so only the 24 newest entries are re-uploaded.

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

const MAX_POINTS = 20_000; // per corner trail
const Z = 0.01; // slightly above the grid

export interface SweptPathHandle {
  /** Append a new set of corner positions (call each frame the car moves). */
  append(corners: BodyCorners): void;
  /** Reset all trails and the fill. */
  clear(): void;
}

// One corner's polyline trail together with its GPU-side objects.
interface CornerLine {
  geometry: THREE.BufferGeometry;
  /** Flat (x, y, z) vertex array; only indices [0, count*3) are valid data. */
  positions: Float32Array;
  /** Number of points written so far. */
  count: number;
  line: THREE.Line;
}

// All GPU objects owned by one SweptPath instance.
interface Buffers {
  lines: Record<keyof BodyCorners, CornerLine>;
  fillGeo: THREE.BufferGeometry;
  /** Flat (x, y, z) vertex array for the fill mesh; 4 vertices per row. */
  fillPositions: Float32Array;
  /** Triangle index list; 24 new entries are appended per row pair. */
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

  // Fill mesh: each row has 4 vertices (one per corner); successive rows form
  // 4 edge strips of 2 triangles each → 24 indices per row pair.
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

const INDICES_PER_ROW_PAIR = 24; // 4 edge strips × 2 triangles × 3 verts

/**
 * Triangulate the four edge strips for the single newest row pair and grow the
 * draw range. Only the 24 new indices are written/uploaded — O(1) per frame.
 *
 * Terminology used below:
 *   "row"      — one frame's 4 corner vertices stored consecutively in the
 *                fill position array. Vertex layout within a row:
 *                  rowStart + 0 = FL (front-left)
 *                  rowStart + 1 = FR (front-right)
 *                  rowStart + 2 = RL (rear-left)
 *                  rowStart + 3 = RR (rear-right)
 *   "row pair" — two consecutive rows; together they form a thin slice of the
 *                swept area that we tessellate into 8 triangles (4 edges × 2).
 */
function appendFillIndices(buffers: Buffers): void {
  // Index of the older row in this pair (the one written two frames ago).
  const pairIndex = buffers.fillCount - 2;

  // Base vertex index for the previous (older) row and the current (newer) row.
  const prevRowStart = pairIndex * 4;
  const currRowStart = (pairIndex + 1) * 4;

  // Where in the index array to start writing the 24 new entries.
  let writePos = pairIndex * INDICES_PER_ROW_PAIR;
  const firstIndex = writePos;

  // Each block below covers one car edge, forming a quad (two triangles) from
  // the four vertices at the corners of that edge in the two rows.
  // Triangle winding is counter-clockwise (Three.js default front face).

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

  // Re-upload only the 24 entries we just wrote, then extend the draw range.
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
    const offset = trail.count * 3; // byte offset into the flat position array
    trail.positions[offset] = worldX;
    trail.positions[offset + 1] = worldY;
    trail.positions[offset + 2] = Z;
    trail.count++;

    // Upload only the 3 floats just written — not the entire 20 k-point buffer.
    const positionAttr = trail.geometry.attributes[
      'position'
    ] as THREE.BufferAttribute;
    positionAttr.addUpdateRange(offset, 3);
    positionAttr.needsUpdate = true;
    trail.geometry.setDrawRange(0, trail.count);
  }

  // Append a new row of 4 corner positions to the fill mesh and triangulate
  // the strip connecting it to the previous row.
  if (buffers.fillCount < MAX_POINTS) {
    const offset = buffers.fillCount * 4 * 3; // start of this row in fillPositions
    for (let i = 0; i < 4; i++) {
      const worldX = corners[CORNER_KEYS[i]!][0];
      const worldY = corners[CORNER_KEYS[i]!][1];
      buffers.fillPositions[offset + i * 3] = worldX;
      buffers.fillPositions[offset + i * 3 + 1] = worldY;
      buffers.fillPositions[offset + i * 3 + 2] = Z;
    }
    // Upload only the 12 floats (4 corners × 3 components) just written.
    const positionAttr = buffers.fillGeo.attributes[
      'position'
    ] as THREE.BufferAttribute;
    positionAttr.addUpdateRange(offset, 12);
    positionAttr.needsUpdate = true;
    buffers.fillCount++;
    // We need at least two rows before we can form a triangle strip.
    if (buffers.fillCount >= 2) appendFillIndices(buffers);
  }
}

function clear(buffers: Buffers): void {
  // Reset draw ranges to 0 — the GPU will draw nothing. The underlying arrays
  // are left as-is; they will be overwritten from the start on the next run.
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
