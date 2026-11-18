import { getTranslations, setRequestLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { PLANS, isProPlan } from '@/lib/plans';
import { Link } from '@/i18n/navigation';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckoutButton } from '@/components/checkout-button';

export default async function BillingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('billing');

  const session = await auth();
  const currentPlan = (session?.user as { plan?: string } | undefined)?.plan ?? 'free';
  const isPro = isProPlan(currentPlan);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">
        {t('currentPlan')} <strong className="text-text">{currentPlan}</strong>
      </p>

      <div className="mt-8 grid max-w-2xl gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-display text-xl font-semibold">{PLANS.free.name}</h2>
          <p className="mt-1 text-text-muted">{PLANS.free.priceLabel}</p>
          {isPro ? (
            <p className="mt-4 text-sm text-text-subtle">{t('onPro')}</p>
          ) : (
            <p className="mt-4 text-sm text-text-subtle">{t('onFree')}</p>
          )}
        </Card>
        <Card className="border-accent">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-semibold">{PLANS.pro.name}</h2>
            <Badge className="border-accent text-accent">{t('popular')}</Badge>
          </div>
          <p className="mt-1 text-text-muted">{PLANS.pro.priceLabel}</p>
          <div className="mt-4">
            {isPro ? (
              <p className="text-sm text-text-subtle">{t('onPro')}</p>
            ) : (
              <CheckoutButton />
            )}
          </div>
        </Card>
      </div>

      <p className="mt-6 text-sm text-text-subtle">
        <Link href="/dashboard" className="underline-offset-4 hover:underline">
          {t('back')}
        </Link>
      </p>
    </div>
  );
}
