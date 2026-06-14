// Pure key-mapping: resolve a set of held key codes into a continuous input
// frame. The held-state tracking and window listeners live in the
// `useKeyboardInput` hook; this function stays pure and testable.

import type { StepInput } from './CarModel.ts';

/** Key codes that should not scroll the page while driving. */
export const SCROLL_KEYS = [
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
] as const;

/** Map the currently held key codes to a `StepInput` frame. */
export function mapKeysToInput(held: ReadonlySet<string>): StepInput {
  const forward = held.has('KeyW') || held.has('ArrowUp');
  const reverse = held.has('KeyS') || held.has('ArrowDown');
  const steerLeft = held.has('KeyA') || held.has('ArrowLeft');
  const steerRight = held.has('KeyD') || held.has('ArrowRight');
  const centerSteering = held.has('KeyC');
  const holdSteering = held.has('Space');

  let throttle = 0;
  if (forward && !reverse) throttle = 1;
  else if (reverse && !forward) throttle = -1;

  let steerDir = 0;
  if (steerLeft && !steerRight) steerDir = 1;
  else if (steerRight && !steerLeft) steerDir = -1;

  return { throttle, steerDir, centerSteering, holdSteering };
}
