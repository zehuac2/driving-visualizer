// Owns the R3F scene graph and the single per-frame simulation loop. Physics
// state lives in refs. useFrame advances it. It never lives in React state.
// The loop mutates the Three.js objects directly each frame. Rendering is
// on-demand: the loop calls invalidate() only while the car or its steering
// is still changing. When nothing moves, the canvas goes idle.

import { memo, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrthographicCamera, MapControls } from '@react-three/drei';
import {
  step,
  getCorners,
  createInitialState,
  turningRadius,
} from '@/sim/CarModel.ts';
import type { CarParams, CarState } from '@/sim/CarModel.ts';
import { useKeyboardInput } from '@/sim/useKeyboardInput.ts';
import { Car } from './Car.tsx';
import { SweptPath, type SweptPathHandle } from './SweptPath.tsx';

export interface TelemetryData {
  x: number;
  y: number;
  headingDeg: number;
  steeringDeg: number;
  turningRadius: number;
  speed: number;
  driving: boolean;
}

/** Imperative actions the toolbar drives from outside the Canvas. */
export interface SceneHandle {
  reset(): void;
  clearTraces(): void;
  centerSteering(): void;
  centerCamera(): void;
}

export interface SceneProps {
  params: CarParams;
  fillVisible: boolean;
  onTelemetry: (data: TelemetryData) => void;
  ref?: Ref<SceneHandle>;
}

const INITIAL_HALF_HEIGHT = 30; // Visible half-height, in meters, at default zoom.
const TELEMETRY_INTERVAL_MS = 66; // About 15 Hz panel updates.
const STEERING_EPS = 1e-4;

// Scene is memoized. This stops the ~15 Hz telemetry-driven App re-render
// from reconciling the whole R3F subtree. Scene's props stay referentially
// stable across those ticks.
export const Scene = memo(function Scene({
  params,
  fillVisible,
  onTelemetry,
  ref,
}: SceneProps): React.ReactElement {
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // Shared mutable state. This never triggers React re-renders.
  const carStateRef = useRef<CarState>(createInitialState());
  const carGroupRef = useRef<THREE.Group>(null);
  const frontLeftRef = useRef<THREE.Object3D>(null);
  const frontRightRef = useRef<THREE.Object3D>(null);
  const sweptPathRef = useRef<SweptPathHandle>(null);
  const controlsRef = useRef<React.ComponentRef<typeof MapControls>>(null);
  const lastTelemetryRef = useRef(0);

  const { readInput } = useKeyboardInput(invalidate);

  // Map the old [5, 200] m view-size range onto orthographic zoom. This is
  // captured from the first measured viewport, so resizing does not reset
  // the user's zoom.
  const { initialZoom, minZoom, maxZoom } = useMemo(() => {
    const z = Math.max(1, size.height) / (2 * INITIAL_HALF_HEIGHT);
    return {
      initialZoom: z,
      minZoom: z * (INITIAL_HALF_HEIGHT / 200),
      maxZoom: z * (INITIAL_HALF_HEIGHT / 5),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        carStateRef.current = createInitialState();
        invalidate();
      },
      clearTraces() {
        sweptPathRef.current?.clear();
        invalidate();
      },
      centerSteering() {
        carStateRef.current = { ...carStateRef.current, steeringAngle: 0 };
        invalidate();
      },
      centerCamera() {
        const { x, y } = carStateRef.current;
        const controls = controlsRef.current;
        if (controls) {
          controls.target.set(x, y, 0);
          camera.position.set(x, y, 100);
          controls.update();
        }
        invalidate();
      },
    }),
    [invalidate, camera],
  );

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const input = readInput();
    const next = step(carStateRef.current, params, input, dt);
    carStateRef.current = next;

    if (input.throttle !== 0) {
      sweptPathRef.current?.append(getCorners(next, params));
    }

    // Position the car. heading 0 means +X. Local +Y is forward, so rotate -90°.
    const group = carGroupRef.current;
    if (group) {
      group.position.set(next.x, next.y, 0.02);
      group.rotation.z = next.heading - Math.PI / 2;
    }
    if (frontLeftRef.current)
      frontLeftRef.current.rotation.z = next.steeringAngle;
    if (frontRightRef.current)
      frontRightRef.current.rotation.z = next.steeringAngle;

    // Telemetry is throttled, so App re-renders don't reconcile the tree at 60 fps.
    const now = performance.now();
    if (now - lastTelemetryRef.current >= TELEMETRY_INTERVAL_MS) {
      lastTelemetryRef.current = now;
      onTelemetry({
        x: next.x,
        y: next.y,
        headingDeg: (next.heading * 180) / Math.PI,
        steeringDeg: (next.steeringAngle * 180) / Math.PI,
        turningRadius: turningRadius(params, next.steeringAngle),
        speed: params.speed,
        driving: input.throttle !== 0,
      });
    }

    // On-demand continuation: keeps the loop alive only while something changes.
    const selfCentering =
      !input.holdSteering &&
      input.steerDir === 0 &&
      Math.abs(next.steeringAngle) > STEERING_EPS;
    const active =
      input.throttle !== 0 ||
      input.steerDir !== 0 ||
      input.centerSteering ||
      selfCentering;
    if (active) invalidate();
  });

  return (
    <>
      <color attach="background" args={[0x1a1a2e]} />

      <OrthographicCamera
        makeDefault
        position={[0, 0, 100]}
        near={0.1}
        far={1000}
        zoom={initialZoom}
      />
      <MapControls
        ref={controlsRef}
        enableRotate={false}
        enableDamping={false}
        screenSpacePanning
        minZoom={minZoom}
        maxZoom={maxZoom}
      />

      <gridHelper
        args={[200, 200, 0x333355, 0x222244]}
        rotation={[Math.PI / 2, 0, 0]}
      />

      {/* Origin marker. */}
      <mesh position={[0, 0, 0.005]}>
        <circleGeometry args={[0.1, 16]} />
        <meshBasicMaterial color={0xff3333} />
      </mesh>

      <SweptPath ref={sweptPathRef} fillVisible={fillVisible} />
      <Car
        params={params}
        groupRef={carGroupRef}
        frontLeftRef={frontLeftRef}
        frontRightRef={frontRightRef}
      />
    </>
  );
});
