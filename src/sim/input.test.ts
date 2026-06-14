import { describe, it, expect, beforeEach } from 'bun:test';

// input.ts attaches keyboard listeners to `window` and ignores events whose
// target is an <input>/<textarea>. Provide minimal DOM shims so the module can
// run outside a browser. input.ts only touches these globals inside its
// functions, so installing them before any call is sufficient.
class FakeHTMLInputElement {}
class FakeHTMLTextAreaElement {}

type Listener = (e: unknown) => void;
const listeners: Record<string, Listener[]> = {};

(globalThis as unknown as { window: unknown }).window = {
  addEventListener(type: string, fn: Listener) {
    (listeners[type] ??= []).push(fn);
  },
  removeEventListener(type: string, fn: Listener) {
    listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
  },
};
(globalThis as unknown as { HTMLInputElement: unknown }).HTMLInputElement =
  FakeHTMLInputElement;
(
  globalThis as unknown as { HTMLTextAreaElement: unknown }
).HTMLTextAreaElement = FakeHTMLTextAreaElement;

const { attachInput, detachInput, readInput } = await import('./input.ts');

function fire(type: string, e: unknown): void {
  for (const fn of listeners[type] ?? []) fn(e);
}

function keydown(code: string, target: unknown = {}) {
  let prevented = false;
  fire('keydown', { code, target, preventDefault: () => (prevented = true) });
  return prevented;
}

function keyup(code: string): void {
  fire('keyup', { code, target: {} });
}

describe('readInput', () => {
  beforeEach(() => {
    // Reset module state (held keys + listeners) between tests.
    detachInput();
    attachInput();
  });

  it('reports a neutral frame when nothing is held', () => {
    expect(readInput()).toEqual({
      throttle: 0,
      steerDir: 0,
      centerSteering: false,
      holdSteering: false,
    });
  });

  it('maps W / ArrowUp to forward throttle', () => {
    for (const code of ['KeyW', 'ArrowUp']) {
      detachInput();
      attachInput();
      keydown(code);
      expect(readInput().throttle).toBe(1);
    }
  });

  it('maps Space to holdSteering (not throttle)', () => {
    keydown('Space');
    const input = readInput();
    expect(input.holdSteering).toBe(true);
    expect(input.throttle).toBe(0);
  });

  it('maps S / ArrowDown to reverse throttle', () => {
    keydown('KeyS');
    expect(readInput().throttle).toBe(-1);
    detachInput();
    attachInput();
    keydown('ArrowDown');
    expect(readInput().throttle).toBe(-1);
  });

  it('cancels throttle when forward and reverse are both held', () => {
    keydown('KeyW');
    keydown('KeyS');
    expect(readInput().throttle).toBe(0);
  });

  it('maps A / ArrowLeft to steer left (+1)', () => {
    keydown('KeyA');
    expect(readInput().steerDir).toBe(1);
    detachInput();
    attachInput();
    keydown('ArrowLeft');
    expect(readInput().steerDir).toBe(1);
  });

  it('maps D / ArrowRight to steer right (-1)', () => {
    keydown('KeyD');
    expect(readInput().steerDir).toBe(-1);
    detachInput();
    attachInput();
    keydown('ArrowRight');
    expect(readInput().steerDir).toBe(-1);
  });

  it('cancels steering when left and right are both held', () => {
    keydown('KeyA');
    keydown('KeyD');
    expect(readInput().steerDir).toBe(0);
  });

  it('maps C to centerSteering', () => {
    keydown('KeyC');
    expect(readInput().centerSteering).toBe(true);
  });

  it('clears a key on keyup', () => {
    keydown('KeyW');
    expect(readInput().throttle).toBe(1);
    keyup('KeyW');
    expect(readInput().throttle).toBe(0);
  });

  it('combines throttle and steering simultaneously', () => {
    keydown('KeyW');
    keydown('KeyD');
    expect(readInput()).toEqual({
      throttle: 1,
      steerDir: -1,
      centerSteering: false,
      holdSteering: false,
    });
  });
});

describe('event handling', () => {
  beforeEach(() => {
    detachInput();
    attachInput();
  });

  it('ignores keydown when focus is in a text input', () => {
    keydown('KeyW', new FakeHTMLInputElement());
    expect(readInput().throttle).toBe(0);
  });

  it('ignores keydown when focus is in a textarea', () => {
    keydown('KeyA', new FakeHTMLTextAreaElement());
    expect(readInput().steerDir).toBe(0);
  });

  it('prevents default for scroll-causing keys', () => {
    for (const code of [
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]) {
      expect(keydown(code)).toBe(true);
    }
  });

  it('does not prevent default for ordinary keys', () => {
    expect(keydown('KeyW')).toBe(false);
  });

  it('detachInput clears held keys', () => {
    keydown('KeyW');
    detachInput();
    // After detach, held is cleared; re-attach to read a clean frame.
    attachInput();
    expect(readInput().throttle).toBe(0);
  });
});
