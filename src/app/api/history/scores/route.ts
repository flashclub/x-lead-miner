import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ANON_COOKIE,
  ANON_COOKIE_MAX_AGE,
  mergeRunScores,
  resolveUserIdentityForRequest,
} from '@/lib/user';

const scoresSchema = z.object({
  runId: z.string().min(1),
  scores: z
    .array(
      z.object({
        id: z.string().min(1),
        score: z.number().min(0).max(1),
        sec: z.number().min(0).nullable().optional(),
      })
    )
    .min(1)
    .max(100),
});

/**
 * POST /api/history/scores  { runId, scores: [{ id, score, sec? }] }
 *
 * The search route records a run BEFORE async scoring happens (results must
 * render instantly), so the stored posts start unscored. The browser reports
 * the model scores here once they land; this merges them into the stored run
 * by post id. Ownership is checked against the resolved identity — a run is
 * only ever updated for the visitor/account it belongs to.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = scoresSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? 'Invalid request' }, { status: 400 });
  }

  const identity = await resolveUserIdentityForRequest(request);
  const ok = await mergeRunScores(
    identity.user.id,
    parsed.data.runId,
    parsed.data.scores.map((entry) => ({
      id: entry.id,
      score: entry.score,
      sec: entry.sec ?? null,
    }))
  );
  if (!ok) {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ANON_COOKIE, identity.anonId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ANON_COOKIE_MAX_AGE,
  });
  return response;
}
