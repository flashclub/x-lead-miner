import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { auth } from '@/auth';
import { signOutAction } from '@/app/actions';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SidebarNav } from '@/components/sidebar-nav';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * App shell. The sidebar NEVER scrolls with the content: on desktop it is
 * `fixed` (content column compensates with md:pl-60), on mobile the brand bar
 * is `sticky top-0`. Identity lives on ONE line in the desktop footer.
 * Landing and login pages live outside this route group and keep their own
 * layout.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('shell');
  const session = await auth();
  const email = session?.user?.email ?? null;

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 z-40 border-b border-border bg-bg md:fixed md:inset-y-0 md:left-0 md:z-40 md:flex md:h-screen md:w-60 md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            X Lead Miner
          </Link>
          <div className="flex items-center gap-2 md:hidden">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>

        <SidebarNav />

        {/* identity + controls, one line */}
        <div className="hidden items-center justify-between gap-2 border-t border-border px-5 py-3 md:flex">
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
          {email ? (
            <div className="flex min-w-0 items-center gap-2">
              <span className="max-w-[104px] truncate font-mono text-xs text-text-subtle" title={email}>
                {email}
              </span>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="whitespace-nowrap text-xs text-text-muted transition-colors hover:text-text"
                >
                  {t('signOut')}
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="whitespace-nowrap text-xs text-text-muted transition-colors hover:text-text"
            >
              {t('signIn')}
            </Link>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 md:pl-60">
        <div className="w-full px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
