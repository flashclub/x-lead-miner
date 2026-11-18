/**
 * Cloudflare bindings declared in wrangler.jsonc.
 *
 * Keep this interface in sync when the app adds or removes bindings.
 */
interface CloudflareEnv {
  ASSETS: unknown;
  DB: D1Database;
  [key: string]: string | D1Database | unknown;
}
