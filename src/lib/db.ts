import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Raw D1 access.
 *
 * Prisma does NOT run on Workers: its Rust query engine cannot load in
 * workerd, and the first route that touched it in production 500'd the whole
 * page (2026-11-26). The runtime data layer is therefore plain SQL through
 * the D1 binding (see src/lib/user.ts); prisma/schema.prisma stays in the
 * repo as the documented shape of the data (pnpm db:diff generates SQL from
 * it) but nothing at runtime imports @prisma/client.
 *
 * The schema is ensured on first use: local dev D1 instances can be volatile
 * (opennext's dev miniflare keeps data in memory when run through plain
 * `next dev`), and CREATE TABLE IF NOT EXISTS is cheap and idempotent, so a
 * fresh instance heals itself instead of 500-ing with "no such table".
 */

/** Minimal structural typing of the D1 binding — avoid depending on
 *  @cloudflare/workers-types being resolvable from this project. */
interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results?: T[] }>;
  run(): Promise<unknown>;
}

export type D1Client = {
  prepare(sql: string): D1PreparedStatementLike;
};

/** Mirror of migrations/0002_history.sql, IF NOT EXISTS form (no DROP). */
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "x_lead_miner_user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "anonId" TEXT,
    "email" TEXT,
    "name" TEXT,
    "image" TEXT,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "scoredCount" INTEGER NOT NULL DEFAULT 0,
    "lastSearchAt" DATETIME,
    "subscriptionPlan" TEXT NOT NULL DEFAULT 'free',
    "subscriptionStatus" TEXT,
    "currentPeriodEnd" DATETIME,
    "stripeCustomerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "x_lead_miner_user_anonId_key" ON "x_lead_miner_user"("anonId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "x_lead_miner_user_email_key" ON "x_lead_miner_user"("email")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "x_lead_miner_user_stripeCustomerId_key" ON "x_lead_miner_user"("stripeCustomerId")`,
  `CREATE TABLE IF NOT EXISTS "x_lead_miner_search" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'Latest',
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "results" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "x_lead_miner_search_userId_createdAt_idx" ON "x_lead_miner_search"("userId", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "x_lead_miner_search_userId_query_idx" ON "x_lead_miner_search"("userId", "query")`,
];

let schemaReady: Promise<void> | null = null;

async function ensureSchema(db: D1Client): Promise<void> {
  for (const statement of SCHEMA_STATEMENTS) {
    await db.prepare(statement).run();
  }
}

export async function getD1(): Promise<D1Client> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) {
    throw new Error('D1 binding (DB) is not available in this runtime');
  }
  const db = env.DB as unknown as D1Client;
  schemaReady ??= ensureSchema(db).catch((error) => {
    schemaReady = null; // allow a retry on the next request
    throw error;
  });
  await schemaReady;
  return db;
}
