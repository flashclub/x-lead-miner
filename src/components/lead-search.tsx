'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { XPost } from '@/lib/x-api';

type SearchType = 'Latest' | 'Top';

const EXAMPLE_QUERIES = [
  '"anyone recommend" lang:en -filter:replies',
  '"I wish there was" app lang:en',
  '"alternative to" lang:en -filter:replies',
];

function fmtCount(count: number | undefined): string {
  if (count === undefined) return '–';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

// Module-level on purpose: Date.now() is impure and must not run during
// render (react-hooks/purity). The translator is injected from the component.
type TimeAgoT = ((key: 'minutesAgo' | 'hoursAgo' | 'daysAgo', values: { n: number }) => string);

function timeAgo(iso: string | undefined, t: TimeAgoT): string {
  if (!iso) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 3600) return t('minutesAgo', { n: Math.max(1, Math.floor(seconds / 60)) });
  if (seconds < 86_400) return t('hoursAgo', { n: Math.floor(seconds / 3600) });
  return t('daysAgo', { n: Math.floor(seconds / 86_400) });
}

export function LeadSearch() {
  const t = useTranslations('leadSearch');
  const [query, setQuery] = useState(EXAMPLE_QUERIES[0]);
  const [searchType, setSearchType] = useState<SearchType>('Latest');
  const [posts, setPosts] = useState<XPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [scoringSec, setScoringSec] = useState<string | null>(null);
  const [scoringPending, setScoringPending] = useState(false);
  const searchSeqRef = useRef(0);

  // Results render immediately; scores stream in asynchronously per batch,
  // each post carrying its OWN model latency (per-item timing server-side).
  // searchSeqRef guards against stale responses when a new search starts.
  async function scoreBatch(seq: number, batch: XPost[]) {
    if (batch.length === 0) return;
    setScoringPending(true);
    try {
      const response = await fetch('/api/leads/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: batch.map((post) => post.text), perItem: true }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        scores?: number[];
        timesSec?: number[];
        elapsedSec?: number;
      };
      if (searchSeqRef.current !== seq) return; // a newer search superseded this batch
      if (!Array.isArray(data.scores) || data.scores.length !== batch.length) return;
      const scoreById = new Map<string, { score: number; sec: number | undefined }>();
      batch.forEach((post, index) =>
        scoreById.set(post.id, {
          score: data.scores![index],
          sec: Array.isArray(data.timesSec) ? data.timesSec[index] : undefined,
        })
      );
      setPosts((current) =>
        current.map((post) => {
          const hit = scoreById.get(post.id);
          return hit
            ? { ...post, intentScore: hit.score, intentScoreSec: hit.sec }
            : post;
        })
      );
      if (typeof data.elapsedSec === 'number') {
        setScoringSec(data.elapsedSec.toFixed(4));
      }
    } catch {
      // scoring is best-effort — never surface it as a search error
    } finally {
      if (searchSeqRef.current === seq) setScoringPending(false);
    }
  }

  async function runSearch(append: boolean, cursor?: string) {
    if (!query.trim() || loading || loadingMore) return;
    searchSeqRef.current += 1;
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({ query, searchType });
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`/api/leads/search?${params.toString()}`);
      const data = (await response.json()) as
        | { posts: XPost[]; nextCursor?: string }
        | { error: string };
      if (!response.ok || 'error' in data) {
        setError('error' in data ? data.error : `Search failed (HTTP ${response.status})`);
        return;
      }
      const fresh = data.posts;
      setPosts((current) => (append ? [...current, ...fresh] : fresh));
      setNextCursor(data.nextCursor);
      setHasSearched(true);
      void scoreBatch(searchSeqRef.current, fresh);
    } catch {
      setError(t('requestFailed'));
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(false);
        }}
        className="space-y-2"
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('placeholder')}
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
          />
          <select
            value={searchType}
            onChange={(event) => setSearchType(event.target.value as SearchType)}
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
            aria-label={t('ordering')}
          >
            <option value="Latest">Latest</option>
            <option value="Top">Top</option>
          </select>
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? t('searching') : t('search')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-subtle">
          <span>{t('tryLabel')}</span>
          {EXAMPLE_QUERIES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setQuery(example);
                void runSearch(false);
              }}
              className="rounded border border-border bg-surface px-2 py-0.5 font-mono text-text-muted transition-colors hover:border-border-strong hover:text-text"
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <div className="rounded-md border border-border-strong bg-surface px-4 py-3 text-sm text-text">
          <span className="font-medium">{t('failedPrefix')}</span> {error}
        </div>
      )}

      {hasSearched && posts.length === 0 && !loading && !error && (
        <Card>
          <p className="text-sm text-text-muted">{t('empty')}</p>
        </Card>
      )}

      {posts.length > 0 && (
        <div className="space-y-3" aria-live="polite">
          {(scoringPending || scoringSec) && (
            <p className="font-mono text-sm text-text-subtle" role="status">
              {scoringPending
                ? t('scoringInProgress')
                : t('scoringTime', { sec: scoringSec ?? '0.0000' })}
            </p>
          )}
          {posts.map((post) => (
            <Card key={post.id} className="p-5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {post.author.name && <span className="font-medium">{post.author.name}</span>}
                <a
                  href={`https://x.com/${post.author.handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-sm text-text-muted hover:text-text"
                >
                  @{post.author.handle}
                </a>
                {post.author.verified && (
                  <span aria-label={t('verified')} className="font-mono text-sm text-accent">
                    ✓
                  </span>
                )}
                <span className="text-sm text-text-subtle">
                  {fmtCount(post.author.followers)} {t('followers')}
                </span>
                {post.intentScore !== undefined && (
                  <>
                    <span
                      title={t('scoreTitle')}
                      className={`rounded bg-accent-soft px-1.5 font-mono text-sm ${
                        post.intentScore >= 0.7 ? 'text-accent' : 'text-text-muted'
                      }`}
                    >
                      score {(post.intentScore * 100).toFixed(0)}
                    </span>
                    {post.intentScoreSec !== undefined && (
                      <span
                        title={t('scoreTimeTitle')}
                        className="font-mono text-xs text-text-subtle"
                      >
                        {post.intentScoreSec.toFixed(4)}s
                      </span>
                    )}
                  </>
                )}
                <span className="ml-auto font-mono text-sm text-text-subtle">
                  {timeAgo(post.createdAtIso, t)}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {post.text}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm text-text-subtle">
                  {fmtCount(post.metrics.favorites)} {t('favs')} ·{' '}
                  {fmtCount(post.metrics.replies)} {t('replies')} ·{' '}
                  {fmtCount(post.metrics.views)} {t('views')}
                </span>
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  {t('openOnX')}
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}

      {hasSearched && nextCursor && (
        <div className="pt-1">
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() => void runSearch(true, nextCursor)}
          >
            {loadingMore ? t('loadingMore') : t('loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
