import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Preferences } from '../platform';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type Theme = 'dark' | 'light';

const KEY = 'theme';
const query = () => globalThis.matchMedia?.('(prefers-color-scheme: light)');

function systemTheme(): Theme {
  return query()?.matches ? 'light' : 'dark';
}

function subscribeToSystem(onChange: () => void) {
  const q = query();
  q?.addEventListener('change', onChange);
  return () => q?.removeEventListener('change', onChange);
}

export function resolveTheme(choice: ThemeChoice, system: Theme): Theme {
  return choice === 'system' ? system : choice;
}

/** Sets `data-theme` on <html> before React renders, so the first paint has the right colours. */
export function applyInitialTheme(preferences: Preferences): void {
  const choice = preferences.get<ThemeChoice>(KEY, 'dark');
  document.documentElement.dataset.theme = resolveTheme(choice, systemTheme());
}

/** The theme choice (dark by default), stored in preferences and applied to <html>. */
export function useTheme(preferences: Preferences) {
  const [choice, setChoiceState] = useState<ThemeChoice>(() =>
    preferences.get<ThemeChoice>(KEY, 'dark'),
  );
  const system = useSyncExternalStore(subscribeToSystem, systemTheme, () => 'dark' as const);
  const theme = resolveTheme(choice, system);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      preferences.set(KEY, next);
      setChoiceState(next);
    },
    [preferences],
  );

  return { choice, theme, setChoice };
}
