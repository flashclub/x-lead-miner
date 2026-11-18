'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';

/**
 * Locale switcher — swaps the active locale in place (keeps the current
 * page). next-intl navigation keeps hrefs and route state intact.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('themeToggle');
  const pathname = usePathname();
  const router = useRouter();

  const next = locale === 'en' ? 'zh' : 'en';
  const labels = { en: 'EN', zh: '中文' } as const;

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      aria-label={t('label')}
      title={t('label')}
      className={
        className ??
        'rounded border border-border bg-surface px-2 py-0.5 font-mono text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text'
      }
    >
      {labels[next]}
    </button>
  );
}
