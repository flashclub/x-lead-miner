import { getTranslations, setRequestLocale } from 'next-intl/server';
import { enabledProviders } from '@/auth';
import { FREE_POST_LIMIT, readUserIdentity } from '@/lib/user';
import { LeadSearch } from '@/components/lead-search';

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('leadSearch');

  // Proactive gate: an anonymous visitor already over the free quota sees the
  // sign-in modal the moment the page opens, not only on a failed search.
  let initialQuota: { used: number; limit: number | null; loggedIn: boolean } | null = null;
  let initialGateOpen = false;
  try {
    const identity = await readUserIdentity();
    if (identity) {
      initialQuota = {
        used: identity.user.scoredCount,
        limit: identity.loggedIn ? null : FREE_POST_LIMIT,
        loggedIn: identity.loggedIn,
      };
      initialGateOpen = !identity.loggedIn && identity.user.scoredCount >= FREE_POST_LIMIT;
    }
  } catch (error) {
    console.warn(
      '[dashboard] quota precheck failed:',
      error instanceof Error ? error.message : error
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      <div className="mt-6">
        <LeadSearch
          initialQuota={initialQuota}
          initialGateOpen={initialGateOpen}
          enabledProviders={enabledProviders}
        />
      </div>
    </div>
  );
}
