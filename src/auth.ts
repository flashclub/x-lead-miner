import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';

/**
 * Auth.js (next-auth v5), JWT sessions.
 *
 * Providers are registered ONLY when their credentials exist in the
 * environment (GITHUB_CLIENT_ID / GOOGLE_CLIENT_ID …), so the app boots and
 * degrades gracefully before the OAuth apps are configured — the login page
 * says so instead of erroring. The dev-bypass provider exists only when
 * DEV_BYPASS_AUTH=true OUTSIDE production (hard-disabled in prod so it can
 * never leak).
 *
 * Sessions are JWT on purpose: the user table is our own (src/lib/user.ts
 * links a session to its row by email, attaching the anonymous row from the
 * same browser so usage counters and history survive the login).
 */

function envVar(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

const githubId = envVar('GITHUB_CLIENT_ID', 'GITHUB_ID');
const githubSecret = envVar('GITHUB_CLIENT_SECRET', 'GITHUB_SECRET');
const googleId = envVar('GOOGLE_CLIENT_ID', 'GOOGLE_ID');
const googleSecret = envVar('GOOGLE_CLIENT_SECRET', 'GOOGLE_SECRET');
const devBypass = envVar('DEV_BYPASS_AUTH') === 'true' && process.env.NODE_ENV !== 'production';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...(githubId && githubSecret
      ? [GitHub({ clientId: githubId, clientSecret: githubSecret })]
      : []),
    ...(googleId && googleSecret
      ? [Google({ clientId: googleId, clientSecret: googleSecret })]
      : []),
    ...(devBypass
      ? [
          Credentials({
            id: 'dev',
            name: 'Dev bypass',
            credentials: {},
            authorize: async () => ({ id: 'dev', name: 'Dev', email: 'dev@localhost' }),
          }),
        ]
      : []),
  ],
  session: { strategy: 'jwt' },
  trustHost: true,
});

/** Providers the login UI may offer right now ('github' | 'google' | 'dev'). */
export const enabledProviders = [
  ...(githubId && githubSecret ? ['github'] : []),
  ...(googleId && googleSecret ? ['google'] : []),
  ...(devBypass ? ['dev'] : []),
];

export { devBypass };
