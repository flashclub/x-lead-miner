import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { auth, devBypass, enabledProviders, signIn } from '@/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Sign-in page. Providers render only when their credentials exist (see
 * src/auth.ts); when DEV_BYPASS_AUTH is set outside production a direct-entry
 * button keeps local development working without any OAuth setup.
 */
export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('login');

  const session = await auth();
  if (session?.user) redirect('/dashboard');

  async function continueWithGitHub() {
    'use server';
    await signIn('github', { redirectTo: '/dashboard' });
  }

  async function continueWithGoogle() {
    'use server';
    await signIn('google', { redirectTo: '/dashboard' });
  }

  async function continueWithDev() {
    'use server';
    await signIn('dev', { redirectTo: '/dashboard' });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>

      <Card className="mt-6 space-y-3 p-6">
        {enabledProviders.includes('github') && (
          <form action={continueWithGitHub}>
            <Button type="submit" variant="secondary" className="w-full">
              {t('github')}
            </Button>
          </form>
        )}
        {enabledProviders.includes('google') && (
          <form action={continueWithGoogle}>
            <Button type="submit" variant="secondary" className="w-full">
              {t('google')}
            </Button>
          </form>
        )}

        {enabledProviders.length === 0 && !devBypass && (
          <p className="text-sm leading-relaxed text-text-muted">{t('unconfigured')}</p>
        )}

        {devBypass && (
          <form action={continueWithDev}>
            <Button type="submit" className="w-full">
              {t('devButton')}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
