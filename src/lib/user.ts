import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { getDb } from './db';
import { ANON_COOKIE } from './anon-cookie';

export { ANON_COOKIE, ANON_COOKIE_MAX_AGE } from './anon-cookie';

/**
 * Anonymous user plumbing + identity resolution.
 *
 * The middleware hands every browser a `xlm_uid` cookie (no login required to
 * browse); these helpers lazily mirror that id into a x_lead_miner_user row —
 * identity, usage counters and subscription status in that one table — and
 * record search runs behind it. Logging in attaches the anonymous row from the
 * same browser to the account by email, so usage counters and history survive
 * the login untouched. Server-side only.
 */

/** Free anonymous quota in scored posts. Enforced server-side in
 *  /api/leads/search; signing in lifts it (billing comes later). */
export const FREE_POST_LIMIT = 100;

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

/** Get-or-create the user row for an anon id. */
export async function ensureUser(anonId: string) {
  const db = await getDb();
  const existing = await db.user.findUnique({ where: { anonId } });
  if (existing) return existing;
  return db.user.create({ data: { anonId } });
}

export interface Identity {
  /** The resolved user row — anonymous (cookie) or the account (email). */
  user: Awaited<ReturnType<typeof ensureUser>>;
  loggedIn: boolean;
  anonId: string;
}

/**
 * Resolve the acting identity for a REQUEST (route handlers): the session's
 * email wins; a first-time login adopts the anonymous row from the same
 * browser (counters + history move with it). Creates rows as needed.
 */
export async function resolveUserIdentityForRequest(request: Request): Promise<Identity> {
  const session = await auth();
  const email = session?.user?.email ?? undefined;
  const anonId = anonIdFrom(request);
  return resolveIdentity(email, anonId);
}

/**
 * Read-only variant for server components: resolves by session email or the
 * anon cookie WITHOUT creating rows — a visitor merely viewing the site must
 * not grow the user table.
 */
export async function readUserIdentity(): Promise<Identity | null> {
  const session = await auth();
  const email = session?.user?.email ?? undefined;
  const anonId = (await cookies()).get(ANON_COOKIE)?.value;
  if (!email && !anonId) return null;

  const db = await getDb();
  const user = email
    ? await db.user.findUnique({ where: { email } })
    : anonId
      ? await db.user.findUnique({ where: { anonId } })
      : null;
  if (!user) return null;
  return { user, loggedIn: Boolean(email), anonId: anonId ?? user.anonId ?? '' };
}

async function resolveIdentity(email: string | undefined, anonId: string): Promise<Identity> {
  const db = await getDb();
  if (email) {
    let row = await db.user.findUnique({ where: { email } });
    if (!row) {
      // First login with this email: adopt the anonymous row from this
      // browser, so the free quota they already used and their history move
      // with them (the login modal promises exactly this).
      const anonRow = await db.user.findUnique({ where: { anonId } });
      row = anonRow
        ? await db.user.update({ where: { id: anonRow.id }, data: { email } })
        : await db.user.create({ data: { email } });
    }
    return { user: row, loggedIn: true, anonId };
  }
  const row = await ensureUser(anonId);
  return { user: row, loggedIn: false, anonId };
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

/** Persist one executed search behind the resolved user, bump usage counters
 *  and prune history beyond the per-user cap. Recording failures must never
 *  break the search response — callers wrap this in try/catch. */
export async function recordSearch(
  user: { id: string },
  query: string,
  searchType: string,
  posts: RecordedPost[]
) {
  const db = await getDb();
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
    await db.searchRun.deleteMany({ where: { id: { in: stale.map((staleRun) => staleRun.id) } } });
  }
  return run;
}

/** Merge async model scores back into a stored run's results JSON. The score
 *  route calls this after the browser reports them; posts the score run never
 *  saw are ignored. Returns false when the run does not belong to the user. */
export async function mergeRunScores(
  userId: string,
  runId: string,
  scores: { id: string; score: number; sec: number | null }[]
): Promise<boolean> {
  const db = await getDb();
  const run = await db.searchRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== userId) return false;

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
