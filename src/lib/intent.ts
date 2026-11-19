import http from 'node:http';

import { unstable_cache } from 'next/cache';

import { getServerVar } from './server-env';
import { XApiClient, type XPost } from './x-api';

/**
 * Shared intent-sidecar plumbing.
 *
 * The local PyTorch sidecar (intent/serve.py) must be reached over a raw
 * socket: the dev shell exports http_proxy (Clash) and Next's fetch honors
 * it without respecting NO_PROXY, so loopback calls were tunneled to the
 * remote proxy node and closed ("other side closed"). node:http never
 * consults proxy env vars.
 */

export function sidecarPost(
  serviceUrl: string,
  body: unknown,
  timeoutMs: number
): Promise<{ status: number; data: unknown }> {
  // Tolerate scheme-less values like "127.0.0.1:5019" — new URL() throws on
  // them (a scheme cannot start with a digit) and the failure was silent.
  const normalized = /^https?:\/\//.test(serviceUrl) ? serviceUrl : `http://${serviceUrl}`;
  const url = new URL(normalized);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: '/score',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            reject(new Error(`sidecar returned non-JSON: ${raw.slice(0, 120)}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('sidecar timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

export interface ScoreResult {
  scores: number[];
  elapsedSec: number | null;
  /** per-text model latency in seconds — present when per_item=true */
  timesSec: number[] | null;
}

/** Score raw texts. Workers: native via Workers AI + bundled head weights.
 *  Local dev (Node): falls back to the FastAPI sidecar. Null on failure. */
export async function scoreTexts(
  texts: string[],
  opts: { timeoutMs?: number; perItem?: boolean } = {}
): Promise<ScoreResult | null> {
  const { timeoutMs = 15_000, perItem = true } = opts;
  // Workers AI throws transient AiError 3043s — retry once after a beat
  let native = await scoreNative(texts, perItem);
  if (!native) {
    await new Promise((r) => setTimeout(r, 800));
    native = await scoreNative(texts, perItem);
  }
  if (native) return native;
  const serviceUrl = (await getServerVar('INTENT_SERVICE_URL'))?.replace(/\/$/, '');
  if (!serviceUrl || texts.length === 0) return null;
  try {
    const { status, data } = await sidecarPost(serviceUrl, { texts, per_item: perItem }, timeoutMs);
    if (status < 200 || status >= 300) return null;
    const payload = data as { scores?: unknown; times_sec?: unknown; elapsed_sec?: unknown };
    const scores = payload.scores;
    const elapsed = payload.elapsed_sec;
    const times = payload.times_sec;
    if (!Array.isArray(scores) || scores.length !== texts.length) return null;
    return {
      scores: scores.map((v) => (typeof v === 'number' ? v : 0)),
      elapsedSec: typeof elapsed === 'number' ? elapsed : null,
      timesSec: Array.isArray(times)
        ? times.map((v) => (typeof v === 'number' ? v : 0))
        : null,
    };
  } catch {
    return null;
  }
}

/** Attach intent scores (Workers AI native first, sidecar fallback).
 *  Any failure degrades silently. */
export async function attachIntentScores(posts: XPost[]): Promise<XPost[]> {
  if (posts.length === 0) return posts;
  const result = await scoreTexts(posts.map((p) => p.text));
  if (!result) return posts;
  return posts.map((post, index) => ({
    ...post,
    intentScore: result.scores[index],
  }));
}

export interface ScoredLead {
  handle: string;
  text: string;
  score: number;
  /** the search expression this lead was actually retrieved with */
  sourceQuery?: string;
}

/**
 * One live X search + intent scoring pass. Throws on failure — the caller
 * (the unstable_cache wrapper below) must never see a silent [] because
 * unstable_cache caches empty results too, which would pin the landing page
 * to samples for a whole revalidate window (verified 2026-11-16).
 */
async function fetchScoredLeads(queries: string[]): Promise<ScoredLead[]> {
  const apiKey = await getServerVar('SCRAPER_API_KEY');
  if (!apiKey) throw new Error('SCRAPER_API_KEY is not configured');
  const client = new XApiClient({ apiKey });
  // One real search PER keyword so every lead carries its own provenance —
  // a single OR-query would make all tooltips show the same expression.
  const eligible: {
    handle: string;
    text: string;
    score: number;
    sourceQuery: string;
  }[] = [];
  for (const keyword of queries) {
    try {
      const page = await client.search(keyword, { searchType: 'Latest' });
      const scored = await attachIntentScores(page.posts.slice(0, 14));
      for (const p of scored) {
        if (typeof p.intentScore !== 'number' || p.text.length < 12) continue;
        eligible.push({
          handle: `@${p.author.handle || 'user'}`,
          text: p.text.replace(/\s+/g, ' ').slice(0, 90),
          score: Math.round((p.intentScore as number) * 100),
          sourceQuery: keyword,
        });
      }
    } catch (err) {
      console.warn(`[pipeline] keyword search failed ("${keyword}"):`, err instanceof Error ? err.message : err);
    }
  }
  // Balanced across score tiers so every bin in the landing animation has
  // members — a first-come selection starves the strong-intent bin for long
  // stretches because real posts mostly score mid/low (verified 2026-11-16).
  const byTier = (lo: number, hi: number, n: number) =>
    eligible.filter((l) => l.score >= lo && l.score < hi).slice(0, n);
  return [...byTier(80, 101, 8), ...byTier(60, 80, 6), ...byTier(0, 60, 4)];
}

/** Landing-page leads, memoized per Worker isolate for 10 min — the Next
 *  data cache is read-only on Workers (static assets), so we cache in
 *  module memory instead: one search pass per isolate per 10 min. */
const PIPELINE_TTL_MS = 10 * 60 * 1000;
let pipelineLeadsCache: { at: number; data: ScoredLead[] } | null = null;

/** Sample leads used when live data is unavailable. Never empty overall. */
/* ---------------- Workers-native scoring ---------------- */

import headWeights from '@/lib/intent-head-weights.json';

let lastNativeErr: string | null = null;
export function lastNativeError(): string | null {
  return lastNativeErr;
}

/**
 * Score texts inside the Worker: Workers AI computes bge-base-en-v1.5
 * embeddings (768-d, the head's input space), then the bundled MLP head
 * runs the same math as training (L2-norm → ReLU(emb·W1+b1) → sigmoid).
 * Per-post latency is measured on every call. Returns null when the AI
 * binding is absent (local `next dev`), so the sidecar takes over.
 */
async function scoreNative(
  texts: string[],
  perItem: boolean
): Promise<ScoreResult | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const ai = (env as { AI?: { run: (model: string, input: unknown) => Promise<unknown> } }).AI;
    if (!ai) return null;
    const W = headWeights as {
      w1: number[][];
      b1: number[];
      w2: number[][];
      b2: number[];
    };
    const t0 = Date.now();
    const scores: number[] = [];
    const timesSec: number[] = [];
    for (const text of texts) {
      const t1 = Date.now();
      const res = (await ai.run('@cf/baai/bge-base-en-v1.5', {
        text: text.slice(0, 1500),
      })) as { data?: number[][]; embeddings?: number[] };
      const raw = res?.data?.[0] ?? res?.embeddings;
      if (!Array.isArray(raw)) {
        lastNativeErr = 'AI response missing embedding: ' + JSON.stringify(res).slice(0, 180);
        console.error('[intent]', lastNativeErr);
        return null;
      }
      let norm = 0;
      for (const v of raw) norm += v * v;
      norm = Math.sqrt(norm) || 1;
      const emb = raw.map((v) => v / norm);
      if (emb.length !== W.w1[0]?.length) {
        lastNativeErr = `dim mismatch: ${emb.length} vs ${W.w1[0]?.length}`;
        console.error('[intent]', lastNativeErr);
        return null;
      }
      const hidden = W.b1.map((b, j) => {
        let acc = b;
        const row = W.w1[j];
        for (let i = 0; i < emb.length; i++) acc += emb[i] * row[i];
        return Math.max(0, acc);
      });
      let logit = W.b2[0] ?? 0;
      for (let j = 0; j < hidden.length; j++) logit += hidden[j] * W.w2[0][j];
      scores.push(1 / (1 + Math.exp(-logit)));
      timesSec.push((Date.now() - t1) / 1000);
    }
    void perItem;
    return { scores, elapsedSec: (Date.now() - t0) / 1000, timesSec };
  } catch (err) {
    lastNativeErr = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error('[intent] native scoring failed:', lastNativeErr);
    return null; // native path unavailable/broken — sidecar fallback
  }
}

export const SAMPLE_LEADS: ScoredLead[] = [
  { sourceQuery: 'alternative to', handle: '@buildwithsara', text: 'looking for a cheaper alternative to Ahrefs…', score: 91 },
  { sourceQuery: 'I wish there was', handle: '@opsbyjake', text: 'wish an app auto-reconciled Stripe payouts', score: 87 },
  { sourceQuery: 'worth paying for', handle: '@saasdad', text: 'our ticketing stack is a mess, willing to pay', score: 89 },
  { sourceQuery: 'is there a tool that', handle: '@indiemarla', text: 'any tool that turns X Spaces into blog posts?', score: 84 },
  { sourceQuery: 'is there an app that', handle: '@nocodegen', text: 'is there an app that turns Figma into React?', score: 82 },
  { sourceQuery: 'switching from', handle: '@growthlena', text: 'hate how our CRM dedupes. any alternative?', score: 78 },
  { sourceQuery: 'looking for a tool', handle: '@deckhacker', text: 'need a tool to track competitor pricing weekly', score: 63 },
  { sourceQuery: 'anyone know an app', handle: '@revenuekit', text: 'anyone know an app for invoice milestones?', score: 58 },
  { sourceQuery: 'anyone recommend', handle: '@moarmetrics', text: 'my analytics stack needs cleanup, any recs?', score: 55 },
  { sourceQuery: 'is there a tool that', handle: '@shipfast_ed', text: 'is there a bot that replies to reviews for me?', score: 51 },
  { sourceQuery: 'anyone know an app', handle: '@lonelaunch', text: 'who else refreshing Product Hunt all day', score: 21 },
  { sourceQuery: 'switching from', handle: '@notionfanatic', text: 'spending sunday reorganizing my workspace lol', score: 12 },
];

/**
 * Real scored leads for the landing pipeline. Falls back to samples when
 * the scraper key, the X API or the intent sidecar are unavailable, so the
 * marketing page never breaks.
 */
const PIPELINE_KEYWORDS = [
  'is there an app that',
  'anyone recommend',
  'alternative to',
];

export async function getPipelineLeads(): Promise<{ leads: ScoredLead[]; live: boolean }> {
  if (pipelineLeadsCache && Date.now() - pipelineLeadsCache.at < PIPELINE_TTL_MS) {
    return { leads: pipelineLeadsCache.data, live: true };
  }
  try {
    const leads = await fetchScoredLeads(PIPELINE_KEYWORDS);
    if (leads.length < 6) {
      throw new Error(`only ${leads.length} scored leads — not caching a thin result`);
    }
    pipelineLeadsCache = { at: Date.now(), data: leads };
    return { leads, live: true };
  } catch (error) {
    // Observability for the silent degradation — the page discloses samples
    // via labels.sampleNote; the log says WHY.
    console.warn(
      '[pipeline] falling back to sample leads:',
      error instanceof Error ? error.message : error
    );
  }
  return { leads: SAMPLE_LEADS, live: false };
}
