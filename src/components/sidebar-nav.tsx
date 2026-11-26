'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

const NAV_ITEMS = [
  { href: '/dashboard', labelKey: 'search' },
  { href: '/history', labelKey: 'history' },
  { href: '/mcp', labelKey: 'mcp' },
] as const;

/**
 * Dashboard nav with active-state highlight. Client component because the
 * active item depends on the current pathname (server layout can't see it).
 */
export function SidebarNav() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <nav
      aria-label="Dashboard"
      className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:gap-0.5 md:overflow-visible md:px-3 md:pb-0"
    >
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
              active
                ? 'bg-surface-2 font-medium text-accent'
                : 'text-text-muted hover:bg-surface-2 hover:text-text'
            }`}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
