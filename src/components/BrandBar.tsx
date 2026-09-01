'use client';

import { useTheme } from './useTheme';

/**
 * Brand header for pages outside the console. Keeps the parent/product
 * relationship and the theme control consistent everywhere.
 */
export default function BrandBar() {
  const [theme, setTheme] = useTheme();

  return (
    <header className="flex items-center gap-4 border-b border-line bg-surface px-4 py-2">
      <a
        href="https://clustralai.com"
        target="_blank"
        rel="noreferrer noopener"
        className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
        title="Clustral AI — the unified AI ecosystem"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/clustral-mark.png" alt="Clustral AI" className="h-7 w-7 rounded-[7px]" />
        <span className="hidden text-[12px] text-ink-faint sm:inline">Clustral AI</span>
      </a>
      <span className="h-5 w-px bg-line" aria-hidden />
      <div className="flex items-baseline gap-2.5">
        <span className="brandmark text-[18px] leading-none">Lifecycle Hub</span>
        <span className="hidden text-[11px] text-ink-faint md:inline">
          Water main failure intelligence
        </span>
      </div>
      <button
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className="ml-auto rounded-md border border-line px-2 py-1 text-[11px] text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
        title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
        aria-label="Toggle colour theme"
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  );
}
