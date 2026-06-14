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

| Layer        | Technology                                        |
| ------------ | ------------------------------------------------- |
| Runtime      | Bun 1.3.x                                         |
| Bundler      | Vite 8 (rolldown under the hood)                  |
| 3D rendering | Three.js 0.184 via @react-three/fiber 9 + drei 10 |
| UI           | React 19 (no state management library)            |
| Language     | TypeScript 5.9, strict mode                       |

Dependencies are **pinned to exact versions** in `package.json` (no `^` or `~`).
When adding a new dependency, pin the version: `bun add <pkg>@<exact-version>`.

## Architecture

The scene is a declarative @react-three/fiber tree. The per-frame simulation
runs in a single `useFrame` loop that mutates Three.js objects through refs —
React state is reserved for params, throttled telemetry, and UI toggles.

```
src/
├── sim/
│   ├── CarModel.ts         Pure TypeScript: car state, params, bicycle-model step(), getCorners()
│   ├── input.ts            Pure mapKeysToInput(Set) → StepInput (no globals, no listeners)
│   └── useKeyboardInput.ts Hook: window keydown/keyup → held-keys ref; stable readInput(); onWake
├── scene/
│   ├── Scene.tsx           R3F tree owner: camera, MapControls, grid, the single useFrame loop,
│   │                       throttled telemetry, on-demand invalidate(), imperative SceneHandle
│   ├── Car.tsx             Declarative car group (body, outline, arrow, 4 wheels) from params
│   └── SweptPath.tsx       Growing polyline trails (4 corners) + translucent fill via imperative handle
├── ui/
│   ├── ParameterPanel.tsx  Sliders for all CarParams; calls onChange on every change
│   ├── Telemetry.tsx       Read-only live readout (heading, steering, turning radius, …)
│   ├── Toolbar.tsx         Action buttons (reset, clear, center steering, toggle fill, follow)
│   └── Controls.tsx        Static key-reference legend
├── App.tsx                 Root: <Canvas orthographic frameloop="demand"> + Scene + UI overlays
└── main.tsx                React root mount
```

**Key invariants:**

- `Scene` runs one `useFrame` loop that advances the car state held in a
  `useRef` and mutates the car group / wheel objects directly. Never call
  `setState` per frame; physics state never lives in React state.
- Rendering is **on-demand** (`frameloop="demand"`). The loop calls
  `invalidate()` only while the car or its steering is still changing;
  `useKeyboardInput`'s `onWake` re-wakes it on keydown; imperative actions and
  `MapControls` invalidate on demand. When nothing moves, the canvas is idle.
- Telemetry is pushed to React (~15 Hz, throttled) so `App` re-renders don't
  reconcile the Canvas tree at 60 fps. Params flow down as props; changing a
  shape param rebuilds `Car`'s geometry via reconciliation (no manual rebuild).
- Toolbar actions reach the scene through the `SceneHandle` imperative ref
  (`reset`, `clearTraces`, `centerSteering`, `centerCamera`); fill visibility is
  a declarative `fillVisible` prop.

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
import type { TelemetryData } from '@/scene/Scene.tsx';

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

## Three.js / R3F conventions

- All geometries are in the XY plane at small positive Z offsets to avoid
  Z-fighting (grid at 0, car body at 0.02, wheels at 0.03, traces at 0.01).
- The `Car` `<group>` local origin is the rear axle center; the body, arrow, and
  wheels are children, so they inherit its transform. Front wheels are wrapped
  in their own object so the loop can set their steering `rotation.z`
  independently.
- `SweptPath` pre-allocates `Float32Array` buffers of `MAX_POINTS = 20 000` per
  corner and grows them in-place via `setDrawRange` — no re-allocation per
  frame. The growing `THREE.Line`/`THREE.Mesh` objects are rendered via
  `<primitive>` (avoids the `<line>`/SVG JSX name clash) and grown through the
  `SweptPathHandle` (`append`/`clear`).
- Prefer declarative JSX; reach for refs + the `useFrame` loop only for
  per-frame mutation. Keep `frameloop="demand"` working: anything that changes
  the scene outside the loop must `invalidate()`.

## Adding features

- **New car parameter:** add to `CarParams` in `CarModel.ts`, set a default in
  `DEFAULT_PARAMS`, add a `SliderRow` in `ParameterPanel.tsx`. It flows as a
  prop into `Scene`/`Car` automatically; use it in the `step()` math and/or
  `Car` geometry.
- **New overlay:** add a component similar to `SweptPath` that renders R3F
  elements and (if it needs per-frame data) exposes an imperative handle the
  `Scene` loop drives; mount it inside `Scene`.
- **New toolbar action:** add a button in `Toolbar.tsx`, a handler in `App.tsx`,
  and a method on `SceneHandle` in `Scene.tsx` (remember to `invalidate()`).
