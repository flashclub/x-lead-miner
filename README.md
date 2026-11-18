# X Lead Miner

A SaaS application generated from the MonoBoard `nextjs` template.

## Stack

- **Framework:** Next.js (App Router)
- **Auth:** Auth.js v5 (JWT strategy, GitHub + Google OAuth)
- **Billing:** Stripe (Free + Pro subscription, webhook-created customer)
- **Database:** Cloudflare D1 + Prisma (`@prisma/adapter-d1`)
- **Deployment:** Cloudflare Workers (`@opennextjs/cloudflare`)

## Design

The visual layer is a token-driven design system with a theme preset
(`aurora`, `terminal`, `tide`, `ember`, or `minimal` — recorded in
`package.json` → `monoboard.theme`). See [DESIGN.md](./DESIGN.md) for the
token table, theme switching, animation budget and component provenance
before changing any styling.

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
cp .dev.vars.example .dev.vars
```

Fill in:

- `AUTH_SECRET` — generate with `openssl rand -base64 32`
- GitHub OAuth credentials — https://github.com/settings/developers
- Google OAuth credentials — https://console.cloud.google.com/apis/credentials
- Stripe keys — https://dashboard.stripe.com/apikeys
- `NEXT_PUBLIC_STRIPE_PRO_PRICE_ID` — the `price_xxx` for your Pro plan

### 3. Set up the shared D1 database

All MonoBoard SaaS apps share **one** D1 database named `saas`. Each app starts
with a per-project user table (this app's table is `x_lead_miner_user`), so
isolation comes from project-prefixed table names rather than separate databases.

**First-time only** (once for the whole monorepo — skip if `saas` already exists):

```bash
wrangler d1 create saas
```

Paste the returned `database_id` into `wrangler.jsonc`. Every SaaS app generated
after this points at the same `database_id`; no new `d1 create` per project.

### 4. Apply migrations

```bash
pnpm db:migrate:local    # creates this app's table in the local saas DB
pnpm db:migrate:remote   # production DB (when ready)
```

### 5. Run in development

```bash
pnpm dev          # Node-based dev server (fast)
pnpm dev:edge     # Simulated Workers env (validate edge compatibility before deploy)
```

Open http://localhost:3000.

## Deploying

```bash
pnpm build
pnpm deploy
```

Set production secrets with:

```bash
wrangler secret put AUTH_SECRET
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

## Stripe webhook setup

In the Stripe dashboard, create a webhook endpoint pointing to:

```
https://<your-domain>/api/stripe/webhook
```

Subscribe to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

## Architecture notes

- **Shared D1, two-table budget:** all MonoBoard SaaS apps share one D1 database
  (`saas`) rather than creating a database per project. Each app starts with
  `x_lead_miner_user`. A project may use up to two total tables without
  additional approval; add the second only when the real MVP needs it and name
  every table with the `<slug>_` prefix. Obtain explicit user approval before
  creating a third or later table.
- **Cloudflare platform:** all Cloudflare capabilities are available when the
  product genuinely needs them. Select the smallest sufficient combination and
  use real project bindings; do not add R2, KV, Queues, Durable Objects,
  Workflows, Vectorize, Workers AI, or other services speculatively.
- **JWT sessions:** session data lives in an encrypted cookie, not the database.
  This avoids Prisma-in-middleware pitfalls on the edge runtime.
- **User row created on sign-in:** no Auth.js Adapter is used. The `signIn`
  callback in `auth.ts` upserts a user row by email on every login, so the row
  exists before any Stripe webhook tries to look it up.
- **Single-table billing:** the Stripe billing columns (`stripeCustomerId`,
  `subscriptionPlan`, `subscriptionStatus`, `currentPeriodEnd`) live directly
  on the user row — NULL until the first successful checkout, then filled by
  the webhook. The checkout session uses `customer_email` (not `customer`), so
  no Stripe Customer exists until payment succeeds.
- **Plan propagation:** after a successful checkout, the user's `plan` in the
  JWT updates on their next request. Expect a short delay (minutes).
- **Edge-safe middleware:** `middleware.ts` imports only `auth.config.ts`
  (no Prisma). The full config lives in `auth.ts` (server-only).

## Monoboard metadata

This app is tagged with `monoboard.category: "saas"` in `package.json` so the
MonoBoard dashboard recognizes it as a SaaS product.
