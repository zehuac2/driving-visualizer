// Manages the Three.js scene: orthographic top-down camera, car mesh, grid,
// fixed-timestep game loop, pan/zoom, and driving simulation.

import * as THREE from 'three';
import { step, createInitialState, getCorners } from '@/sim/CarModel.ts';
import type { CarParams, CarState } from '@/sim/CarModel.ts';
import { attachInput, detachInput, readInput } from '@/sim/input.ts';
import { SweptPath } from './SweptPath.ts';

export interface TelemetryData {
  x: number;
  y: number;
  headingDeg: number;
  steeringDeg: number;
  turningRadius: number;
  speed: number;
  driving: boolean;
}

export type TelemetryCallback = (data: TelemetryData) => void;

const WHEEL_W = 0.22; // visual wheel width (meters)
const WHEEL_L = 0.5; // visual wheel length (meters)

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private animFrame: number | null = null;

  // Car visual objects.
  private carBody: THREE.Mesh;
  private frontLeftWheel: THREE.Mesh;
  private frontRightWheel: THREE.Mesh;
  private rearLeftWheel: THREE.Mesh;
  private rearRightWheel: THREE.Mesh;

  // Direction arrow on the car body.
  private dirArrow: THREE.ArrowHelper;

  // Swept path.
  private sweptPath: SweptPath;

  // State.
  private carState: CarState;
  private params: CarParams;
  private onTelemetry: TelemetryCallback;

  // Timing.
  private lastTime: number | null = null;

  // Camera pan/zoom.
  private viewSize: number = 30; // orthographic half-height in meters
  private panX: number = 0;
  private panY: number = 0;
  private isPanning: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;

  constructor(
    canvas: HTMLCanvasElement,
    params: CarParams,
    onTelemetry: TelemetryCallback,
  ) {
    this.params = params;
    this.carState = createInitialState();
    this.onTelemetry = onTelemetry;

    // Renderer.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x1a1a2e);

    // Scene.
    this.scene = new THREE.Scene();

    // Orthographic top-down camera.
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera = new THREE.OrthographicCamera(
      -this.viewSize * aspect,
      this.viewSize * aspect,
      this.viewSize,
      -this.viewSize,
      0.1,
      1000,
    );
    this.camera.position.set(0, 0, 100);
    this.camera.lookAt(0, 0, 0);

    // Grid.
    const grid = new THREE.GridHelper(200, 200, 0x333355, 0x222244);
    grid.rotation.x = Math.PI / 2; // rotate to XY plane
    this.scene.add(grid);

    // Origin marker (red dot).
    const originDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.1, 16),
      new THREE.MeshBasicMaterial({ color: 0xff3333 }),
    );
    originDot.position.z = 0.005;
    this.scene.add(originDot);

    // Build car visuals.
    this.carBody = this.buildCarBody();
    this.scene.add(this.carBody);

    [
      this.frontLeftWheel,
      this.frontRightWheel,
      this.rearLeftWheel,
      this.rearRightWheel,
    ] = this.buildWheels();

    // Direction arrow.
    const arrowDir = new THREE.Vector3(0, 1, 0);
    const arrowLen = params.wheelbase * 0.4;
    this.dirArrow = new THREE.ArrowHelper(
      arrowDir,
      new THREE.Vector3(0, 0, 0.06),
      arrowLen,
      0xffffff,
      arrowLen * 0.4,
      arrowLen * 0.25,
    );
    this.carBody.add(this.dirArrow);

    // Swept path layer.
    this.sweptPath = new SweptPath(this.scene);

    // Position car visuals for initial state.
    this.updateCarMesh();

    // Attach keyboard.
    attachInput();

    // Window resize.
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();

    // Pan/zoom events on the canvas.
    canvas.addEventListener('wheel', this.onWheel.bind(this), {
      passive: false,
    });
    canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));

    // Start loop.
    this.loop = this.loop.bind(this);
    this.animFrame = requestAnimationFrame(this.loop);
  }

  private buildCarBody(): THREE.Mesh {
    const { wheelbase, frontOverhang, rearOverhang, bodyWidth } = this.params;
    const bodyLength = wheelbase + frontOverhang + rearOverhang;
    const geo = new THREE.PlaneGeometry(bodyWidth, bodyLength);

    // The car body is centered at the car center, but our state anchor is the rear axle.
    // We translate the geometry so that the rear axle sits at local Y=rearOverhang offset
    // (i.e. the rear face is at local Y = -rearOverhang, front face at Y = +wheelbase + frontOverhang).
    const centerOffset = (wheelbase + frontOverhang - rearOverhang) / 2;
    geo.translate(0, centerOffset, 0);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x3a86ff,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = 0.02;

    // Car body outline.
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-bodyWidth / 2, centerOffset - bodyLength / 2, 0.001),
        new THREE.Vector3(bodyWidth / 2, centerOffset - bodyLength / 2, 0.001),
        new THREE.Vector3(bodyWidth / 2, centerOffset + bodyLength / 2, 0.001),
        new THREE.Vector3(-bodyWidth / 2, centerOffset + bodyLength / 2, 0.001),
      ]),
      new THREE.LineBasicMaterial({ color: 0x90caff }),
    );
    mesh.add(outline);

    return mesh;
  }

  private buildWheels(): [THREE.Mesh, THREE.Mesh, THREE.Mesh, THREE.Mesh] {
    const { wheelbase, bodyWidth } = this.params;
    const halfW = bodyWidth / 2;

    function makeWheel(): THREE.Mesh {
      const geo = new THREE.PlaneGeometry(WHEEL_W, WHEEL_L);
      const mat = new THREE.MeshBasicMaterial({ color: 0x222233 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = 0.03;
      // Add a white outline.
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-WHEEL_W / 2, -WHEEL_L / 2, 0.001),
          new THREE.Vector3(WHEEL_W / 2, -WHEEL_L / 2, 0.001),
          new THREE.Vector3(WHEEL_W / 2, WHEEL_L / 2, 0.001),
          new THREE.Vector3(-WHEEL_W / 2, WHEEL_L / 2, 0.001),
        ]),
        new THREE.LineBasicMaterial({ color: 0x667788 }),
      );
      mesh.add(outline);
      return mesh;
    }

    const fl = makeWheel();
    const fr = makeWheel();
    const rl = makeWheel();
    const rr = makeWheel();

    // Rear wheels are children of carBody, positioned relative to rear axle.
    // carBody local origin = rear axle center.
    rl.position.set(-halfW - WHEEL_W / 2, 0, 0);
    rr.position.set(halfW + WHEEL_W / 2, 0, 0);

    // Front wheels positioned at +wheelbase from rear axle.
    fl.position.set(-halfW - WHEEL_W / 2, wheelbase, 0);
    fr.position.set(halfW + WHEEL_W / 2, wheelbase, 0);

    this.carBody.add(fl);
    this.carBody.add(fr);
    this.carBody.add(rl);
    this.carBody.add(rr);

    return [fl, fr, rl, rr];
  }

  /** Update Three.js car mesh from the current car state. */
  private updateCarMesh(): void {
    const { x, y, heading, steeringAngle } = this.carState;

    // Position and heading (heading 0 = +X, Three.js local Y = forward).
    // Heading 0 in our model = pointing along +X. Three.js local +Y is "up" (forward for the car).
    // We rotate by (heading - π/2) to align model +Y with world heading.
    this.carBody.position.set(x, y, 0.02);
    this.carBody.rotation.z = heading - Math.PI / 2;

    // Rotate front wheels by steering angle around Z (local).
    this.frontLeftWheel.rotation.z = steeringAngle;
    this.frontRightWheel.rotation.z = steeringAngle;
  }

  /** Rebuild car body geometry when params change. */
  rebuildCarMesh(): void {
    // Remove old body (children including wheels removed with it).
    this.scene.remove(this.carBody);
    this.carBody = this.buildCarBody();
    this.scene.add(this.carBody);

    [
      this.frontLeftWheel,
      this.frontRightWheel,
      this.rearLeftWheel,
      this.rearRightWheel,
    ] = this.buildWheels();

    const arrowLen = this.params.wheelbase * 0.4;
    this.dirArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0.06),
      arrowLen,
      0xffffff,
      arrowLen * 0.4,
      arrowLen * 0.25,
    );
    this.carBody.add(this.dirArrow);

    this.updateCarMesh();
  }

  private loop(now: number): void {
    this.animFrame = requestAnimationFrame(this.loop);

    const dt =
      this.lastTime === null ? 0 : Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const input = readInput();
    const prevCorners = getCorners(this.carState, this.params);
    this.carState = step(this.carState, this.params, input, dt);

    // Append to swept path only when the car has actually moved.
    const newCorners = getCorners(this.carState, this.params);
    const moved =
      input.throttle !== 0 || Math.abs(this.carState.x - this.carState.x) > 0; // always append when moving

    if (input.throttle !== 0) {
      this.sweptPath.append(newCorners);
    }

    this.updateCarMesh();

    // Camera tracks car with offset.
    const canvas = this.renderer.domElement;
    const aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.left = -this.viewSize * aspect + this.panX;
    this.camera.right = this.viewSize * aspect + this.panX;
    this.camera.top = this.viewSize + this.panY;
    this.camera.bottom = -this.viewSize + this.panY;
    this.camera.updateProjectionMatrix();

    this.renderer.render(this.scene, this.camera);

    // Emit telemetry.
    const tr =
      Math.abs(this.carState.steeringAngle) < 1e-4
        ? Infinity
        : this.params.wheelbase / Math.tan(this.carState.steeringAngle);

    this.onTelemetry({
      x: this.carState.x,
      y: this.carState.y,
      headingDeg: (this.carState.heading * 180) / Math.PI,
      steeringDeg: (this.carState.steeringAngle * 180) / Math.PI,
      turningRadius: tr,
      speed: this.params.speed,
      driving: input.throttle !== 0,
    });
  }

  private handleResize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    this.renderer.setSize(w, h, false);

    const aspect = w / h;
    this.camera.left = -this.viewSize * aspect + this.panX;
    this.camera.right = this.viewSize * aspect + this.panX;
    this.camera.top = this.viewSize + this.panY;
    this.camera.bottom = -this.viewSize + this.panY;
    this.camera.updateProjectionMatrix();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    this.viewSize = Math.max(5, Math.min(200, this.viewSize * factor));
    this.handleResize();
  }

  private onMouseDown(e: MouseEvent): void {
    this.isPanning = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isPanning) return;
    const canvas = this.renderer.domElement;
    const metersPerPx = (this.viewSize * 2) / canvas.clientHeight;
    this.panX -= (e.clientX - this.lastMouseX) * metersPerPx;
    this.panY += (e.clientY - this.lastMouseY) * metersPerPx;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  }

  private onMouseUp(): void {
    this.isPanning = false;
  }

  // Public API for the React UI.

  updateParams(params: CarParams): void {
    const shapeChanged =
      params.wheelbase !== this.params.wheelbase ||
      params.frontOverhang !== this.params.frontOverhang ||
      params.rearOverhang !== this.params.rearOverhang ||
      params.bodyWidth !== this.params.bodyWidth;

    this.params = params;
    if (shapeChanged) this.rebuildCarMesh();
  }

  resetCarPose(): void {
    this.carState = createInitialState();
    this.updateCarMesh();
  }

  clearTraces(): void {
    this.sweptPath.clear();
  }

  centerSteering(): void {
    this.carState = { ...this.carState, steeringAngle: 0 };
  }

  toggleFill(): boolean {
    const next = !this.sweptPath.isFillVisible();
    this.sweptPath.setFillVisible(next);
    return next;
  }

  isFillVisible(): boolean {
    return this.sweptPath.isFillVisible();
  }

  centerCameraOnCar(): void {
    this.panX = this.carState.x;
    this.panY = this.carState.y;
  }

  dispose(): void {
    if (this.animFrame !== null) cancelAnimationFrame(this.animFrame);
    detachInput();
    window.removeEventListener('resize', this.handleResize);
    this.sweptPath.dispose();
    this.renderer.dispose();
  }
}
