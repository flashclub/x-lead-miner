'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

const STORAGE_KEY = 'xlm-theme';

/**
 * ThemeToggle — flips the app's light/dark palettes by toggling `data-theme`
 * on <html> and persisting the choice in localStorage. Holds no React state:
 * the sun/moon glyphs are swapped by CSS rules in globals.css, so there is
 * no hydration mismatch and no flash. Light is the default; the inline
 * script in layout.tsx restores a saved 'dark' before first paint.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('themeToggle');

  function toggleTheme() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    if (next === 'dark') {
      root.dataset.theme = 'dark';
    } else {
      delete root.dataset.theme;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode) — theme still applies for this view.
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={t('label')}
      title={t('label')}
      className={cn(
        'font-mono text-base leading-none text-text-muted transition-colors hover:text-text',
        className,
      )}
    >
      <span aria-hidden="true" className="theme-toggle-moon">
        ☾
      </span>
      <span aria-hidden="true" className="theme-toggle-sun">
        ☀
      </span>
    </button>
  );
}
