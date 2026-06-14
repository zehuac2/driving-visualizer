// Kinematic bicycle model — no slip, no dampening.
// State anchored at the rear axle center, heading in radians (0 = +X axis).

export interface CarParams {
  /** Distance between front and rear axles (meters). */
  wheelbase: number;
  /** Front overhang beyond the front axle (meters). */
  frontOverhang: number;
  /** Rear overhang behind the rear axle (meters). */
  rearOverhang: number;
  /** Total body width (meters). */
  bodyWidth: number;
  /** Maximum steering angle in radians. */
  maxSteeringAngle: number;
  /** Steering change rate (radians per second). */
  steeringRate: number;
  /** Forward/reverse speed magnitude (meters per second). */
  speed: number;
}

export const DEFAULT_PARAMS: CarParams = {
  wheelbase: 2.7,
  frontOverhang: 0.9,
  rearOverhang: 0.8,
  bodyWidth: 1.8,
  maxSteeringAngle: (35 * Math.PI) / 180,
  steeringRate: (60 * Math.PI) / 180,
  speed: 3.0,
};

export interface CarState {
  /** Rear axle center X (meters, world space). */
  x: number;
  /** Rear axle center Y (meters, world space). */
  y: number;
  /** Heading angle in radians (0 = pointing along +X, CCW positive). */
  heading: number;
  /** Current steering angle in radians (+left, -right). */
  steeringAngle: number;
}

export function createInitialState(): CarState {
  return { x: 0, y: 0, heading: Math.PI / 2, steeringAngle: 0 };
}

export interface StepInput {
  /** +1 forward, -1 reverse, 0 stopped. */
  throttle: number;
  /** +1 steer left, -1 steer right, 0 hold. */
  steerDir: number;
  /** If true, snap steering to 0. */
  centerSteering: boolean;
}

/**
 * Advance the car state by `dt` seconds.
 * Uses a fixed sub-step of 1/240 s for numerical accuracy on sharp turns.
 */
export function step(
  state: CarState,
  params: CarParams,
  input: StepInput,
  dt: number
): CarState {
  const SUB_DT = 1 / 240;
  let { x, y, heading, steeringAngle } = state;

  // Center-steering override.
  if (input.centerSteering) {
    steeringAngle = 0;
  }

  // Integrate in sub-steps.
  let remaining = dt;
  while (remaining > 0) {
    const subDt = Math.min(remaining, SUB_DT);
    remaining -= subDt;

    // Update steering angle (clamp to ±maxSteeringAngle).
    if (!input.centerSteering && input.steerDir !== 0) {
      steeringAngle += input.steerDir * params.steeringRate * subDt;
      steeringAngle = Math.max(
        -params.maxSteeringAngle,
        Math.min(params.maxSteeringAngle, steeringAngle)
      );
    }

    if (input.throttle === 0) continue;

    // Signed speed (forward = +, reverse = -).
    const s = input.throttle * params.speed;

    // Heading rate: dθ/dt = (s / L) * tan(δ).
    const dTheta =
      (s / params.wheelbase) * Math.tan(steeringAngle) * subDt;
    heading += dTheta;

    // Move the rear axle.
    x += s * Math.cos(heading) * subDt;
    y += s * Math.sin(heading) * subDt;
  }

  return { x, y, heading, steeringAngle };
}

/** The four world-space corners of the car body (FL, FR, RL, RR). */
export interface BodyCorners {
  frontLeft: [number, number];
  frontRight: [number, number];
  rearLeft: [number, number];
  rearRight: [number, number];
}

/**
 * Compute the four corners of the car body from the current state and params.
 * The car body extends `rearOverhang` behind the rear axle and
 * `wheelbase + frontOverhang` ahead of the rear axle.
 */
export function getCorners(state: CarState, params: CarParams): BodyCorners {
  const { x, y, heading } = state;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);

  // Forward = heading direction, right = perpendicular (clockwise, i.e. -sin, cos).
  const halfW = params.bodyWidth / 2;
  const fwd = params.wheelbase + params.frontOverhang; // distance from rear axle to front face
  const aft = -params.rearOverhang; // distance from rear axle to rear face (negative = behind)

  function corner(forward: number, lateral: number): [number, number] {
    return [
      x + forward * cos - lateral * sin,
      y + forward * sin + lateral * cos,
    ];
  }

  return {
    frontLeft: corner(fwd, halfW),
    frontRight: corner(fwd, -halfW),
    rearLeft: corner(aft, halfW),
    rearRight: corner(aft, -halfW),
  };
}

/**
 * Turning radius at the rear axle (Infinity when going straight).
 */
export function turningRadius(params: CarParams, steeringAngle: number): number {
  if (Math.abs(steeringAngle) < 1e-6) return Infinity;
  return params.wheelbase / Math.tan(steeringAngle);
}
