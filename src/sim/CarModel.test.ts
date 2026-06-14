import { describe, it, expect } from "bun:test";
import {
  DEFAULT_PARAMS,
  createInitialState,
  step,
  getCorners,
  turningRadius,
  type CarParams,
  type CarState,
  type StepInput,
} from "./CarModel.ts";

// A convenient base input: no motion, no steering, no centering.
const IDLE: StepInput = { throttle: 0, steerDir: 0, centerSteering: false };

function makeState(over: Partial<CarState> = {}): CarState {
  return { x: 0, y: 0, heading: 0, steeringAngle: 0, ...over };
}

describe("createInitialState", () => {
  it("starts at the origin facing +Y with centered steering", () => {
    const s = createInitialState();
    expect(s).toEqual({ x: 0, y: 0, heading: Math.PI / 2, steeringAngle: 0 });
  });

  it("returns a fresh object each call", () => {
    expect(createInitialState()).not.toBe(createInitialState());
  });
});

describe("step — straight-line motion", () => {
  it("moves forward along the heading at constant speed", () => {
    const s = step(makeState({ heading: 0 }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 1);
    expect(s.x).toBeCloseTo(DEFAULT_PARAMS.speed, 10);
    expect(s.y).toBeCloseTo(0, 10);
    expect(s.heading).toBeCloseTo(0, 10);
    expect(s.steeringAngle).toBe(0);
  });

  it("moves backward when reversing", () => {
    const s = step(makeState({ heading: 0 }), DEFAULT_PARAMS, { ...IDLE, throttle: -1 }, 1);
    expect(s.x).toBeCloseTo(-DEFAULT_PARAMS.speed, 10);
    expect(s.y).toBeCloseTo(0, 10);
  });

  it("travels in the direction it faces", () => {
    // Facing +Y, forward motion should increase y, not x.
    const s = step(makeState({ heading: Math.PI / 2 }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 1);
    expect(s.x).toBeCloseTo(0, 10);
    expect(s.y).toBeCloseTo(DEFAULT_PARAMS.speed, 10);
  });

  it("does not move when the throttle is zero", () => {
    const start = makeState({ x: 5, y: 7, heading: 1 });
    const s = step(start, DEFAULT_PARAMS, IDLE, 1);
    expect(s.x).toBe(5);
    expect(s.y).toBe(7);
    expect(s.heading).toBe(1);
  });

  it("does not mutate the input state", () => {
    const start = makeState({ heading: 0 });
    step(start, DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 1);
    expect(start).toEqual(makeState({ heading: 0 }));
  });

  it("distance scales linearly with dt", () => {
    const a = step(makeState({ heading: 0 }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 0.5);
    const b = step(makeState({ heading: 0 }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 1.0);
    expect(b.x).toBeCloseTo(2 * a.x, 10);
  });
});

describe("step — steering", () => {
  it("accumulates steering at steeringRate while held", () => {
    // 0.5 s at 60°/s = 30° = below the 35° max.
    const s = step(makeState(), DEFAULT_PARAMS, { ...IDLE, steerDir: 1 }, 0.5);
    expect(s.steeringAngle).toBeCloseTo(DEFAULT_PARAMS.steeringRate * 0.5, 6);
  });

  it("steers right (negative) with steerDir -1", () => {
    const s = step(makeState(), DEFAULT_PARAMS, { ...IDLE, steerDir: -1 }, 0.5);
    expect(s.steeringAngle).toBeCloseTo(-DEFAULT_PARAMS.steeringRate * 0.5, 6);
  });

  it("clamps to +maxSteeringAngle", () => {
    const s = step(makeState(), DEFAULT_PARAMS, { ...IDLE, steerDir: 1 }, 10);
    expect(s.steeringAngle).toBeCloseTo(DEFAULT_PARAMS.maxSteeringAngle, 10);
  });

  it("clamps to -maxSteeringAngle", () => {
    const s = step(makeState(), DEFAULT_PARAMS, { ...IDLE, steerDir: -1 }, 10);
    expect(s.steeringAngle).toBeCloseTo(-DEFAULT_PARAMS.maxSteeringAngle, 10);
  });

  it("holds the steering angle when steerDir is 0", () => {
    const s = step(makeState({ steeringAngle: 0.3 }), DEFAULT_PARAMS, IDLE, 1);
    expect(s.steeringAngle).toBe(0.3);
  });

  it("centerSteering snaps the angle to zero", () => {
    const s = step(makeState({ steeringAngle: 0.4 }), DEFAULT_PARAMS, { ...IDLE, centerSteering: true }, 1);
    expect(s.steeringAngle).toBe(0);
  });

  it("centerSteering overrides an active steerDir", () => {
    const s = step(
      makeState({ steeringAngle: 0.4 }),
      DEFAULT_PARAMS,
      { throttle: 0, steerDir: 1, centerSteering: true },
      1
    );
    expect(s.steeringAngle).toBe(0);
  });
});

describe("step — turning", () => {
  it("changes heading by (speed / wheelbase) * tan(δ) * dt", () => {
    // Heading change is independent of position integration, so it is exact.
    const delta = 0.3;
    const dt = 2;
    const s = step(makeState({ steeringAngle: delta }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, dt);
    const expected = (DEFAULT_PARAMS.speed / DEFAULT_PARAMS.wheelbase) * Math.tan(delta) * dt;
    expect(s.heading).toBeCloseTo(expected, 10);
  });

  it("a positive steering angle turns left (heading increases)", () => {
    const s = step(makeState({ steeringAngle: 0.3 }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 1);
    expect(s.heading).toBeGreaterThan(0);
  });

  it("traces a circle whose radius matches turningRadius", () => {
    const delta = 0.3;
    const R = turningRadius(DEFAULT_PARAMS, delta);
    // For a left turn the instantaneous center is R to the left of the rear axle.
    // Starting at origin heading +X, that center is (0, R). The forward-Euler
    // integrator drifts slightly off the ideal circle, hence the loose tolerance.
    const center = { x: 0, y: R };
    const s = step(makeState({ steeringAngle: delta }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 2);
    const dist = Math.hypot(s.x - center.x, s.y - center.y);
    expect(dist).toBeCloseTo(R, 1);
  });

  it("reversing with steering turns the opposite way", () => {
    const fwd = step(makeState({ steeringAngle: 0.3 }), DEFAULT_PARAMS, { ...IDLE, throttle: 1 }, 1);
    const rev = step(makeState({ steeringAngle: 0.3 }), DEFAULT_PARAMS, { ...IDLE, throttle: -1 }, 1);
    expect(fwd.heading).toBeGreaterThan(0);
    expect(rev.heading).toBeLessThan(0);
  });

  it("gives nearly the same result regardless of dt granularity", () => {
    // One big step vs. many small steps over the same total time. Heading is
    // integrated exactly, so it matches tightly; position is forward-Euler and
    // differs slightly because the fixed 1/240 s sub-step is chunked differently.
    const input: StepInput = { ...IDLE, throttle: 1 };
    const big = step(makeState({ steeringAngle: 0.3 }), DEFAULT_PARAMS, input, 1);

    let s = makeState({ steeringAngle: 0.3 });
    for (let i = 0; i < 100; i++) s = step(s, DEFAULT_PARAMS, input, 0.01);

    expect(s.x).toBeCloseTo(big.x, 3);
    expect(s.y).toBeCloseTo(big.y, 3);
    expect(s.heading).toBeCloseTo(big.heading, 10);
  });
});

describe("getCorners", () => {
  it("places corners correctly when facing +X", () => {
    const p = DEFAULT_PARAMS;
    const fwd = p.wheelbase + p.frontOverhang; // 3.6
    const aft = -p.rearOverhang; // -0.8
    const halfW = p.bodyWidth / 2; // 0.9
    const c = getCorners(makeState({ heading: 0 }), p);

    expect(c.frontLeft[0]).toBeCloseTo(fwd, 10);
    expect(c.frontLeft[1]).toBeCloseTo(halfW, 10);
    expect(c.frontRight[0]).toBeCloseTo(fwd, 10);
    expect(c.frontRight[1]).toBeCloseTo(-halfW, 10);
    expect(c.rearLeft[0]).toBeCloseTo(aft, 10);
    expect(c.rearLeft[1]).toBeCloseTo(halfW, 10);
    expect(c.rearRight[0]).toBeCloseTo(aft, 10);
    expect(c.rearRight[1]).toBeCloseTo(-halfW, 10);
  });

  it("rotates corners with the heading (facing +Y)", () => {
    const p = DEFAULT_PARAMS;
    const fwd = p.wheelbase + p.frontOverhang;
    const halfW = p.bodyWidth / 2;
    const c = getCorners(makeState({ heading: Math.PI / 2 }), p);
    // Facing +Y: forward maps to +Y, left maps to -X.
    expect(c.frontLeft[0]).toBeCloseTo(-halfW, 10);
    expect(c.frontLeft[1]).toBeCloseTo(fwd, 10);
  });

  it("translates corners by the car position", () => {
    const p = DEFAULT_PARAMS;
    const at0 = getCorners(makeState({ heading: 0 }), p);
    const at = getCorners(makeState({ x: 10, y: -5, heading: 0 }), p);
    expect(at.frontLeft[0]).toBeCloseTo(at0.frontLeft[0] + 10, 10);
    expect(at.frontLeft[1]).toBeCloseTo(at0.frontLeft[1] - 5, 10);
  });

  it("spans the full body length and width", () => {
    const p = DEFAULT_PARAMS;
    const c = getCorners(makeState({ heading: 0 }), p);
    const length = Math.hypot(c.frontLeft[0] - c.rearLeft[0], c.frontLeft[1] - c.rearLeft[1]);
    const width = Math.hypot(c.frontLeft[0] - c.frontRight[0], c.frontLeft[1] - c.frontRight[1]);
    expect(length).toBeCloseTo(p.wheelbase + p.frontOverhang + p.rearOverhang, 10);
    expect(width).toBeCloseTo(p.bodyWidth, 10);
  });
});

describe("turningRadius", () => {
  it("is Infinity when steering is centered", () => {
    expect(turningRadius(DEFAULT_PARAMS, 0)).toBe(Infinity);
  });

  it("treats near-zero angles as straight", () => {
    expect(turningRadius(DEFAULT_PARAMS, 1e-7)).toBe(Infinity);
  });

  it("equals wheelbase / tan(δ) for a real angle", () => {
    const delta = 0.3;
    expect(turningRadius(DEFAULT_PARAMS, delta)).toBeCloseTo(
      DEFAULT_PARAMS.wheelbase / Math.tan(delta),
      10
    );
  });

  it("is negative for a right (negative) steering angle", () => {
    expect(turningRadius(DEFAULT_PARAMS, -0.3)).toBeLessThan(0);
  });

  it("scales with the wheelbase", () => {
    const longer: CarParams = { ...DEFAULT_PARAMS, wheelbase: DEFAULT_PARAMS.wheelbase * 2 };
    expect(turningRadius(longer, 0.3)).toBeCloseTo(2 * turningRadius(DEFAULT_PARAMS, 0.3), 10);
  });
});
