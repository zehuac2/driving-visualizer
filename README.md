# Driving Trajectory Visualizer

A top-down tool for studying how a car sweeps through space during a maneuver.
The defining feature is the **four-corner swept envelope**: as you drive, the
path traced by each corner of the car body is drawn on-screen, letting you judge
clearance and potential collisions at a glance.

## Trajectory model

The simulation uses the **kinematic bicycle model** — pure geometry, no tire
slip, no mass, no dampening.

### State

The car is represented by four scalar values:

| Variable            | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| `x`, `y`            | World position of the **rear axle center** (meters) |
| `θ` (heading)       | Direction the car faces (radians, CCW from +X axis) |
| `δ` (steeringAngle) | Front wheel steering angle (radians, +left)         |

### Integration

Each animation frame the integrator runs in sub-steps of 1/240 s (to keep the
Euler step accurate on sharp turns). Per sub-step:

```
# Active steering (A/D held):
δ  +=  steerDir × steeringRate × dt          (clamped to ±maxSteeringAngle)
# No steer input, Space not held — self-center toward 0°:
δ  →  0  at rate steeringRate × dt           (clamps at 0, no overshoot)
# No steer input, Space held — hold angle:
δ  unchanged

dθ  =  (s / L) × tan(δ) × dt
θ  +=  dθ

x  +=  s × cos(θ) × dt
y  +=  s × sin(θ) × dt
```

where `s = throttle × speed` (signed — negative for reverse) and `L` is the
wheelbase. When `throttle = 0` the car does not move; there is no coasting or
deceleration.

### Geometry

The instantaneous **turning radius** at the rear axle is:

```
R = L / tan(δ)       (→ ∞ when δ ≈ 0, i.e. straight line)
```

The center of curvature (ICR) is perpendicular to the car's heading at distance
`R` from the rear axle.

### Four-corner swept envelope

Every frame the car moves, `getCorners()` projects the four body corners into
world space:

```
corner(fwd, lat) = (x + fwd·cos θ − lat·sin θ,
                    y + fwd·sin θ + lat·cos θ)
```

where `fwd` and `lat` are longitudinal and lateral offsets from the rear axle:

| Corner      | fwd                         | lat            |
| ----------- | --------------------------- | -------------- |
| Front-left  | `wheelbase + frontOverhang` | `+bodyWidth/2` |
| Front-right | `wheelbase + frontOverhang` | `−bodyWidth/2` |
| Rear-left   | `−rearOverhang`             | `+bodyWidth/2` |
| Rear-right  | `−rearOverhang`             | `−bodyWidth/2` |

Each frame's four corner positions are appended to four growing polylines (one
per corner, colour-coded). An optional translucent mesh fills the quadrilateral
strip between successive corner quads, showing the total area occupied.

## Controls

| Input     | Action                                                   |
| --------- | -------------------------------------------------------- |
| `W` / `↑` | Drive forward (stops immediately on release)             |
| `S` / `↓` | Reverse                                                  |
| `A` / `←` | Steer left — self-centers on release                     |
| `D` / `→` | Steer right — self-centers on release                    |
| `Space`   | Hold steering angle (prevents self-centering while held) |
| `C`       | Center steering to 0° instantly                          |
| Scroll    | Zoom                                                     |
| Drag      | Pan                                                      |

## Parameters

All values are adjustable live via the bottom panel:

| Parameter          | Default | Range        |
| ------------------ | ------- | ------------ |
| Wheelbase          | 2.70 m  | 1.5 – 6.0 m  |
| Front overhang     | 0.90 m  | 0.1 – 2.0 m  |
| Rear overhang      | 0.80 m  | 0.1 – 2.0 m  |
| Body width         | 1.80 m  | 1.0 – 3.0 m  |
| Max steering angle | 35°     | 5° – 55°     |
| Steering rate      | 60°/s   | 10° – 180°/s |
| Speed              | 3.0 m/s | 0.5 – 20 m/s |

## Running

```sh
bun install
bun run dev      # development server at http://localhost:5173
bun run build    # production bundle → dist/
```
