import { getServerVar } from './server-env';
import {
  ANALYST_MAX_POSTS,
  isLeadCard,
  type AnalyzeEntry,
  type AnalyzeResult,
} from './lead-card-types';

/**
 * Lead Analyst client — the SECOND model on this site.
 *
 * It calls an HTTPS endpoint on Modal (vLLM + the trained LoRA adapter; see
 * docs/lead-analyst.md). It is deliberately separate from the intent scorer in
 * ./intent.ts: nothing here reads or writes that module, so the scorer, the
 * landing-page pipeline and the browser extension behave exactly as before
 * whether or not the analyst is configured.
 *
 * Server-side only: the Modal proxy token must never reach the browser.
 */

/** A cold engine has to load an 8 GB model first, so the first request after a
 *  quiet period is slow. The browser shows a "starting the model" note while
 *  it waits; give up after this. */
const ANALYST_TIMEOUT_MS = 150_000;

export type AnalystFailureCode = 'unavailable' | 'budget' | 'rate';

export type AnalyzeOutcome =
  | { ok: true; data: AnalyzeResult }
  | { ok: false; status: 429 | 502 | 503 | 504; code: AnalystFailureCode; error: string };

export async function analystConfigured(): Promise<boolean> {
  const [url, key, secret] = await Promise.all([
    getServerVar('ANALYST_URL'),
    getServerVar('MODAL_KEY'),
    getServerVar('MODAL_SECRET'),
  ]);
  return Boolean(url && key && secret);
}

const notConfigured: AnalyzeOutcome = {
  ok: false,
  status: 503,
  code: 'unavailable',
  error: 'Lead Analyst is not configured on the server',
};

/**
 * Lead cards for raw post texts, one result per text in the same order.
 * Never throws: every failure is an `ok: false` outcome the route can map
 * straight onto a status code.
 */
export async function analyzeTexts(texts: string[]): Promise<AnalyzeOutcome> {
  if (texts.length === 0) return { ok: true, data: { results: [], timesSec: [], elapsedSec: 0 } };
  const [url, key, secret] = await Promise.all([
    getServerVar('ANALYST_URL'),
    getServerVar('MODAL_KEY'),
    getServerVar('MODAL_SECRET'),
  ]);
  if (!url || !key || !secret) return notConfigured;

  let response: Response;
  try {
    response = await fetch(`${url.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Modal proxy auth: checked at Modal's edge, before any GPU is started
        'Modal-Key': key,
        'Modal-Secret': secret,
      },
      body: JSON.stringify({ texts: texts.slice(0, ANALYST_MAX_POSTS) }),
      signal: AbortSignal.timeout(ANALYST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 504, code: 'unavailable', error: 'Could not reach the Lead Analyst' };
  }

  if (!response.ok) {
    if (response.status === 429) {
      // the endpoint's own daily GPU budget — not this route's per-IP limit
      return {
        ok: false,
        status: 429,
        code: 'budget',
        error: 'The Lead Analyst has used its GPU budget for today',
      };
    }
    return {
      ok: false,
      status: response.status === 504 ? 504 : 502,
      code: 'unavailable',
      error: `Lead Analyst returned HTTP ${response.status}`,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, status: 502, code: 'unavailable', error: 'Lead Analyst returned non-JSON' };
  }

  const normalized = normalize(data, texts.length);
  if (!normalized) {
    return { ok: false, status: 502, code: 'unavailable', error: 'Lead Analyst returned an unexpected shape' };
  }
  return { ok: true, data: normalized };
}

/** Keeps only what the browser needs and checks the shape before it is trusted. */
function normalize(data: unknown, expected: number): AnalyzeResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const payload = data as { results?: unknown; timesSec?: unknown; elapsedSec?: unknown };
  if (!Array.isArray(payload.results) || payload.results.length !== expected) return null;
  const times = Array.isArray(payload.timesSec) ? payload.timesSec : [];

  const results: AnalyzeEntry[] = [];
  for (let i = 0; i < payload.results.length; i += 1) {
    const raw = payload.results[i];
    if (typeof raw !== 'object' || raw === null) return null;
    const entry = raw as { status?: unknown; attempt?: unknown; card?: unknown };
    if (entry.status === 'ok') {
      if (!isLeadCard(entry.card)) return null;
      results.push({ status: 'ok', attempt: typeof entry.attempt === 'number' ? entry.attempt : 1, card: entry.card });
    } else {
      results.push({ status: 'reject', attempt: typeof entry.attempt === 'number' ? entry.attempt : 1, card: null });
    }
  }
  return {
    results,
    timesSec: results.map((_, i) => (typeof times[i] === 'number' ? (times[i] as number) : null)),
    elapsedSec: typeof payload.elapsedSec === 'number' ? payload.elapsedSec : 0,
  };
}
