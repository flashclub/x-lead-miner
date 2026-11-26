'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { signOutAction } from '@/app/actions';

const NAV_ITEMS = [
  { href: '/dashboard', labelKey: 'search' },
  { href: '/history', labelKey: 'history' },
  { href: '/mcp', labelKey: 'mcp' },
] as const;

/**
 * Dashboard nav with active-state highlight. Client component because the
 * active item depends on the current pathname (server layout can't see it).
 * The identity footer (email + sign-out, or a sign-in link) comes from the
 * server layout via props — the session is resolved server-side.
 */
export function SidebarNav({ email }: { email?: string | null }) {
  const t = useTranslations('nav');
  const ts = useTranslations('shell');
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

      {/* Identity footer — desktop only; mobile keeps the landing sign-in. */}
      <div className="mt-auto hidden border-t border-border px-0 pt-3 md:block">
        {email ? (
          <>
            <p className="truncate px-3 font-mono text-xs text-text-subtle" title={email}>
              {email}
            </p>
            <form action={signOutAction}>
              <button
                type="submit"
                className="w-full rounded-md px-3 py-2 text-left text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {ts('signOut')}
              </button>
            </form>
          </>
        ) : (
          <Link
            href="/login"
            className="block rounded-md px-3 py-2 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            {ts('signIn')}
          </Link>
        )}
      </div>
    </nav>
  );
}
