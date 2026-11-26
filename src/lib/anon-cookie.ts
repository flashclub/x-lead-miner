/**
 * Cookie name + lifetime for the anonymous visitor id (see src/lib/user.ts).
 * Deliberately dependency-free: the edge middleware imports this module, so
 * nothing here may pull Node-only or Prisma code into the edge bundle.
 */
export const ANON_COOKIE = 'xlm_uid';
export const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // one year
