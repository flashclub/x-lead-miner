/**
 * Shared shape of a Lead Card and of the request to get one.
 *
 * Two models score a post on this site and they are kept apart on purpose:
 *
 *   intent scorer (src/lib/intent.ts) — Workers AI bge-base embedding + a small
 *     trained head, runs inside the Worker, returns one 0–1 score. Unchanged.
 *   Lead Analyst (src/lib/analyst.ts) — Qwen3-4B + LoRA served on Modal, returns
 *     a structured card. Optional: unset or failing simply means no card.
 *
 * This module has no imports so both server routes and client components can
 * use the types. The vocabularies mirror analyst/rubric_v2.py in the
 * x-lead-intent-pipeline repo, which is what the model was trained to emit.
 */

export const INTENT_TYPES = [
  'recommend_request',
  'alternative_seek',
  'complaint',
  'feature_wish',
  'praise',
  'noise',
] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

export const BUY_STAGES = ['now', 'exploring', 'someday', 'none'] as const;
export type BuyStage = (typeof BUY_STAGES)[number];

export const DOMAINS = [
  'dev-tools',
  'marketing-seo',
  'finance-accounting',
  'design-creative',
  'productivity-notes',
  'education-learning',
  'health-fitness',
  'ecommerce-retail',
  'crm-sales',
  'communication-social',
  'content-media',
  'data-ai',
  'web-hosting',
  'hr-recruiting',
  'travel-local',
  'hardware-devices',
  'gaming',
  'other',
] as const;
export type Domain = (typeof DOMAINS)[number];

/** One card, always these seven keys (analyst canonical_card). */
export interface LeadCard {
  intent_type: IntentType;
  buy_stage: BuyStage;
  domain: Domain | string;
  /** 0–3 verbatim substrings of the post; empty for praise / noise */
  evidence: string[];
  /** one sentence */
  rationale: string;
  /** a direction a vendor could reply from, or null when none could */
  reply_angle: string | null;
  /** 0–1 selling-lead strength */
  score: number;
}

export function isLeadCard(value: unknown): value is LeadCard {
  if (typeof value !== 'object' || value === null) return false;
  const card = value as Record<string, unknown>;
  return (
    INTENT_TYPES.includes(card.intent_type as IntentType) &&
    BUY_STAGES.includes(card.buy_stage as BuyStage) &&
    typeof card.domain === 'string' &&
    Array.isArray(card.evidence) &&
    card.evidence.every((item) => typeof item === 'string') &&
    typeof card.rationale === 'string' &&
    (card.reply_angle === null || typeof card.reply_angle === 'string') &&
    typeof card.score === 'number' &&
    card.score >= 0 &&
    card.score <= 1
  );
}

/** What POST /api/leads/analyze returns per post (server strips diagnostics). */
export interface AnalyzeEntry {
  status: 'ok' | 'reject';
  attempt: number;
  card: LeadCard | null;
}

export interface AnalyzeResult {
  results: AnalyzeEntry[];
  timesSec: (number | null)[];
  elapsedSec: number;
}

/** How many posts one request may carry. Each one is a model generation. */
export const ANALYST_MAX_POSTS = 10;

/** Where the search UI draws the line for asking the analyst automatically.
 *  Same threshold the score badge already uses for its accent colour. */
export const ANALYST_AUTO_THRESHOLD = 0.7;
export const ANALYST_AUTO_MAX = 10;

export type AnalystFailureReason = 'unavailable' | 'rate' | 'budget' | 'rejected';

/** Per-post state of the analyst in the UI. `undefined` = never asked. */
export type AnalystEntry =
  | { state: 'loading'; startedAt: number }
  | { state: 'ok'; card: LeadCard; sec: number | null }
  | { state: 'failed'; reason: AnalystFailureReason };

/** After this many seconds of waiting, the UI says the model is being started. */
export const ANALYST_SLOW_AFTER_SEC = 10;

/** Browser-side give-up time. A little longer than the route's own timeout so
 *  the route's clearer error message is what the reader sees. */
export const ANALYST_CLIENT_TIMEOUT_MS = 160_000;
