import { cookies } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { HistoryView, type HistoryRun } from '@/components/history-view';
import { ANON_COOKIE } from '@/lib/user';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Per-user search history (anonymous cookie identity — see src/lib/user.ts).
 * Server component reads the runs; the tab/sort interactivity lives in
 * HistoryView. First-time visitors (no cookie / no rows) get an empty state
 * instead of a row — user rows are only created when a search is recorded.
 */
export default async function HistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('history');

  const anonId = (await cookies()).get(ANON_COOKIE)?.value;
  if (!anonId) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-text-muted">{t('subtitle')}</p>
        <Card className="mt-6">
          <p className="text-sm text-text-muted">{t('empty')}</p>
        </Card>
      </div>
    );
  }

  const db = await getDb();
  const user = await db.user.findUnique({
    where: { anonId },
    include: { runs: { orderBy: { createdAt: 'desc' } } },
  });

  if (!user || user.runs.length === 0) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-text-muted">{t('subtitle')}</p>
        <Card className="mt-6">
          <p className="text-sm text-text-muted">{t('empty')}</p>
        </Card>
      </div>
    );
  }

  const runs: HistoryRun[] = user.runs.map((run) => ({
    id: run.id,
    query: run.query,
    searchType: run.searchType,
    capturedAtIso: run.createdAt.toISOString(),
    posts: JSON.parse(run.results) as HistoryRun['posts'],
  }));

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      <div className="mt-6">
        <HistoryView
          runs={runs}
          usage={{ searches: user.searchCount, scored: user.scoredCount }}
          locale={locale}
        />
      </div>
    </div>
  );
}
