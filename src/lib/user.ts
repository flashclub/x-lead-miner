import { getDb } from './db';
import { ANON_COOKIE } from './anon-cookie';

export { ANON_COOKIE, ANON_COOKIE_MAX_AGE } from './anon-cookie';

/**
 * Anonymous user plumbing.
 *
 * The middleware hands every browser a `xlm_uid` cookie (no login system by
 * design); these helpers lazily mirror that id into a x_lead_miner_user row —
 * identity, usage counters and subscription status in that one table — and
 * record search runs behind it. Server-side only.
 */

/** Read the anon id from a request's Cookie header, generating a fresh one
 *  when absent (the caller is responsible for setting it on its response).
 *  Uses the Web Crypto global — available in Node 22, edge and Workers. */
export function anonIdFrom(request: Request): string {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${ANON_COOKIE}=`));
  const value = cookie?.slice(ANON_COOKIE.length + 1);
  return value ? decodeURIComponent(value) : crypto.randomUUID();
}

/** Get-or-create the user row for an anon id. Never throws on a missing row —
 *  creation is the point. */
export async function ensureUser(anonId: string) {
  const db = await getDb();
  const existing = await db.user.findUnique({ where: { anonId } });
  if (existing) return existing;
  return db.user.create({ data: { anonId } });
}

/** Compact post snapshot persisted inside a search run's results JSON. */
export interface RecordedPost {
  id: string;
  handle: string;
  name: string | undefined;
  text: string;
  score: number | null;
  sec: number | null;
  url: string;
  createdAtIso: string | undefined;
}

const MAX_RUNS_PER_USER = 200;

/** Persist one executed search behind the anon id, bump usage counters and
 *  prune history beyond the per-user cap. Recording failures must never break
 *  the search response — callers wrap this in try/catch. */
export async function recordSearch(
  anonId: string,
  query: string,
  searchType: string,
  posts: RecordedPost[]
) {
  const db = await getDb();
  const user = await ensureUser(anonId);
  const run = await db.searchRun.create({
    data: {
      userId: user.id,
      query,
      searchType,
      postCount: posts.length,
      results: JSON.stringify(posts),
    },
  });
  await db.user.update({
    where: { id: user.id },
    data: {
      searchCount: { increment: 1 },
      scoredCount: { increment: posts.length },
      lastSearchAt: new Date(),
    },
  });

  // Keep only the newest MAX_RUNS_PER_USER runs per user (D1 hygiene).
  const stale = await db.searchRun.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    skip: MAX_RUNS_PER_USER,
    select: { id: true },
  });
  if (stale.length > 0) {
    await db.searchRun.deleteMany({ where: { id: { in: stale.map((run) => run.id) } } });
  }
  return run;
}

/** Merge async model scores back into a stored run's results JSON. The score
 *  route calls this after the browser reports them; posts the score run never
 *  saw are ignored. Returns false when the run does not belong to anonId. */
export async function mergeRunScores(
  anonId: string,
  runId: string,
  scores: { id: string; score: number; sec: number | null }[]
): Promise<boolean> {
  const db = await getDb();
  const user = await db.user.findUnique({ where: { anonId } });
  if (!user) return false;
  const run = await db.searchRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== user.id) return false;

  const byId = new Map(scores.map((entry) => [entry.id, entry]));
  let posts: RecordedPost[] = [];
  try {
    posts = JSON.parse(run.results) as RecordedPost[];
  } catch {
    return false;
  }
  const merged = posts.map((post) => {
    const hit = byId.get(post.id);
    return hit ? { ...post, score: hit.score, sec: hit.sec } : post;
  });
  await db.searchRun.update({
    where: { id: run.id },
    data: { results: JSON.stringify(merged) },
  });
  return true;
}
