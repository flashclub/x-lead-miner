import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LeadSearch } from '@/components/lead-search';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('leadSearch');

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      <div className="mt-6">
        <LeadSearch />
      </div>
    </div>
  );
}
