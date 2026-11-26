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

export async function getD1(): Promise<D1Client> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.DB) {
    throw new Error('D1 binding (DB) is not available in this runtime');
  }
  return env.DB as unknown as D1Client;
}
