import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { getD1 } from './db';
import { ANON_COOKIE } from './anon-cookie';

export { ANON_COOKIE, ANON_COOKIE_MAX_AGE } from './anon-cookie';

/**
 * Anonymous user plumbing + identity resolution, on raw D1 SQL.
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

export interface UserRow {
  id: string;
  anonId: string | null;
  email: string | null;
  name: string | null;
  image: string | null;
  searchCount: number;
  scoredCount: number;
  lastSearchAt: string | null;
  subscriptionPlan: string;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunRow {
  id: string;
  userId: string;
  query: string;
  searchType: string;
  postCount: number;
  results: string;
  /** sqlite datetime string (UTC), e.g. "2026-11-26 09:00:00" */
  createdAt: string;
}

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

const USER_COLS =
  '"id","anonId","email","name","image","searchCount","scoredCount","lastSearchAt","subscriptionPlan","subscriptionStatus","currentPeriodEnd","stripeCustomerId","createdAt","updatedAt"';

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

async function userBy(column: 'anonId' | 'email', value: string): Promise<UserRow | null> {
  const db = await getD1();
  const row = await db
    .prepare(`SELECT ${USER_COLS} FROM "x_lead_miner_user" WHERE "${column}" = ?`)
    .bind(value)
    .first<UserRow>();
  return row ?? null;
}

/** Get-or-create the user row for an anon id. Survives the create race: the
 *  anon_id unique index rejects the loser, which then reads the winner. */
export async function ensureUser(anonId: string): Promise<UserRow> {
  const db = await getD1();
  const existing = await userBy('anonId', anonId);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO "x_lead_miner_user" ("id","anonId","subscriptionPlan","createdAt","updatedAt")
       VALUES (?, ?, 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(id, anonId)
    .run();
  const created = await userBy('anonId', anonId);
  if (!created) throw new Error(`user row missing after insert (${anonId})`);
  return created;
}

export interface Identity {
  /** The resolved user row — anonymous (cookie) or the account (email). */
  user: UserRow;
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

  const row = email
    ? await userBy('email', email)
    : anonId
      ? await userBy('anonId', anonId)
      : null;
  if (!row) return null;
  return { user: row, loggedIn: Boolean(email), anonId: anonId ?? row.anonId ?? '' };
}

async function resolveIdentity(email: string | undefined, anonId: string): Promise<Identity> {
  const db = await getD1();
  if (email) {
    let row = await userBy('email', email);
    if (!row) {
      // First login with this email: adopt the anonymous row from this
      // browser, so the free quota they already used and their history move
      // with them (the login modal promises exactly this).
      const anonRow = await userBy('anonId', anonId);
      if (anonRow) {
        await db
          .prepare('UPDATE "x_lead_miner_user" SET "email" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?')
          .bind(email, anonRow.id)
          .run();
        row = await userBy('email', email);
      } else {
        const id = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO "x_lead_miner_user" ("id","email","subscriptionPlan","createdAt","updatedAt")
             VALUES (?, ?, 'free', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          )
          .bind(id, email)
          .run();
        row = await userBy('email', email);
      }
    }
    if (!row) throw new Error(`user row missing after attach (${email})`);
    return { user: row, loggedIn: true, anonId };
  }
  const row = await ensureUser(anonId);
  return { user: row, loggedIn: false, anonId };
}

/** Persist one executed search behind the resolved user, bump usage counters
 *  and prune history beyond the per-user cap. Recording failures must never
 *  break the search response — callers wrap this in try/catch. */
export async function recordSearch(
  user: { id: string },
  query: string,
  searchType: string,
  posts: RecordedPost[]
) {
  const db = await getD1();
  const runId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO "x_lead_miner_search" ("id","userId","query","searchType","postCount","results","createdAt")
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(runId, user.id, query, searchType, posts.length, JSON.stringify(posts))
    .run();
  await db
    .prepare(
      `UPDATE "x_lead_miner_user"
       SET "searchCount" = "searchCount" + 1,
           "scoredCount" = "scoredCount" + ?,
           "lastSearchAt" = CURRENT_TIMESTAMP,
           "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ?`
    )
    .bind(posts.length, user.id)
    .run();

  // Keep only the newest MAX_RUNS_PER_USER runs per user (D1 hygiene).
  await db
    .prepare(
      `DELETE FROM "x_lead_miner_search"
       WHERE "userId" = ? AND "id" NOT IN (
         SELECT "id" FROM "x_lead_miner_search" WHERE "userId" = ?
         ORDER BY "createdAt" DESC LIMIT ${MAX_RUNS_PER_USER}
       )`
    )
    .bind(user.id, user.id)
    .run();
  return { id: runId };
}

const MAX_RUNS_PER_USER = 200;

/** All runs of a user, newest first (history page). */
export async function listRuns(userId: string): Promise<RunRow[]> {
  const db = await getD1();
  const out = await db
    .prepare(
      `SELECT "id","userId","query","searchType","postCount","results","createdAt"
       FROM "x_lead_miner_search" WHERE "userId" = ? ORDER BY "createdAt" DESC`
    )
    .bind(userId)
    .all<RunRow>();
  return out.results ?? [];
}

/** Merge async model scores back into a stored run's results JSON. The score
 *  route calls this after the browser reports them; posts the score run never
 *  saw are ignored. Returns false when the run does not belong to the user. */
export async function mergeRunScores(
  userId: string,
  runId: string,
  scores: { id: string; score: number; sec: number | null }[]
): Promise<boolean> {
  const db = await getD1();
  const row = await db
    .prepare('SELECT "userId","results" FROM "x_lead_miner_search" WHERE "id" = ?')
    .bind(runId)
    .first<{ userId: string; results: string }>();
  if (!row || row.userId !== userId) return false;

  const byId = new Map(scores.map((entry) => [entry.id, entry]));
  let posts: RecordedPost[] = [];
  try {
    posts = JSON.parse(row.results) as RecordedPost[];
  } catch {
    return false;
  }
  const merged = posts.map((post) => {
    const hit = byId.get(post.id);
    return hit ? { ...post, score: hit.score, sec: hit.sec } : post;
  });
  await db
    .prepare('UPDATE "x_lead_miner_search" SET "results" = ? WHERE "id" = ?')
    .bind(JSON.stringify(merged), runId)
    .run();
  return true;
}
