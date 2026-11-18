import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Button } from '@/components/ui/button';

import { signIn } from '@/lib/auth';
import { isDevAuthBypass } from '@/lib/dev-auth';

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('login');
  const bypass = isDevAuthBypass();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
      </div>
      {bypass && (
        // Shown before the OAuth forms: with DEV_BYPASS_AUTH=true no provider
        // is configured, so the direct entry is the working path in dev.
        <Button href="/dashboard" className="w-full">
          {t('devButton')}
        </Button>
      )}
      <div className="space-y-3">
        <form
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: '/dashboard' });
          }}
        >
          <Button variant="primary" className="w-full" type="submit">
            {t('github')}
          </Button>
        </form>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/dashboard' });
          }}
        >
          <Button variant="secondary" className="w-full" type="submit">
            {t('google')}
          </Button>
        </form>
      </div>
    </div>
  );
}
