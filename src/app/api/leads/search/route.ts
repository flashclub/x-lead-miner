import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerVar } from '@/lib/server-env';
import { XApiClient, XApiError, type XApiErrorKind } from '@/lib/x-api';

const searchParamsSchema = z.object({
  query: z.string().min(1, 'query is required').max(500, 'query too long (max 500 chars)'),
  searchType: z.enum(['Top', 'Latest']).default('Latest'),
  cursor: z.string().max(2000).optional(),
});

/**
 * GET /api/leads/search?query=...&searchType=Latest|Top&cursor=...
 * Server-side proxy so AIAPIKEY_KEY never reaches the browser.
 * Returns the normalized SearchPage from lib/x-api.ts.
 */
// Public demo: simple in-memory per-IP limiter protects the paid X data
// quota (20 searches / hour / IP — enough for portfolio evaluation).
const RATE_LIMIT = 20;
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

export async function GET(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: 'Rate limited — this public demo allows 20 searches per hour. Run your own instance: github.com/flashclub/x-lead-miner' },
      { status: 429 }
    );
  }

  const url = new URL(request.url);
  const parsed = searchParamsSchema.safeParse({
    query: url.searchParams.get('query') ?? undefined,
    searchType: url.searchParams.get('searchType') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? 'Invalid request' }, { status: 400 });
  }

  const apiKey = await getServerVar('AIAPIKEY_KEY');
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AIAPIKEY_KEY is not configured on the server' },
      { status: 500 }
    );
  }

  const client = new XApiClient({ apiKey });
  try {
    const page = await client.search(parsed.data.query, {
      searchType: parsed.data.searchType,
      cursor: parsed.data.cursor,
    });
    // Intent scoring is async — results render immediately, then the client
    // scores each batch via /api/leads/score (see lead-search.tsx).
    return NextResponse.json({ posts: page.posts, nextCursor: page.nextCursor, prevCursor: page.prevCursor });
  } catch (error) {
    if (error instanceof XApiError) {
      const messages: Record<XApiErrorKind, string> = {
        rate_limited: 'X data provider rate limit hit — wait a minute and try again',
        network: 'Could not reach the X data provider',
        upstream: 'X data provider returned an error',
        schema: 'X data provider response changed — x-api.ts needs a re-verify (pnpm x:smoke)',
      };
      const status = error.kind === 'rate_limited' ? 429 : error.kind === 'network' ? 504 : 502;
      return NextResponse.json({ error: messages[error.kind], kind: error.kind }, { status });
    }
    throw error;
  }
}
