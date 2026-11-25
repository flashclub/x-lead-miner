-- Application user table ("x_lead_miner_user", see prisma/schema.prisma @@map).
-- One baseline table; business tables are project-prefixed and added as needed.
CREATE TABLE "x_lead_miner_user" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" DATETIME,
    -- Stripe billing columns (flattened from the former StripeCustomer table).
    -- NULL until the user completes their first checkout; filled by the webhook.
    "stripeCustomerId" TEXT,
    "subscriptionPlan" TEXT,
    "subscriptionStatus" TEXT,
    "currentPeriodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex (unique)
CREATE UNIQUE INDEX "x_lead_miner_user_email_key" ON "x_lead_miner_user"("email");

-- CreateIndex (unique) — powers the webhook's idempotent upsert-by-customer.
CREATE UNIQUE INDEX "x_lead_miner_user_stripeCustomerId_key" ON "x_lead_miner_user"("stripeCustomerId");
