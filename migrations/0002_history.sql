-- 0002 — user identity + search history.
--
-- Reshapes the user table (it never held rows: auth never shipped before this
-- migration, verified empty on 2026-11-26) into the single-table user design:
-- identity (anon cookie id now, email/stripe columns reserved), usage counters
-- and subscription status live together. Adds one table for search runs —
-- each row is one executed search, results stored as a JSON array so the
-- product stays at exactly two tables.
--
-- Column names are camelCase, matching the Prisma model fields exactly
-- (prisma/schema.prisma has no @map annotations — same convention as 0001).
-- Idempotent by design: safe to re-run against the sqlite dev file, the
-- wrangler-local D1 and the remote D1.

DROP TABLE IF EXISTS x_lead_miner_search;
DROP TABLE IF EXISTS x_lead_miner_user;

CREATE TABLE "x_lead_miner_user" (
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
);

CREATE UNIQUE INDEX "x_lead_miner_user_anonId_key" ON "x_lead_miner_user"("anonId");
CREATE UNIQUE INDEX "x_lead_miner_user_email_key" ON "x_lead_miner_user"("email");
CREATE UNIQUE INDEX "x_lead_miner_user_stripeCustomerId_key" ON "x_lead_miner_user"("stripeCustomerId");

CREATE TABLE "x_lead_miner_search" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'Latest',
    "postCount" INTEGER NOT NULL DEFAULT 0,
    "results" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "x_lead_miner_search_userId_createdAt_idx" ON "x_lead_miner_search"("userId", "createdAt");
CREATE INDEX "x_lead_miner_search_userId_query_idx" ON "x_lead_miner_search"("userId", "query");
