'use client';

import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Theme state, mirrored onto the document element so CSS custom properties
 * switch, and persisted so an operator's choice survives a reload.
 *
 * The initial value is read in a blocking script in the document head (see
 * layout.tsx), not here — reading it in an effect would paint the wrong theme
 * for a frame first.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) ?? 'light';
    setThemeState(current);
  }, []);

  const setTheme = (t: Theme) => {
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('lifecycle-hub-theme', t);
    } catch {
      // private browsing: the choice simply will not persist
    }
    setThemeState(t);
  };

  return [theme, setTheme];
}
