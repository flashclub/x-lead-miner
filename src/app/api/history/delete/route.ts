import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ANON_COOKIE,
  ANON_COOKIE_MAX_AGE,
  deleteRunsByQuery,
  resolveUserIdentityForRequest,
} from '@/lib/user';

const deleteSchema = z.object({
  query: z.string().min(1).max(500),
});

/**
 * POST /api/history/delete  { query }
 *
 * Deletes every stored run of one search term for the resolved identity.
 * The lifetime usage counters (searchCount / scoredCount) are intentionally
 * NOT decremented — they stay as records even after the term is deleted.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? 'Invalid request' }, { status: 400 });
  }

  const identity = await resolveUserIdentityForRequest(request);
  const deleted = await deleteRunsByQuery(identity.user.id, parsed.data.query);

  const response = NextResponse.json({ ok: true, deleted });
  response.cookies.set(ANON_COOKIE, identity.anonId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ANON_COOKIE_MAX_AGE,
  });
  return response;
}
