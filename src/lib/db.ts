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
 * In `next dev` (Node), getCloudflareContext is shimmed by opennext preview.
 */
export const getDb = cache(async () => {
  const { env } = await getCloudflareContext({ async: true });
  const adapter = new PrismaD1(env.DB);
  return new PrismaClient({ adapter });
});
