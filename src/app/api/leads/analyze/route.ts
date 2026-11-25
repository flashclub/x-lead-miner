import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeTexts } from '@/lib/analyst';
import { ANALYST_MAX_POSTS } from '@/lib/lead-card-types';

const analyzeParamsSchema = z.object({
  texts: z.array(z.string().min(1).max(8_000)).min(1).max(ANALYST_MAX_POSTS),
});

/**
 * POST /api/leads/analyze  { texts: string[] }
 * -> { results: [{ status, attempt, card }], timesSec, elapsedSec }
 *
 * The SECOND model: a Lead Card per post from the Lead Analyst on Modal.
 * Independent of /api/leads/score — that route (used by the landing page and
 * the browser extension) is untouched, and nothing calls this one without an
 * explicit user action in the UI, because every request runs a GPU model.
 */
// Same in-memory per-IP limiter as the search route (per Worker isolate, so a
// speed bump for a public demo rather than a global counter). Each request can
// wake a GPU, so the limit is deliberately low.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json(
      {
        error: 'Rate limited — this public demo allows 30 lead-card requests per hour.',
        code: 'rate',
      },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = analyzeParamsSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? 'Invalid request' }, { status: 400 });
  }

  const outcome = await analyzeTexts(parsed.data.texts);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.error, code: outcome.code }, { status: outcome.status });
  }
  return NextResponse.json(outcome.data);
}
