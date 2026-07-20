# Driving Trajectory Visualizer

This tool shows, from a top-down view, how a car sweeps through space during a
maneuver. Its main feature is the **four-corner swept envelope**. As you drive,
the tool draws the path of each corner of the car body on screen. This lets you
judge clearance and possible collisions at a glance.

## Trajectory model

The simulation uses the **kinematic bicycle model**. This model uses pure
geometry. It has no tire slip, no mass, and no dampening.

### State

Four scalar values represent the car:

| Variable            | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| `x`, `y`            | World position of the **rear axle center** (meters) |
| `θ` (heading)       | Direction the car faces (radians, CCW from +X axis) |
| `δ` (steeringAngle) | Front wheel steering angle (radians, +left)         |

### Integration

In each animation frame, the integrator runs in sub-steps of 1/240 s. This keeps
the Euler step accurate on sharp turns. Each sub-step does the following:

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

Here, `s = throttle × speed`. This value is signed: negative for reverse. `L` is
the wheelbase. When `throttle = 0`, the car does not move. There is no coasting
and no deceleration.

### Geometry

The turning radius at the rear axle, at any instant, is:

```
R = L / tan(δ)       (→ ∞ when δ ≈ 0, i.e. straight line)
```

The center of curvature (ICR) sits at distance `R` from the rear axle,
perpendicular to the car's heading.

### Four-corner swept envelope

In every frame where the car moves, `getCorners()` projects the four body
corners into world space:

```
corner(fwd, lat) = (x + fwd·cos θ − lat·sin θ,
                    y + fwd·sin θ + lat·cos θ)
```

Here, `fwd` and `lat` are the longitudinal and lateral offsets from the rear
axle:

| Corner      | fwd                         | lat            |
| ----------- | --------------------------- | -------------- |
| Front-left  | `wheelbase + frontOverhang` | `+bodyWidth/2` |
| Front-right | `wheelbase + frontOverhang` | `−bodyWidth/2` |
| Rear-left   | `−rearOverhang`             | `+bodyWidth/2` |
| Rear-right  | `−rearOverhang`             | `−bodyWidth/2` |

Each frame, the tool appends the four corner positions to four growing
polylines, one per corner. Each polyline has its own color. An optional
translucent mesh can fill the quadrilateral strip between successive corner
quads. This shows the total area the car occupies.

## Controls

| Input     | Action                                                  |
| --------- | ------------------------------------------------------- |
| `W` / `↑` | Drive forward. Stops the instant you release the key.   |
| `S` / `↓` | Reverse.                                                |
| `A` / `←` | Steer left. Self-centers when you release the key.      |
| `D` / `→` | Steer right. Self-centers when you release the key.     |
| `Space`   | Hold the current steering angle. Blocks self-centering. |
| `C`       | Center the steering angle to 0° instantly.              |
| Scroll    | Zoom.                                                   |
| Drag      | Pan.                                                    |

## Parameters

You can adjust all values live, using the bottom panel:

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
