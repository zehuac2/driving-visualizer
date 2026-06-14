// React hook owning keyboard held-state. Attaches window listeners for the
// lifetime of the component and exposes a stable `readInput()` the render loop
// can call every frame without triggering re-renders.

import { useCallback, useEffect, useRef } from 'react';
import type { StepInput } from './CarModel.ts';
import { mapKeysToInput, SCROLL_KEYS } from './input.ts';

export interface UseKeyboardInput {
  /** Read the current input frame from the held keys. Stable identity. */
  readInput: () => StepInput;
}

/**
 * @param onWake Called on keydown so an on-demand render loop can be woken up
 *   (e.g. via R3F's `invalidate()`).
 */
export function useKeyboardInput(onWake?: () => void): UseKeyboardInput {
  const heldRef = useRef<Set<string>>(new Set());

  // Keep the latest onWake without re-attaching listeners.
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  useEffect(() => {
    const held = heldRef.current;

    function onKeyDown(e: KeyboardEvent): void {
      // Don't capture when focus is in a text field.
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      held.add(e.code);
      if ((SCROLL_KEYS as readonly string[]).includes(e.code)) {
        e.preventDefault();
      }
      onWakeRef.current?.();
    }

    function onKeyUp(e: KeyboardEvent): void {
      held.delete(e.code);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      held.clear();
    };
  }, []);

  const readInput = useCallback(() => mapKeysToInput(heldRef.current), []);

  return { readInput };
}
