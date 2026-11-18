import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe Auth.js config.
 *
 * This module is imported by middleware.ts, which runs on the edge runtime.
 * It MUST NOT import Prisma, @prisma/client, or any Node-only code —
 * doing so pulls the Prisma WASM engine into the edge bundle and breaks.
 *
 * Route protection lives in middleware.ts (locale-aware, next-intl aware);
 * this config only carries session strategy and page overrides.
 */
export const authConfig: NextAuthConfig = {
  pages: {
    signIn: '/login',
  },
  // Empty providers here: the full provider list lives in auth.ts (server-only).
  providers: [],
  session: { strategy: 'jwt' },
  // trustHost is REQUIRED behind Cloudflare's reverse proxy.
  trustHost: true,
};
