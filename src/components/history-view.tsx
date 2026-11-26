'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * One row in a history tab: a compact snapshot of a captured tweet. Stored in
 * the run's results JSON (see src/lib/user.ts) — scores merge in later via
 * /api/history/scores, so `score` can be null when scoring never landed.
 */
export interface HistoryPost {
  id: string;
  handle: string;
  name: string | undefined;
  text: string;
  score: number | null;
  sec: number | null;
  url: string;
  createdAtIso: string | undefined;
}

export interface HistoryRun {
  id: string;
  query: string;
  searchType: string;
  capturedAtIso: string;
  posts: HistoryPost[];
}

type SortDir = 'desc' | 'asc';

/**
 * History board: one tab per search term (newest first), and under each tab
 * the deduplicated posts that term has ever hit, sortable by score. Default
 * order is score desc — this is a lead queue, best leads on top. A term can
 * be deleted (tab ✕ → confirm), which removes its runs but never touches the
 * lifetime usage counters.
 */
export function HistoryView({
  runs,
  usage,
  locale,
}: {
  runs: HistoryRun[];
  usage: { searches: number; scored: number };
  locale: string;
}) {
  const t = useTranslations('history');

  // Server truth flows in via props; deletions mutate this local copy.
  const [allRuns, setAllRuns] = useState(runs);
  useEffect(() => setAllRuns(runs), [runs]);

  // Tabs: distinct queries, most recently searched first.
  const tabs = useMemo(() => {
    const lastSeen = new Map<string, string>();
    for (const run of allRuns) {
      const prev = lastSeen.get(run.query);
      if (!prev || prev < run.capturedAtIso) lastSeen.set(run.query, run.capturedAtIso);
    }
    return [...lastSeen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([query]) => query);
  }, [allRuns]);

  const [activeQuery, setActiveQuery] = useState<string | undefined>(tabs[0]);
  useEffect(() => {
    // keep a valid selection: pick the newest tab on first load, after the
    // active term was deleted, or when the active term vanished server-side
    if (tabs.length === 0) {
      if (activeQuery !== undefined) setActiveQuery(undefined);
      return;
    }
    if (!activeQuery || !tabs.includes(activeQuery)) setActiveQuery(tabs[0]);
  }, [tabs, activeQuery]);

  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  // Dedupe by tweet id across runs of this term, keeping the highest score
  // (ties keep the newest capture). Unscored posts sort last in both directions.
  const posts = useMemo(() => {
    const active = allRuns.filter((run) => run.query === activeQuery);
    const byId = new Map<string, HistoryPost>();
    for (const run of active) {
      for (const post of run.posts) {
        const existing = byId.get(post.id);
        if (!existing || ((post.score ?? -1) > (existing.score ?? -1) && post.score !== null)) {
          byId.set(post.id, post);
        }
      }
    }
    const direction = sortDir === 'desc' ? -1 : 1;
    return [...byId.values()].sort((a, b) => {
      const scoreA = a.score ?? -1;
      const scoreB = b.score ?? -1;
      if (scoreA !== scoreB) return (scoreA - scoreB) * direction;
      // secondary: newest capture first
      return (b.createdAtIso ?? '').localeCompare(a.createdAtIso ?? '');
    });
  }, [allRuns, activeQuery, sortDir]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      const response = await fetch('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: pendingDelete }),
      });
      if (!response.ok) throw new Error(`delete failed (HTTP ${response.status})`);
      const deletedQuery = pendingDelete;
      setAllRuns((current) => current.filter((run) => run.query !== deletedQuery));
      if (activeQuery === deletedQuery) setActiveQuery(undefined);
      setPendingDelete(null);
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  }

  const runCountFor = (query: string) => allRuns.filter((run) => run.query === query).length;
  const postCountFor = (query: string) =>
    allRuns.filter((run) => run.query === query).reduce((sum, run) => sum + run.posts.length, 0);

  function toggleSort() {
    setSortDir((current) => (current === 'desc' ? 'asc' : 'desc'));
  }

  function capturedLabel(iso: string | undefined): string {
    if (!iso) return '–';
    return new Date(iso).toLocaleString(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="space-y-4">
      <p className="font-mono text-sm text-text-subtle" role="status">
        {t('usage', { searches: usage.searches, posts: usage.scored })}
      </p>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('title')}>
        {tabs.map((query) => {
          const active = query === activeQuery;
          return (
            <div
              key={query}
              className={cn(
                'flex items-center overflow-hidden rounded-md border',
                active
                  ? 'border-accent bg-accent-soft'
                  : 'border-border bg-surface hover:border-border-strong'
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveQuery(query)}
                className={cn(
                  'max-w-full truncate py-1.5 pl-3 text-sm',
                  active ? 'font-medium text-accent' : 'text-text-muted'
                )}
                title={query}
              >
                {query}
              </button>
              <button
                type="button"
                aria-label={`${t('deleteLabel')}: ${query}`}
                title={t('deleteLabel')}
                onClick={() => setPendingDelete(query)}
                className="px-2 py-1.5 text-xs text-text-subtle transition-colors hover:text-danger"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {deleteFailed && <p className="text-xs text-danger">{t('deleteFailed')}</p>}

      {posts.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">{t('tabEmpty')}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-border font-mono text-xs text-text-subtle">
                <th className="px-4 py-2.5 font-normal">{t('colPost')}</th>
                <th className="w-24 px-2 py-2.5 font-normal">
                  <button
                    type="button"
                    onClick={toggleSort}
                    title={t('sortTitle')}
                    aria-label={t('sortTitle')}
                    className="font-normal text-text-subtle transition-colors hover:text-text"
                  >
                    {t('colScore')} {sortDir === 'desc' ? '↓' : '↑'}
                  </button>
                </th>
                <th className="w-32 px-4 py-2.5 font-normal">{t('colTime')}</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-b border-border/60 align-top last:border-b-0">
                  <td className="px-4 py-3">
                    <p className="leading-relaxed text-text">
                      {post.handle && (
                        <a
                          href={`https://x.com/${post.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-xs text-text-muted hover:text-text"
                        >
                          @{post.handle}{' '}
                        </a>
                      )}
                      {post.text}
                    </p>
                    <a
                      href={post.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-xs text-accent hover:underline"
                    >
                      {t('openOnX')} ↗
                    </a>
                  </td>
                  <td className="px-2 py-3">
                    {post.score !== undefined && post.score !== null ? (
                      <span
                        className={`rounded bg-accent-soft px-1.5 font-mono text-sm ${
                          post.score >= 0.7 ? 'text-accent' : 'text-text-muted'
                        }`}
                      >
                        {(post.score * 100).toFixed(0)}
                      </span>
                    ) : (
                      <span className="font-mono text-sm text-text-subtle">–</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-subtle">
                    {capturedLabel(post.createdAtIso)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pendingDelete !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('deleteTitle')}
        >
          <Card className="w-full max-w-md p-6">
            <h2 className="font-display text-lg font-semibold">{t('deleteTitle')}</h2>
            <p className="mt-3 break-words text-sm leading-relaxed text-text-muted">
              {t('deleteBody', {
                query: pendingDelete,
                runs: runCountFor(pendingDelete),
                posts: postCountFor(pendingDelete),
              })}
            </p>
            <p className="mt-2 text-xs text-text-subtle">{t('deleteCountersNote')}</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-text-muted transition-colors hover:text-text"
              >
                {t('deleteKeep')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
                className="flex-1 rounded-md border border-danger px-3 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
              >
                {deleting ? t('deleting') : t('deleteGo')}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
