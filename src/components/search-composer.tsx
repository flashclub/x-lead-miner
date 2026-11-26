'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { SelectMenu, type SelectMenuOption } from '@/components/ui/select-menu';
import type { SearchType } from '@/lib/x-api';

/** The composer only offers the two orderings the search route exposes. */
type ComposerSearchType = Extract<SearchType, 'Latest' | 'Top'>;
import { cn } from '@/lib/cn';

/**
 * Zero-learning-cost search composer: the visitor picks an intent phrase chip,
 * optionally a topic keyword, and tweaks filters — the composer assembles the
 * X advanced-query string behind the scenes (previewed in mono text).
 *
 * Visual recipe: Aceternity UI's Tabs (pill segmented control), outline
 * buttons (chips) and signup-form input (glow on focus) — rebuilt with the
 * repo's semantic tokens and pure CSS transitions (DESIGN.md forbids
 * animation libraries).
 */

/** Curated intent phrases — the X-syntax side of each chip. */
const PHRASES = {
  recommend: 'anyone recommend',
  app: 'is there an app that',
  wish: 'I wish there was',
  alternative: 'alternative to',
  looking: 'looking for',
  switching: 'switching from',
} as const;

type PhraseKey = keyof typeof PHRASES;
type Timeframe = 'any' | '24h' | '7d' | '30d';
type MinFaves = 'any' | '10' | '50' | '100';

const TIMEFRAME_DAYS: Record<Exclude<Timeframe, 'any'>, number> = { '24h': 1, '7d': 7, '30d': 30 };

function daysAgoIso(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

export function SearchComposer({
  onSearch,
  disabled,
}: {
  /** Fired with the fully composed query on submit. */
  onSearch: (query: string, searchType: ComposerSearchType) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('leadSearch');

  const [phraseKey, setPhraseKey] = useState<PhraseKey | 'custom'>('recommend');
  const [customPhrase, setCustomPhrase] = useState('');
  const [topic, setTopic] = useState('');
  const [langEn, setLangEn] = useState(true);
  const [excludeReplies, setExcludeReplies] = useState(false);
  const [timeframe, setTimeframe] = useState<Timeframe>('any');
  /** The literal since: date, set only in event handlers — Date.now() must
   *  never run during render (react-hooks/purity / hydration mismatch). */
  const [sinceDate, setSinceDate] = useState('');
  const [minFaves, setMinFaves] = useState<MinFaves>('any');
  const [searchType, setSearchType] = useState<ComposerSearchType>('Latest');

  const phraseOptions = (Object.keys(PHRASES) as PhraseKey[]).map((key) => ({
    key,
    label: t(`phrases.${key}`),
    phrase: PHRASES[key],
  }));

  const phrase =
    phraseKey === 'custom'
      ? `"${customPhrase.trim().replace(/"/g, '')}"`
      : `"${PHRASES[phraseKey]}"`;

  const query = useMemo(() => {
    const parts = [phrase];
    const topicTrimmed = topic.trim();
    if (topicTrimmed) parts.push(topicTrimmed);
    if (langEn) parts.push('lang:en');
    if (excludeReplies) parts.push('-filter:replies');
    if (sinceDate) parts.push(`since:${sinceDate}`);
    if (minFaves !== 'any') parts.push(`min_faves:${minFaves}`);
    return parts.join(' ');
  }, [phrase, topic, langEn, excludeReplies, sinceDate, minFaves]);

  const preview = query;

  const timeframeOptions: SelectMenuOption<Timeframe>[] = [
    { label: t('timeAny'), value: 'any' },
    { label: t('time24h'), value: '24h' },
    { label: t('time7d'), value: '7d' },
    { label: t('time30d'), value: '30d' },
  ];
  const favesOptions: SelectMenuOption<MinFaves>[] = [
    { label: t('favesAny'), value: 'any' },
    { label: '10+', value: '10' },
    { label: '50+', value: '50' },
    { label: '100+', value: '100' },
  ];
  const langOptions: SelectMenuOption<'en' | 'any'>[] = [
    { label: t('langEn'), value: 'en' },
    { label: t('langAny'), value: 'any' },
  ];

  function onTimeframeChange(value: Timeframe) {
    setTimeframe(value);
    setSinceDate(value === 'any' ? '' : daysAgoIso(TIMEFRAME_DAYS[value]));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSearch(query, searchType);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* intent phrase chips — the "formula" becomes a single click */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-text-subtle">{t('phraseLabel')}</p>
        <div className="flex flex-wrap gap-2">
          {phraseOptions.map(({ key, label }) => {
            const active = phraseKey === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setPhraseKey(key)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'border-accent bg-accent-soft font-medium text-accent'
                    : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text'
                )}
              >
                {label}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={phraseKey === 'custom'}
            onClick={() => setPhraseKey('custom')}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              phraseKey === 'custom'
                ? 'border-accent bg-accent-soft font-medium text-accent'
                : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text'
            )}
          >
            ✎ {t('custom')}
          </button>
        </div>
        {phraseKey === 'custom' && (
          <input
            type="text"
            value={customPhrase}
            onChange={(event) => setCustomPhrase(event.target.value)}
            placeholder={t('customPlaceholder')}
            autoFocus
            className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
          />
        )}
      </div>

      {/* optional topic keyword */}
      <div>
        <label htmlFor="composer-topic" className="mb-1.5 block text-sm font-medium text-text-subtle">
          {t('topicLabel')}
        </label>
        <input
          id="composer-topic"
          type="text"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder={t('topicPlaceholder')}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-text-subtle focus:border-border-strong"
        />
      </div>

      {/* filters — every default is sane, nothing here is required */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SelectMenu
          ariaLabel={t('filterTime')}
          value={timeframe}
          options={timeframeOptions}
          onChange={onTimeframeChange}
        />
        <SelectMenu
          ariaLabel={t('filterFaves')}
          value={minFaves}
          options={favesOptions}
          onChange={setMinFaves}
        />
        <SelectMenu
          ariaLabel={t('langLabel')}
          value={langEn ? 'en' : 'any'}
          options={langOptions}
          onChange={(value) => setLangEn(value === 'en')}
        />
        <button
          type="button"
          aria-pressed={excludeReplies}
          onClick={() => setExcludeReplies((current) => !current)}
          className={cn(
            'rounded-md border px-2.5 py-1.5 text-sm transition-colors',
            excludeReplies
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text'
          )}
        >
          {excludeReplies ? '✓ ' : ''}
          {t('excludeReplies')}
        </button>
        <div className="ml-auto">
          <Segmented
            ariaLabel={t('sortLabel')}
            value={searchType}
            options={[
              [t('sortLatest'), 'Latest'],
              [t('sortTop'), 'Top'],
            ]}
            onChange={setSearchType}
          />
        </div>
      </div>

      {/* submit + transparent preview of the composed query */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={disabled}>
          {disabled ? t('searching') : t('search')}
        </Button>
        <p className="min-w-0 flex-1 truncate font-mono text-sm text-text-subtle" title={preview}>
          {t('previewLabel')}: {preview}
        </p>
      </div>
    </form>
  );
}
