import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import '../globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3019';
  const title = t('title');
  const description = t('description');

  return {
    metadataBase: new URL(appUrl),
    title: {
      default: title,
      template: '%s · X Lead Miner',
    },
    description,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      siteName: 'X Lead Miner',
      title,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} font-sans`}
      >
        {/* Restore the saved theme before first paint (no flash). Light is
            the default; ThemeToggle persists the choice in localStorage. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('xlm-theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}",
          }}
        />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
