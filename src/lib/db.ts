import { cache } from 'react';
import { PrismaClient } from '@prisma/client';
import { PrismaD1 } from '@prisma/adapter-d1';
import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Per-request PrismaClient.
 *
 * On Cloudflare Workers, a module-level global PrismaClient is unsafe
 * (stateless isolates; long-lived clients cause "memory access out of bounds").
 * React's cache() gives us one client per request, recreated across requests.
 *
 * In plain `next dev` (Node) there is no Workers binding at all — fall back to
 * the sqlite file the Prisma CLI maintains (DATABASE_URL, prisma/dev.db, see
 * migrations/0002_history.sql). Same SQL, so both runtimes stay in sync.
 */
export const getDb = cache(async (): Promise<PrismaClient> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (env.DB) {
      return new PrismaClient({ adapter: new PrismaD1(env.DB) });
    }
  } catch {
    // No Workers context — plain `next dev`, use the local sqlite file below.
  }
  return new PrismaClient();
});
