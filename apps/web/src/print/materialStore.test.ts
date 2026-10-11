import { describe, expect, it, vi } from 'vitest';
import { memoryPreferences } from '../platform';
import { withDensity } from './material';
import { materialStore } from './materialStore';

describe('materialStore', () => {
  it('is one store per preferences, written through and notified', () => {
    const preferences = memoryPreferences();
    const a = materialStore(preferences);
    expect(materialStore(preferences)).toBe(a);
    const listener = vi.fn();
    a.subscribe(listener);
    a.set({ densities: withDensity(a.get(), 'pla', '1.3').densities });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(
      preferences.get<{ densities: unknown }>('print.material', { densities: 0 }).densities,
    ).toEqual({
      pla: '1.3',
    });
    // A reset drops the key itself, not a stale copy.
    a.set({ densities: undefined });
    expect(a.get().densities).toBeUndefined();
  });

  it('reads a preference written before overrides existed', () => {
    const preferences = memoryPreferences({
      'print.material': { material: 'abs', density: '1.3', diameter: 2.85 },
    });
    const store = materialStore(preferences);
    expect(store.get()).toMatchObject({ material: 'abs', diameter: 2.85, walls: 2 });
  });
});
