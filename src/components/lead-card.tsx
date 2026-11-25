'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ANALYST_SLOW_AFTER_SEC,
  type AnalystEntry,
  type LeadCard,
} from '@/lib/lead-card-types';

interface LeadCardViewProps {
  /** undefined = the analyst has not been asked about this post yet */
  entry: AnalystEntry | undefined;
  onAnalyze: () => void;
}

/**
 * The Lead Analyst's take on one post, rendered under that post.
 *
 * A one-line summary is always visible once a card exists (type · stage ·
 * domain · strength · latency); the quoted evidence, the reason and the reply
 * direction sit behind a native <details>, so a list of posts stays scannable.
 * The intent score badge next to the author belongs to the other model
 * (src/lib/intent.ts) and is rendered by the parent, untouched.
 */
export function LeadCardView({ entry, onAnalyze }: LeadCardViewProps) {
  const t = useTranslations('leadAnalyst');
  const [now, setNow] = useState(Date.now());

  // seconds since the request started — Date.now() must not run during render
  useEffect(() => {
    if (entry?.state !== 'loading') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [entry?.state]);

  if (!entry) {
    return (
      <div className="mt-3">
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onAnalyze} title={t('analyzeTitle')}>
          + {t('analyze')}
        </Button>
      </div>
    );
  }

  if (entry.state === 'loading') {
    const elapsed = Math.max(0, Math.floor((now - entry.startedAt) / 1000));
    return (
      <p className="mt-3 font-mono text-xs text-text-subtle" role="status">
        {t('analyzingElapsed', { sec: elapsed })}
        {elapsed >= ANALYST_SLOW_AFTER_SEC && <span className="ml-2">· {t('wakingHint')}</span>}
      </p>
    );
  }

  if (entry.state === 'failed') {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs text-text-subtle">
        <span>{t(`failed.${entry.reason}`)}</span>
        {entry.reason === 'unavailable' && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onAnalyze}>
            {t('retry')}
          </Button>
        )}
      </div>
    );
  }

  return <CardBody card={entry.card} sec={entry.sec} />;
}

function CardBody({ card, sec }: { card: LeadCard; sec: number | null }) {
  const t = useTranslations('leadAnalyst');
  return (
    <div className="mt-3 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-accent bg-accent-soft text-accent">
          {t(`intent.${card.intent_type}`)}
        </Badge>
        <Badge>{t(`stage.${card.buy_stage}`)}</Badge>
        <Badge>{t(`domain.${card.domain}`)}</Badge>
        <span className="font-mono text-sm text-text">
          {t('strength')} {(card.score * 100).toFixed(0)}
        </span>
        {sec !== null && (
          <span className="font-mono text-xs text-text-subtle" title={t('cardTimeTitle')}>
            {t('seconds', { sec: sec.toFixed(2) })}
          </span>
        )}
      </div>
      <details className="mt-2 group">
        <summary className="cursor-pointer select-none font-mono text-xs text-text-muted hover:text-text">
          {t('details')}
        </summary>
        <dl className="mt-2 space-y-2 text-sm">
          {card.evidence.length > 0 && (
            <div>
              <dt className="font-mono text-xs text-text-subtle">{t('evidence')}</dt>
              {card.evidence.map((quote, index) => (
                <dd
                  key={`${index}-${quote}`}
                  className="mt-1 border-l-2 border-accent pl-3 text-text-muted"
                >
                  “{quote}”
                </dd>
              ))}
            </div>
          )}
          <div>
            <dt className="font-mono text-xs text-text-subtle">{t('rationale')}</dt>
            <dd className="mt-0.5 text-text">{card.rationale}</dd>
          </div>
          <div>
            <dt className="font-mono text-xs text-text-subtle">{t('replyHint')}</dt>
            <dd className="mt-0.5 text-text">
              {card.reply_angle ?? <span className="text-text-subtle">{t('noReplyHint')}</span>}
            </dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
