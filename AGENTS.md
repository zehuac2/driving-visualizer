# Agent Guide — Driving Trajectory Visualizer

## Scripts

```sh
bun install          # install dependencies
bun run dev          # Vite dev server at http://localhost:5173 (hot reload)
bun run build        # production bundle → dist/
bun run preview      # serve the production build locally
bun test             # run the unit test suite (Bun's built-in runner)
bun run format       # format all files with Prettier
```

Run `bun run format` after making any code changes.

Unit tests cover the pure simulation code in `src/sim` (`*.test.ts`, run with
`bun test`). For UI/rendering changes, verify behaviour by running the dev
server and driving the car in the browser.

## Stack

| Layer        | Technology                             |
| ------------ | -------------------------------------- |
| Runtime      | Bun 1.3.x                              |
| Bundler      | Vite 8 (rolldown under the hood)       |
| 3D rendering | Three.js 0.184                         |
| UI           | React 19 (no state management library) |
| Language     | TypeScript 5.9, strict mode            |

Dependencies are **pinned to exact versions** in `package.json` (no `^` or `~`).
When adding a new dependency, pin the version: `bun add <pkg>@<exact-version>`.

## Architecture

The codebase separates the tight render loop from the React UI deliberately:

```
src/
├── sim/
│   ├── CarModel.ts      Pure TypeScript: car state, params, bicycle-model step(), getCorners()
│   └── input.ts         Keyboard held-state tracker; exports readInput() → StepInput
├── scene/
│   ├── SceneManager.ts  Three.js scene owner: camera, grid, car mesh, rAF loop, pan/zoom
│   └── SweptPath.ts     Growing polyline trails (4 corners) + translucent swept-area fill
├── ui/
│   ├── ParameterPanel.tsx  Sliders for all CarParams; calls onChange on every change
│   ├── Telemetry.tsx       Read-only live readout (heading, steering, turning radius, …)
│   ├── Toolbar.tsx         Action buttons (reset, clear, center steering, toggle fill, follow)
│   └── Controls.tsx        Static key-reference legend
├── App.tsx              Root: creates SceneManager once (useEffect), wires params & telemetry
└── main.tsx             React root mount
```

**Key invariant:** `SceneManager` owns the `requestAnimationFrame` loop and
mutates the Three.js scene every frame. React only re-renders when telemetry
data or params change — never on every animation frame. Shared mutable state
(params) flows via `SceneManager.updateParams()`, not through React state.

## Simulation model

`CarModel.ts` implements the **kinematic bicycle model**: state is
`(x, y, θ, δ)` anchored at the rear axle. `step()` integrates at 1/240 s
sub-steps per frame. Speed is constant; there is no dampening — the car moves
only while a motion key is held and stops instantly on release. See `README.md`
for the full math.

## Coordinate system

- World axes: X = right, Y = up (2D top-down). The Three.js scene uses XY plane
  (`z = 0`); the camera sits at `z = 100` looking toward the origin.
- `heading = 0` points along +X; headings increase CCW (standard math
  convention).
- The car starts facing +Y (heading = π/2).

## Style guide

### Imports

Use the `@/` alias for all imports that cross a directory boundary. `@/` maps to
`src/`, so `@/sim/CarModel.ts` resolves to `src/sim/CarModel.ts`.

```ts
// good
import { step } from '@/sim/CarModel.ts';
import type { TelemetryData } from '@/scene/SceneManager.ts';

// bad — never use ../
import { step } from '../sim/CarModel.ts';
```

Same-directory imports use `./` as normal.

## React component conventions

- Each component file exports exactly one named component.
- Styles are inline `React.CSSProperties` objects defined at the module level —
  no CSS files, no CSS-in-JS library.
- Components under `src/ui/` receive only plain data and callback props; they do
  not import from `src/scene/`.

## Three.js conventions

- All geometries are in the XY plane at small positive Z offsets to avoid
  Z-fighting (grid at 0, car body at 0.02, wheels at 0.03, traces at 0.01).
- The car body `Mesh` local origin is the rear axle center. Wheel meshes are
  children of the car body so they inherit its transform automatically.
- `SweptPath` pre-allocates `Float32Array` buffers of `MAX_POINTS = 20 000` per
  corner and grows them in-place via `setDrawRange` — no re-allocation per
  frame.

## Adding features

- **New car parameter:** add to `CarParams` interface in `CarModel.ts`, set a
  default in `DEFAULT_PARAMS`, add a `SliderRow` in `ParameterPanel.tsx`, and
  handle it in `SceneManager.updateParams()` / the simulation step.
- **New overlay:** add a class similar to `SweptPath` that takes the
  `THREE.Scene` in its constructor and exposes an `update(state, params)`
  method; call it from `SceneManager`'s render loop.
- **New toolbar action:** add a button in `Toolbar.tsx`, a handler in `App.tsx`,
  and a corresponding public method on `SceneManager`.
