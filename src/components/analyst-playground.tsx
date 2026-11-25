'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LeadCardView } from '@/components/lead-card';
import {
  ANALYST_CLIENT_TIMEOUT_MS,
  isLeadCard,
  type AnalystEntry,
  type AnalystFailureReason,
} from '@/lib/lead-card-types';

type ScoreState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'ok'; value: number; sec: number | null };

/**
 * Paste one post, see both models on it side by side.
 *
 * Left: the intent scorer (bge-base + small head, inside the Worker) with its
 * 0–1 score. Right: the Lead Analyst (Qwen3-4B + LoRA on Modal) with a lead
 * card. The two requests are independent — one failing never hides the other.
 * Nothing here runs on page load: both models are called only when the reader
 * presses the button.
 */
export function AnalystPlayground() {
  const t = useTranslations('leadAnalyst');
  const [text, setText] = useState(() => t('playground.example'));
  const [score, setScore] = useState<ScoreState>({ state: 'idle' });
  const [entry, setEntry] = useState<AnalystEntry | undefined>(undefined);

  async function run() {
    const post = text.trim();
    if (!post) return;

    setScore({ state: 'loading' });
    setEntry({ state: 'loading', startedAt: Date.now() });

    void (async () => {
      try {
        const response = await fetch('/api/leads/score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: [post], perItem: true }),
        });
        const data = (await response.json()) as { scores?: unknown; timesSec?: unknown };
        const value = Array.isArray(data.scores) ? data.scores[0] : undefined;
        if (!response.ok || typeof value !== 'number') {
          setScore({ state: 'failed' });
          return;
        }
        const sec = Array.isArray(data.timesSec) ? data.timesSec[0] : null;
        setScore({ state: 'ok', value, sec: typeof sec === 'number' ? sec : null });
      } catch {
        setScore({ state: 'failed' });
      }
    })();

    const fail = (reason: AnalystFailureReason) => setEntry({ state: 'failed', reason });
    try {
      const response = await fetch('/api/leads/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [post] }),
        signal: AbortSignal.timeout(ANALYST_CLIENT_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { code?: string };
        if (response.status === 429) fail(body.code === 'budget' ? 'budget' : 'rate');
        else fail('unavailable');
        return;
      }
      const data = (await response.json()) as { results?: { status?: unknown; card?: unknown }[]; timesSec?: unknown };
      const first = data.results?.[0];
      const sec = Array.isArray(data.timesSec) ? data.timesSec[0] : null;
      if (first?.status === 'ok' && isLeadCard(first.card)) {
        setEntry({ state: 'ok', card: first.card, sec: typeof sec === 'number' ? sec : null });
      } else {
        fail('rejected');
      }
    } catch {
      fail('unavailable');
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">{t('playground.title')}</h2>
      <p className="mt-2 text-sm text-text-muted">{t('playground.subtitle')}</p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        aria-label={t('playground.postLabel')}
        className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text focus:border-border-strong"
      />
      <div className="mt-3">
        <Button type="button" onClick={() => void run()}>
          {t('playground.run')}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-border p-4">
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-subtle">
            {t('scorerName')}
          </h3>
          {score.state === 'ok' ? (
            <>
              <p className="mt-2 font-mono text-4xl text-accent" data-testid="scorer-score">
                {(score.value * 100).toFixed(0)}
              </p>
              <p className="mt-1 font-mono text-xs text-text-subtle">
                {t('playground.scoreOf100')}
                {score.sec !== null && ` · ${t('seconds', { sec: score.sec.toFixed(4) })}`}
              </p>
            </>
          ) : score.state === 'loading' ? (
            <p className="mt-2 font-mono text-sm text-text-subtle" role="status">
              {t('playground.scorerRunning')}
            </p>
          ) : score.state === 'failed' ? (
            <p className="mt-2 font-mono text-sm text-text-subtle">{t('playground.scorerUnavailable')}</p>
          ) : (
            <p className="mt-2 font-mono text-sm text-text-subtle">{t('playground.waiting')}</p>
          )}
        </div>

        <div className="rounded-md border border-border p-4" data-testid="playground-analyst">
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-subtle">{t('name')}</h3>
          <LeadCardView entry={entry} onAnalyze={() => void run()} />
        </div>
      </div>
    </Card>
  );
}
