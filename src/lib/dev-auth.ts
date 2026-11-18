import type { Session } from 'next-auth';

/**
 * Dev-only auth bypass — lets you open /dashboard and /billing without
 * configuring OAuth while developing. Opt in with DEV_BYPASS_AUTH=true in
 * .env (plain `next dev`) and/or .dev.vars (`pnpm dev:edge`). The NODE_ENV
 * guard makes it impossible to leak into a production build even if the
 * flag is accidentally set there.
 */
export function isDevAuthBypass(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_BYPASS_AUTH === 'true';
}

/** The fake session served while the bypass is on. Pro plan so every
 *  feature surface is reachable during development. */
export function devSession(): Session {
  return {
    user: {
      id: 'dev-user',
      name: 'Dev User',
      email: 'dev@x-lead-miner.local',
      image: null,
      plan: 'pro',
    },
    expires: '9999-12-31T23:59:59.999Z',
  } as unknown as Session;
}
