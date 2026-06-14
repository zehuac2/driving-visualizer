// Keyboard held-state tracker.
// Resolves discrete key events into a continuous input frame.

import type { StepInput } from "./CarModel.ts";

const held = new Set<string>();

function onKeyDown(e: KeyboardEvent): void {
  // Don't capture when focus is in an input element.
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    return;
  }
  held.add(e.code);
  // Prevent page scroll from Space / arrow keys.
  if (
    ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
      e.code
    )
  ) {
    e.preventDefault();
  }
}

function onKeyUp(e: KeyboardEvent): void {
  held.delete(e.code);
}

let attached = false;

export function attachInput(): void {
  if (attached) return;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  attached = true;
}

export function detachInput(): void {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  held.clear();
  attached = false;
}

/** Return the current input frame based on held keys. */
export function readInput(): StepInput {
  const forward =
    held.has("Space") || held.has("KeyW") || held.has("ArrowUp");
  const reverse = held.has("KeyS") || held.has("ArrowDown");
  const steerLeft = held.has("KeyA") || held.has("ArrowLeft");
  const steerRight = held.has("KeyD") || held.has("ArrowRight");
  const centerSteering = held.has("KeyC");

  let throttle = 0;
  if (forward && !reverse) throttle = 1;
  else if (reverse && !forward) throttle = -1;

  let steerDir = 0;
  if (steerLeft && !steerRight) steerDir = 1;
  else if (steerRight && !steerLeft) steerDir = -1;

  return { throttle, steerDir, centerSteering };
}
