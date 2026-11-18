import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { SidebarNav } from '@/components/sidebar-nav';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * App shell: sidebar (brand, nav, account footer) + content column on
 * desktop; collapses to a horizontal top bar on narrow screens. Landing
 * and login pages live outside this route group and keep their own layout.
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

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-border md:sticky md:top-0 md:flex md:h-screen md:w-60 md:flex-col md:border-b-0 md:border-r">
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

        <div className="hidden border-t border-border px-5 py-4 md:block">
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
