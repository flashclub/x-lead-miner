import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card } from '@/components/ui/card';
import { HistoryView, type HistoryRun } from '@/components/history-view';
import { listRuns, readUserIdentity } from '@/lib/user';

export const dynamic = 'force-dynamic';

/**
 * Per-user search history (anonymous cookie identity or account — see
 * src/lib/user.ts). Server component reads the runs; the tab/sort
 * interactivity lives in HistoryView. First-time visitors (no rows) get an
 * empty state instead of a row — user rows are only created when a search is
 * recorded.
 */
export default async function HistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('history');

  const identity = await readUserIdentity();
  if (!identity) {
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

  // A DB hiccup (e.g. migration not applied yet) must not 500 the page —
  // degrade to the empty state like every other failure.
  let runs: HistoryRun[] = [];
  let usage = { searches: 0, scored: 0 };
  try {
    // sqlite datetimes are UTC without a zone suffix — tag them before Date().
    const toIso = (value: string) => `${value.replace(' ', 'T')}Z`;
    for (const run of await listRuns(identity.user.id)) {
      let posts: HistoryRun['posts'] = [];
      try {
        posts = JSON.parse(run.results) as HistoryRun['posts'];
      } catch {
        continue;
      }
      runs.push({
        id: run.id,
        query: run.query,
        searchType: run.searchType,
        capturedAtIso: toIso(run.createdAt),
        posts,
      });
    }
    usage = { searches: identity.user.searchCount, scored: identity.user.scoredCount };
  } catch (error) {
    console.warn('[history] read failed:', error instanceof Error ? error.message : error);
  }

  if (runs.length === 0) {
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

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      <div className="mt-6">
        <HistoryView runs={runs} usage={usage} locale={locale} />
      </div>
    </div>
  );
}
