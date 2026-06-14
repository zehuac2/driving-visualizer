// Declarative car visuals: a group anchored at the rear axle containing the
// body, its outline, a heading arrow, and four wheels. Geometry is derived from
// `params`, so changing a shape parameter rebuilds the meshes via React
// reconciliation. The simulation loop mutates the forwarded refs each frame:
// the group's position/rotation and the front wheels' steering rotation.

import { useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { CarParams } from '@/sim/CarModel.ts';

const WHEEL_W = 0.22; // visual wheel width (meters)
const WHEEL_L = 0.5; // visual wheel length (meters)

const BODY_COLOR = 0x3a86ff;
const BODY_OUTLINE = 0x90caff;
const WHEEL_COLOR = 0x222233;
const WHEEL_OUTLINE = 0x667788;

/** A centered rectangle outline as a closed line loop, in the XY plane. */
function rectGeometry(
  width: number,
  height: number,
  z: number,
): THREE.BufferGeometry {
  const hw = width / 2;
  const hh = height / 2;
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hw, -hh, z),
    new THREE.Vector3(hw, -hh, z),
    new THREE.Vector3(hw, hh, z),
    new THREE.Vector3(-hw, hh, z),
  ]);
}

interface RectOutlineProps {
  width: number;
  height: number;
  color: number;
  position?: [number, number, number];
}

function RectOutline({
  width,
  height,
  color,
  position,
}: RectOutlineProps): React.ReactElement {
  const geometry = useMemo(
    () => rectGeometry(width, height, 0.001),
    [width, height],
  );
  return (
    <lineLoop geometry={geometry} position={position}>
      <lineBasicMaterial color={color} />
    </lineLoop>
  );
}

interface WheelProps {
  position: [number, number, number];
  wheelRef?: RefObject<THREE.Object3D | null>;
}

function Wheel({ position, wheelRef }: WheelProps): React.ReactElement {
  return (
    <object3D ref={wheelRef} position={position}>
      <mesh position={[0, 0, 0.03]}>
        <planeGeometry args={[WHEEL_W, WHEEL_L]} />
        <meshBasicMaterial color={WHEEL_COLOR} />
        <RectOutline width={WHEEL_W} height={WHEEL_L} color={WHEEL_OUTLINE} />
      </mesh>
    </object3D>
  );
}

export interface CarProps {
  params: CarParams;
  groupRef: RefObject<THREE.Group | null>;
  frontLeftRef: RefObject<THREE.Object3D | null>;
  frontRightRef: RefObject<THREE.Object3D | null>;
}

export function Car({
  params,
  groupRef,
  frontLeftRef,
  frontRightRef,
}: CarProps): React.ReactElement {
  const { wheelbase, frontOverhang, rearOverhang, bodyWidth } = params;

  const bodyLength = wheelbase + frontOverhang + rearOverhang;
  // Body center relative to the rear axle (the group's local origin).
  const centerOffset = (wheelbase + frontOverhang - rearOverhang) / 2;
  const halfW = bodyWidth / 2;
  const wheelX = halfW + WHEEL_W / 2;
  const arrowLen = wheelbase * 0.4;

  const arrowArgs = useMemo<
    [THREE.Vector3, THREE.Vector3, number, number, number, number]
  >(
    () => [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0.06),
      arrowLen,
      0xffffff,
      arrowLen * 0.4,
      arrowLen * 0.25,
    ],
    [arrowLen],
  );

  return (
    <group ref={groupRef}>
      {/* Body, centered ahead of the rear axle. */}
      <mesh position={[0, centerOffset, 0.02]}>
        <planeGeometry args={[bodyWidth, bodyLength]} />
        <meshBasicMaterial color={BODY_COLOR} transparent opacity={0.85} />
        <RectOutline
          width={bodyWidth}
          height={bodyLength}
          color={BODY_OUTLINE}
        />
      </mesh>

      {/* Heading arrow from the rear axle pointing forward. */}
      <arrowHelper args={arrowArgs} />

      {/* Wheels (rear at the axle, front at +wheelbase). Front wheels steer. */}
      <Wheel position={[-wheelX, 0, 0]} />
      <Wheel position={[wheelX, 0, 0]} />
      <Wheel position={[-wheelX, wheelbase, 0]} wheelRef={frontLeftRef} />
      <Wheel position={[wheelX, wheelbase, 0]} wheelRef={frontRightRef} />
    </group>
  );
}
