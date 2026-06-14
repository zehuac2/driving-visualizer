// Tracks and renders the swept envelope of the car's four body corners.
// Four growing polylines (one per corner) plus an optional translucent fill
// between successive corner quads.

import * as THREE from 'three';
import type { BodyCorners } from '../sim/CarModel.ts';

const CORNER_COLORS = {
  frontLeft: 0x00e5ff, // cyan
  frontRight: 0xff4081, // pink
  rearLeft: 0x69f0ae, // green
  rearRight: 0xffd740, // amber
};

const MAX_POINTS = 20_000; // per corner trail

export class SweptPath {
  private group: THREE.Group;

  // Per-corner line geometry.
  private lines: Record<
    keyof BodyCorners,
    {
      geo: THREE.BufferGeometry;
      positions: Float32Array;
      count: number;
      line: THREE.Line;
    }
  >;

  // Filled envelope mesh (triangle strip joining successive corner quads).
  private fillGeo: THREE.BufferGeometry;
  private fillPositions: Float32Array;
  private fillIndices: Uint32Array;
  private fillMesh: THREE.Mesh;
  private fillCount: number = 0; // number of corner-quad rows stored

  private showFill: boolean = true;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // Build per-corner trailing lines.
    const corners = [
      'frontLeft',
      'frontRight',
      'rearLeft',
      'rearRight',
    ] as const;
    this.lines = {} as typeof this.lines;

    for (const key of corners) {
      const positions = new Float32Array(MAX_POINTS * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);

      const mat = new THREE.LineBasicMaterial({
        color: CORNER_COLORS[key],
        linewidth: 1,
        depthTest: false,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.group.add(line);

      this.lines[key] = { geo, positions, count: 0, line };
    }

    // Fill mesh — pre-allocate for the maximum number of quads.
    // Each row has 4 vertices (one per corner). Successive rows form 2 tris per edge.
    // We have 4 edges (FL-FR top, FR-RR right, RR-RL bottom, RL-FL left) per quad pair.
    this.fillPositions = new Float32Array(MAX_POINTS * 4 * 3);
    this.fillGeo = new THREE.BufferGeometry();
    this.fillGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(this.fillPositions, 3),
    );

    // Pre-build index buffer for triangle strips between rows.
    // Row i has vertices [4i+0, 4i+1, 4i+2, 4i+3] = [FL, FR, RL, RR].
    // Between rows i and i+1, fill the quad with 2 tris per lateral side.
    // Full fill: use two triangle fans per row pair covering the quad outline.
    // Simpler: fan from row i's centroid — but just do a convex hull per pair.
    // We'll index lazily via dynamic index buffer instead.
    this.fillIndices = new Uint32Array((MAX_POINTS - 1) * 12); // 4 tris * 3 verts per row-pair edge pair

    this.fillGeo.setIndex(new THREE.BufferAttribute(this.fillIndices, 1));
    this.fillGeo.setDrawRange(0, 0);

    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      opacity: 0.08,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.fillMesh = new THREE.Mesh(this.fillGeo, fillMat);
    this.fillMesh.frustumCulled = false;
    this.group.add(this.fillMesh);
  }

  /** Append a new set of corner positions (call each frame the car moves). */
  append(corners: BodyCorners): void {
    const cornerKeys: (keyof BodyCorners)[] = [
      'frontLeft',
      'frontRight',
      'rearLeft',
      'rearRight',
    ];
    const Z = 0.01; // slightly above grid

    for (const key of cornerKeys) {
      const d = this.lines[key];
      if (d.count >= MAX_POINTS) continue;

      const [wx, wy] = corners[key];
      const base = d.count * 3;
      d.positions[base] = wx;
      d.positions[base + 1] = wy;
      d.positions[base + 2] = Z;
      d.count++;
      d.geo.attributes['position']!.needsUpdate = true;
      d.geo.setDrawRange(0, d.count);
    }

    // Fill quad row.
    if (this.fillCount < MAX_POINTS) {
      const row = this.fillCount;
      const base = row * 4 * 3;
      const pts = cornerKeys.map((k) => corners[k]);
      for (let i = 0; i < 4; i++) {
        const [wx, wy] = pts[i]!;
        this.fillPositions[base + i * 3] = wx;
        this.fillPositions[base + i * 3 + 1] = wy;
        this.fillPositions[base + i * 3 + 2] = Z;
      }
      this.fillGeo.attributes['position']!.needsUpdate = true;
      this.fillCount++;

      // Build index for the new row pair (need at least 2 rows).
      if (this.fillCount >= 2) {
        this.rebuildFillIndices();
      }
    }
  }

  private rebuildFillIndices(): void {
    // Vertices per row: 0=FL, 1=FR, 2=RL, 3=RR
    // For rows i and i+1 we create the quad outline as 4 triangulated strips:
    //   FL(i)-FR(i)-FR(i+1)-FL(i+1)  => 2 tris (top edge)
    //   FR(i)-RR(i)-RR(i+1)-FR(i+1)  => 2 tris (right edge)
    //   RR(i)-RL(i)-RL(i+1)-RR(i+1)  => 2 tris (bottom edge)
    //   RL(i)-FL(i)-FL(i+1)-RL(i+1)  => 2 tris (left edge)
    // But to fill the interior too we fan from row i's four corners.
    // Simplest correct approach: per row-pair, triangulate the convex hull of 8 points.
    // Easiest implementation: treat each row-pair as 2 triangles per side strip + fill interior.
    // We'll do: 4 side quads (each → 2 tri) + interior fan (2 tri connecting diagonals).
    const n = this.fillCount - 1; // number of row pairs
    let idxCursor = 0;

    for (let i = 0; i < n; i++) {
      const a = i * 4; // row i:   FL=a+0, FR=a+1, RL=a+2, RR=a+3
      const b = (i + 1) * 4; // row i+1: FL=b+0, FR=b+1, RL=b+2, RR=b+3

      // Fill the full quadrilateral between the two rows as one convex polygon.
      // The 4 outline corners are: FL(i), FR(i), RR(i), RL(i) (row i box)
      // and FL(i+1), FR(i+1), RR(i+1), RL(i+1) (row i+1 box).
      // We use a simple 6-triangle fan covering the difference strip + interiors.

      // Side strip FL→FR (front edge between rows)
      this.fillIndices[idxCursor++] = a; // FL(i)
      this.fillIndices[idxCursor++] = a + 1; // FR(i)
      this.fillIndices[idxCursor++] = b; // FL(i+1)

      this.fillIndices[idxCursor++] = a + 1; // FR(i)
      this.fillIndices[idxCursor++] = b + 1; // FR(i+1)
      this.fillIndices[idxCursor++] = b; // FL(i+1)

      // Side strip FR→RR (right edge)
      this.fillIndices[idxCursor++] = a + 1; // FR(i)
      this.fillIndices[idxCursor++] = a + 3; // RR(i)
      this.fillIndices[idxCursor++] = b + 1; // FR(i+1)

      this.fillIndices[idxCursor++] = a + 3; // RR(i)
      this.fillIndices[idxCursor++] = b + 3; // RR(i+1)
      this.fillIndices[idxCursor++] = b + 1; // FR(i+1)

      // Side strip RL→FL (left edge)
      this.fillIndices[idxCursor++] = a + 2; // RL(i)
      this.fillIndices[idxCursor++] = a; // FL(i)
      this.fillIndices[idxCursor++] = b + 2; // RL(i+1)

      this.fillIndices[idxCursor++] = a; // FL(i)
      this.fillIndices[idxCursor++] = b; // FL(i+1)
      this.fillIndices[idxCursor++] = b + 2; // RL(i+1)

      // Side strip RR→RL (rear edge)
      this.fillIndices[idxCursor++] = a + 3; // RR(i)
      this.fillIndices[idxCursor++] = a + 2; // RL(i)
      this.fillIndices[idxCursor++] = b + 3; // RR(i+1)

      this.fillIndices[idxCursor++] = a + 2; // RL(i)
      this.fillIndices[idxCursor++] = b + 2; // RL(i+1)
      this.fillIndices[idxCursor++] = b + 3; // RR(i+1)
    }

    this.fillGeo.index!.needsUpdate = true;
    this.fillGeo.setDrawRange(0, idxCursor);
    this.fillMesh.visible = this.showFill;
  }

  setFillVisible(v: boolean): void {
    this.showFill = v;
    this.fillMesh.visible = v && this.fillCount >= 2;
  }

  isFillVisible(): boolean {
    return this.showFill;
  }

  clear(): void {
    const corners = [
      'frontLeft',
      'frontRight',
      'rearLeft',
      'rearRight',
    ] as const;
    for (const key of corners) {
      this.lines[key]!.count = 0;
      this.lines[key]!.geo.setDrawRange(0, 0);
    }
    this.fillCount = 0;
    this.fillGeo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    const corners = [
      'frontLeft',
      'frontRight',
      'rearLeft',
      'rearRight',
    ] as const;
    for (const key of corners) {
      this.lines[key]!.geo.dispose();
    }
    this.fillGeo.dispose();
  }
}
