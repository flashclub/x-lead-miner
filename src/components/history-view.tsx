'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
type SortKey = 'score' | 'time';

/**
 * History board: one tab per search term (newest first), and under each tab
 * the deduplicated posts that term has ever hit. Both the score and the post
 * date columns sort (click toggles direction; the other metric breaks ties,
 * descending). Default order is score desc — this is a lead queue, best leads
 * on top. A term can be deleted (tab ✕ → confirm), which removes its runs but
 * never touches the lifetime usage counters.
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

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'score', dir: 'desc' });
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  /**
   * Backfill: runs stored before score-merging existed (or during the merge
   * outage) carry score:null forever unless re-scored. One scoring attempt per
   * run per page load — the missing posts go through /api/leads/score and the
   * results are reported back through /api/history/scores (the same merge
   * path the search flow uses). A failed run is not retried this page load.
   */
  const attemptedBackfillRef = useRef<Set<string>>(new Set());
  const [backfillCount, setBackfillCount] = useState(0);
  const [backfillFailed, setBackfillFailed] = useState(false);
  useEffect(() => {
    const targets = allRuns
      .filter((run) => !attemptedBackfillRef.current.has(run.id))
      .map((run) => ({ run, missing: run.posts.filter((post) => post.score === null) }))
      .filter(({ missing }) => missing.length > 0);
    if (targets.length === 0) return;
    targets.forEach(({ run }) => attemptedBackfillRef.current.add(run.id));
    void (async () => {
      setBackfillCount(targets.reduce((sum, target) => sum + target.missing.length, 0));
      let failed = false;
      for (const { run, missing } of targets) {
        try {
          const scoreResponse = await fetch('/api/leads/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: missing.map((post) => post.text), perItem: true }),
          });
          if (!scoreResponse.ok) throw new Error(`scoring failed (HTTP ${scoreResponse.status})`);
          const data = (await scoreResponse.json()) as {
            scores?: number[];
            timesSec?: (number | null)[];
          };
          const scores = Array.isArray(data.scores) ? data.scores : [];
          if (scores.length !== missing.length) throw new Error('score response length mismatch');
          const report = await fetch('/api/history/scores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              runId: run.id,
              scores: missing.map((post, index) => ({
                id: post.id,
                score: scores[index],
                sec: Array.isArray(data.timesSec) ? data.timesSec[index] ?? null : null,
              })),
            }),
          });
          if (!report.ok) throw new Error(`merge failed (HTTP ${report.status})`);
          setAllRuns((current) =>
            current.map((stored) =>
              stored.id !== run.id
                ? stored
                : {
                    ...stored,
                    posts: stored.posts.map((post) => {
                      const index = missing.findIndex((m) => m.id === post.id);
                      return index === -1
                        ? post
                        : {
                            ...post,
                            score: scores[index],
                            sec: Array.isArray(data.timesSec) ? data.timesSec[index] ?? null : null,
                          };
                    }),
                  },
              ),
            );
        } catch {
          failed = true;
        }
      }
      setBackfillCount(0);
      if (failed) setBackfillFailed(true);
    })();
  }, [allRuns]);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: 'desc' }
    );
  }

  // Dedupe by tweet id across runs of this term, keeping the highest score
  // (ties keep the newest capture). Unscored posts and missing dates sort last.
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
    const direction = sort.dir === 'desc' ? -1 : 1;
    return [...byId.values()].sort((a, b) => {
      const [primaryA, primaryB] =
        sort.key === 'score'
          ? [a.score ?? -1, b.score ?? -1]
          : [a.createdAtIso ?? '', b.createdAtIso ?? ''];
      if (primaryA !== primaryB) {
        if (primaryA === '') return 1;
        if (primaryB === '') return -1;
        return (primaryA < primaryB ? -1 : 1) * direction;
      }
      // secondary: the other metric, always descending
      const [secondaryA, secondaryB] =
        sort.key === 'score' ? [a.createdAtIso ?? '', b.createdAtIso ?? ''] : [a.score ?? -1, b.score ?? -1];
      if (secondaryA === secondaryB) return 0;
      if (secondaryA === '') return 1;
      if (secondaryB === '') return -1;
      return (secondaryA < secondaryB ? -1 : 1) * -1;
    });
  }, [allRuns, activeQuery, sort]);

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

  function postDateLabel(iso: string | undefined): string {
    if (!iso) return '–';
    // locale conventions, year included ("Nov 26, 2026" / "2026年11月26日")
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  const arrow = (key: SortKey) =>
    sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-subtle" role="status">
        {t('usage', { searches: usage.searches, posts: usage.scored })}
      </p>

      {backfillCount > 0 && (
        <p className="text-sm text-text-subtle">{t('backfillStatus', { n: backfillCount })}</p>
      )}
      {backfillFailed && <p className="text-sm text-danger">{t('backfillFailed')}</p>}

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
                className="px-2 py-1.5 text-sm text-text-subtle transition-colors hover:text-danger"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {deleteFailed && <p className="text-sm text-danger">{t('deleteFailed')}</p>}

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
                    onClick={() => toggleSort('score')}
                    title={t('sortTitle')}
                    aria-label={t('sortTitle')}
                    className="font-normal transition-colors hover:text-text"
                  >
                    {t('colScore')}
                    {arrow('score')}
                  </button>
                </th>
                <th className="w-36 px-4 py-2.5 font-normal">
                  <button
                    type="button"
                    onClick={() => toggleSort('time')}
                    title={t('sortTimeTitle')}
                    aria-label={t('sortTimeTitle')}
                    className="font-normal transition-colors hover:text-text"
                  >
                    {t('colTime')}
                    {arrow('time')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-b border-border/60 align-top last:border-b-0">
                  <td className="px-4 py-3">
                    {/* user info on its own line — never mixed into the tweet */}
                    {post.handle && (
                      <p className="text-sm text-text-muted">
                        <a
                          href={`https://x.com/${post.handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono transition-colors hover:text-text"
                        >
                          @{post.handle}
                        </a>
                      </p>
                    )}
                    {/* tweet text with the open-on-X link attached to it */}
                    <p className="mt-1 text-sm leading-relaxed text-text">
                      {post.text}{' '}
                      <a
                        href={post.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap text-accent transition-colors hover:underline"
                      >
                        {t('openOnX')} ↗
                      </a>
                    </p>
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
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {postDateLabel(post.createdAtIso)}
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
            <p className="mt-2 text-sm text-text-subtle">{t('deleteCountersNote')}</p>
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
