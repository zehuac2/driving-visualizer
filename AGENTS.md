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

Run `bun run format` after you change any code.

The unit tests cover the pure simulation code in `src/sim`. These test files end
in `*.test.ts`. Run them with `bun test`. For UI or rendering changes, start the
dev server and drive the car in the browser to check the behavior.

## Stack

| Layer        | Technology                                        |
| ------------ | ------------------------------------------------- |
| Runtime      | Bun 1.3.x                                         |
| Bundler      | Vite 8 (rolldown under the hood)                  |
| 3D rendering | Three.js 0.184 via @react-three/fiber 9 + drei 10 |
| UI           | React 19 (no state management library)            |
| Language     | TypeScript 5.9, strict mode                       |

Dependencies use exact, pinned versions in `package.json`. Do not use `^` or
`~`. To add a new dependency, pin its version: `bun add <pkg>@<exact-version>`.

## Architecture

The scene is a declarative @react-three/fiber tree. A single `useFrame` loop
runs the per-frame simulation. This loop mutates Three.js objects through refs.
React state holds only params, throttled telemetry, and UI toggles.

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

- `Scene` runs one `useFrame` loop. This loop advances the car state, which is
  held in a `useRef`. The loop mutates the car group and wheel objects directly.
  Never call `setState` per frame. Physics state must never live in React state.
- Rendering is **on-demand** (`frameloop="demand"`). The loop calls
  `invalidate()` only while the car or its steering is still changing.
  `useKeyboardInput`'s `onWake` wakes the loop again on keydown. Imperative
  actions and `MapControls` also call `invalidate()` when needed. When nothing
  moves, the canvas stays idle.
- Telemetry updates push to React at about 15 Hz (throttled). This keeps `App`
  re-renders from reconciling the Canvas tree at 60 fps. Params flow down as
  props. When you change a shape param, React reconciliation rebuilds `Car`'s
  geometry. You do not need to rebuild it by hand.
- Toolbar actions reach the scene through the `SceneHandle` imperative ref. This
  ref exposes `reset`, `clearTraces`, `centerSteering`, and `centerCamera`. Fill
  visibility uses a separate, declarative `fillVisible` prop.

## Simulation model

`CarModel.ts` implements the **kinematic bicycle model**. The state is
`(x, y, θ, δ)`, anchored at the rear axle. `step()` integrates in sub-steps of
1/240 s per frame. Speed stays constant; there is no dampening. The car moves
only while you hold a motion key, and it stops the instant you release the key.
See `README.md` for the full math.

## Coordinate system

- World axes: X points right, Y points up (2D top-down view). The Three.js scene
  uses the XY plane, at `z = 0`. The camera sits at `z = 100` and looks toward
  the origin.
- `heading = 0` points along +X. Headings increase counterclockwise (CCW), the
  standard math convention.
- The car starts facing +Y (heading = π/2).

## Style guide

### Documentation and comments

Write all documentation and code comments in Simplified Technical English (STE).
Use short sentences. Cover one idea per sentence. Use active voice. Write
procedures as numbered steps.

### Imports

Use the `@/` alias for imports that cross a directory boundary. `@/` maps to
`src/`, so `@/sim/CarModel.ts` resolves to `src/sim/CarModel.ts`.

```ts
// good
import { step } from '@/sim/CarModel.ts';
import type { TelemetryData } from '@/scene/Scene.tsx';

// bad — do not use ../
import { step } from '../sim/CarModel.ts';
```

Same-directory imports use `./` as normal.

## React component conventions

- Each component file exports exactly one named component.
- Styles are inline `React.CSSProperties` objects, defined at the module level.
  Do not use CSS files or a CSS-in-JS library.
- Components under `src/ui/` receive only plain data and callback props. They
  must not import from `src/scene/`.

## Three.js / R3F conventions

- All geometries sit in the XY plane, at small positive Z offsets. This avoids
  Z-fighting. The grid is at `z = 0`, the car body at `z = 0.02`, the wheels at
  `z = 0.03`, and the traces at `z = 0.01`.
- The `Car` `<group>` local origin is the rear axle center. The body, arrow, and
  wheels are children of this group, so they inherit its transform. Each front
  wheel is wrapped in its own object. This lets the loop set each wheel's
  steering `rotation.z` independently.
- `SweptPath` pre-allocates a `Float32Array` buffer of `MAX_POINTS = 20 000` for
  each corner. It grows each buffer in place with `setDrawRange`, so it never
  re-allocates per frame. The growing `THREE.Line` and `THREE.Mesh` objects
  render through `<primitive>`. This avoids a name clash between `<line>` and
  the SVG JSX element. The `SweptPathHandle` grows these objects through its
  `append` and `clear` methods.
- Prefer declarative JSX. Use refs and the `useFrame` loop only for per-frame
  mutation. Keep `frameloop="demand"` working correctly: any code that changes
  the scene outside the loop must call `invalidate()`.

## Adding features

**New car parameter:**

1. Add the parameter to `CarParams` in `CarModel.ts`.
2. Set a default value in `DEFAULT_PARAMS`.
3. Add a `SliderRow` for it in `ParameterPanel.tsx`.

The parameter then flows as a prop into `Scene` and `Car` automatically. Use it
in the `step()` math, the `Car` geometry, or both.

**New overlay:** Add a component similar to `SweptPath`. It should render R3F
elements. If it needs per-frame data, it should expose an imperative handle that
the `Scene` loop drives. Mount the component inside `Scene`.

**New toolbar action:**

1. Add a button in `Toolbar.tsx`.
2. Add a handler in `App.tsx`.
3. Add a method on `SceneHandle` in `Scene.tsx`. Remember to call
   `invalidate()`.
