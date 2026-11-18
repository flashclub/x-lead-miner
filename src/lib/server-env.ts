import { getCloudflareContext } from '@opennextjs/cloudflare';

/**
 * Resolve a server-only env var across runtimes: on Workers secrets arrive
 * as bindings via getCloudflareContext (.dev.vars); plain `next dev` (Node)
 * only has process.env (.env).
 */
export async function getServerVar(name: string): Promise<string | undefined> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const fromBinding = (env as Record<string, string | undefined>)[name];
    if (fromBinding) return fromBinding;
  } catch {
    // No Cloudflare context (plain `next dev`) — fall through.
  }
  return process.env[name];
}
