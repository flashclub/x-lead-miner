import NextAuth from 'next-auth';
import type { Session } from 'next-auth';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import { authConfig } from './auth.config';
import { devSession, isDevAuthBypass } from './dev-auth';
import { getDb } from './db';

/**
 * Full Auth.js config (server-only). Imports providers + extends authConfig.
 *
 * JWT strategy: session data is encrypted in a cookie, not stored in DB.
 * No Auth.js Adapter is configured — user persistence is handled explicitly
 * in the `signIn` callback below (one row per email in the per-project
 * `<slug>_user` table, created on first sign-in).
 *
 * The `plan` field is stashed into the JWT at sign-in (default "free") and
 * attached to the session object. After a successful checkout the webhook
 * updates the user row; the next request refreshes the JWT to reflect it.
 */
const nextAuth = NextAuth({
  ...authConfig,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    // Persist the user row on every sign-in. JWT session lives in the cookie,
    // but the row must exist in the DB so the Stripe webhook can later look it
    // up by email and attach billing columns. Idempotent: subsequent logins
    // just refresh name/image. Failures are logged but do not block sign-in
    // (the user can still get a session; the webhook will warn instead).
    async signIn({ user }) {
      const email = user?.email;
      if (!email) return true;
      try {
        const db = await getDb();
        await db.user.upsert({
          where: { email },
          create: { email, name: user.name ?? null, image: user.image ?? null },
          update: {
            name: user.name ?? undefined,
            image: user.image ?? undefined,
          },
        });
      } catch (err) {
        console.error('signIn: failed to upsert user row', err);
      }
      return true;
    },
    async jwt({ token, account, user }) {
      // Initial sign-in: stash user info
      if (account && user) {
        token.id = user.id;
        token.plan = 'free'; // default; upgraded after first successful checkout
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string | undefined;
        (session.user as { plan?: string }).plan = token.plan as string | undefined;
      }
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

/** auth() with the dev bypass short-circuit (see lib/dev-auth.ts): serves
 *  a fake pro-plan session so protected pages work without OAuth setup. */
export async function auth(): Promise<Session | null> {
  if (isDevAuthBypass()) return devSession();
  return nextAuth.auth();
}
