import { describe, it, expect } from 'bun:test';
import { mapKeysToInput, SCROLL_KEYS } from './input.ts';

function held(...codes: string[]): Set<string> {
  return new Set(codes);
}

describe('mapKeysToInput', () => {
  it('reports a neutral frame when nothing is held', () => {
    expect(mapKeysToInput(held())).toEqual({
      throttle: 0,
      steerDir: 0,
      centerSteering: false,
      holdSteering: false,
    });
  });

  it('maps W / ArrowUp to forward throttle', () => {
    expect(mapKeysToInput(held('KeyW')).throttle).toBe(1);
    expect(mapKeysToInput(held('ArrowUp')).throttle).toBe(1);
  });

  it('maps S / ArrowDown to reverse throttle', () => {
    expect(mapKeysToInput(held('KeyS')).throttle).toBe(-1);
    expect(mapKeysToInput(held('ArrowDown')).throttle).toBe(-1);
  });

  it('cancels throttle when forward and reverse are both held', () => {
    expect(mapKeysToInput(held('KeyW', 'KeyS')).throttle).toBe(0);
  });

  it('maps A / ArrowLeft to steer left (+1)', () => {
    expect(mapKeysToInput(held('KeyA')).steerDir).toBe(1);
    expect(mapKeysToInput(held('ArrowLeft')).steerDir).toBe(1);
  });

  it('maps D / ArrowRight to steer right (-1)', () => {
    expect(mapKeysToInput(held('KeyD')).steerDir).toBe(-1);
    expect(mapKeysToInput(held('ArrowRight')).steerDir).toBe(-1);
  });

  it('cancels steering when left and right are both held', () => {
    expect(mapKeysToInput(held('KeyA', 'KeyD')).steerDir).toBe(0);
  });

  it('maps Space to holdSteering (not throttle)', () => {
    const input = mapKeysToInput(held('Space'));
    expect(input.holdSteering).toBe(true);
    expect(input.throttle).toBe(0);
  });

  it('maps C to centerSteering', () => {
    expect(mapKeysToInput(held('KeyC')).centerSteering).toBe(true);
  });

  it('combines throttle and steering simultaneously', () => {
    expect(mapKeysToInput(held('KeyW', 'KeyD'))).toEqual({
      throttle: 1,
      steerDir: -1,
      centerSteering: false,
      holdSteering: false,
    });
  });

  it('ignores keys that are not bound', () => {
    expect(mapKeysToInput(held('KeyQ', 'Enter'))).toEqual({
      throttle: 0,
      steerDir: 0,
      centerSteering: false,
      holdSteering: false,
    });
  });
});

describe('SCROLL_KEYS', () => {
  it('lists the keys whose default scroll should be prevented', () => {
    expect([...SCROLL_KEYS]).toEqual([
      'Space',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
    ]);
  });
});
