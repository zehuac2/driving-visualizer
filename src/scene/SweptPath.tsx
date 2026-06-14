// Tracks and renders the swept envelope of the car's four body corners: four
// growing polylines (one per corner) plus an optional translucent fill between
// successive corner quads. Buffers are pre-allocated once and grown in place
// via setDrawRange. The simulation loop drives growth through the imperative
// handle (append/clear); fill visibility is a declarative prop.

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

interface CornerLine {
  geo: THREE.BufferGeometry;
  positions: Float32Array;
  count: number;
  line: THREE.Line;
}

interface Buffers {
  lines: Record<keyof BodyCorners, CornerLine>;
  fillGeo: THREE.BufferGeometry;
  fillPositions: Float32Array;
  fillIndices: Uint32Array;
  fillMesh: THREE.Mesh;
  fillCount: number;
}

function createBuffers(): Buffers {
  const lines = {} as Record<keyof BodyCorners, CornerLine>;
  for (const key of CORNER_KEYS) {
    const positions = new Float32Array(MAX_POINTS * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: CORNER_COLORS[key],
        depthTest: false,
      }),
    );
    line.frustumCulled = false;
    lines[key] = { geo, positions, count: 0, line };
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
 * Triangulate the four edge strips for the single newest row pair (the rows
 * `b.fillCount - 2` and `b.fillCount - 1`) and grow the draw range. Only the 24
 * new indices are written/uploaded — O(1) per frame, not a full rebuild.
 */
function appendFillIndices(b: Buffers): void {
  // Vertices per row: 0=FL, 1=FR, 2=RL, 3=RR.
  const pair = b.fillCount - 2; // index of the new row pair
  const a = pair * 4; // row `pair`
  const c = (pair + 1) * 4; // row `pair + 1`
  let idx = pair * INDICES_PER_ROW_PAIR;
  const start = idx;

  // Front edge FL→FR.
  b.fillIndices[idx++] = a;
  b.fillIndices[idx++] = a + 1;
  b.fillIndices[idx++] = c;
  b.fillIndices[idx++] = a + 1;
  b.fillIndices[idx++] = c + 1;
  b.fillIndices[idx++] = c;

  // Right edge FR→RR.
  b.fillIndices[idx++] = a + 1;
  b.fillIndices[idx++] = a + 3;
  b.fillIndices[idx++] = c + 1;
  b.fillIndices[idx++] = a + 3;
  b.fillIndices[idx++] = c + 3;
  b.fillIndices[idx++] = c + 1;

  // Left edge RL→FL.
  b.fillIndices[idx++] = a + 2;
  b.fillIndices[idx++] = a;
  b.fillIndices[idx++] = c + 2;
  b.fillIndices[idx++] = a;
  b.fillIndices[idx++] = c;
  b.fillIndices[idx++] = c + 2;

  // Rear edge RR→RL.
  b.fillIndices[idx++] = a + 3;
  b.fillIndices[idx++] = a + 2;
  b.fillIndices[idx++] = c + 3;
  b.fillIndices[idx++] = a + 2;
  b.fillIndices[idx++] = c + 2;
  b.fillIndices[idx++] = c + 3;

  const index = b.fillGeo.index!;
  index.addUpdateRange(start, INDICES_PER_ROW_PAIR);
  index.needsUpdate = true;
  b.fillGeo.setDrawRange(0, idx);
}

function append(b: Buffers, corners: BodyCorners): void {
  for (const key of CORNER_KEYS) {
    const d = b.lines[key];
    if (d.count >= MAX_POINTS) continue;
    const [wx, wy] = corners[key];
    const base = d.count * 3;
    d.positions[base] = wx;
    d.positions[base + 1] = wy;
    d.positions[base + 2] = Z;
    d.count++;
    // Upload only the 3 floats just written, not the whole 20k-point buffer.
    const attr = d.geo.attributes['position'] as THREE.BufferAttribute;
    attr.addUpdateRange(base, 3);
    attr.needsUpdate = true;
    d.geo.setDrawRange(0, d.count);
  }

  if (b.fillCount < MAX_POINTS) {
    const base = b.fillCount * 4 * 3;
    for (let i = 0; i < 4; i++) {
      const [wx, wy] = corners[CORNER_KEYS[i]!];
      b.fillPositions[base + i * 3] = wx;
      b.fillPositions[base + i * 3 + 1] = wy;
      b.fillPositions[base + i * 3 + 2] = Z;
    }
    // Upload only the 12 floats (4 corners) just written.
    const attr = b.fillGeo.attributes['position'] as THREE.BufferAttribute;
    attr.addUpdateRange(base, 12);
    attr.needsUpdate = true;
    b.fillCount++;
    if (b.fillCount >= 2) appendFillIndices(b);
  }
}

function clear(b: Buffers): void {
  for (const key of CORNER_KEYS) {
    b.lines[key].count = 0;
    b.lines[key].geo.setDrawRange(0, 0);
  }
  b.fillCount = 0;
  b.fillGeo.setDrawRange(0, 0);
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
