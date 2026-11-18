import { NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import createMiddleware from 'next-intl/middleware';
import { authConfig } from './lib/auth.config';
import { isDevAuthBypass } from './lib/dev-auth';
import { routing } from './i18n/routing';

// Construct the middleware ONLY from the edge-safe config.
// Do NOT import from ./lib/auth.ts here — it pulls Prisma into the bundle.
const auth = NextAuth(authConfig).auth;
const handleI18nRouting = createMiddleware(routing);

const LOCALE_PREFIX = /^\/(en|zh)(\/|$)/;

/** Strip the locale prefix so protection checks see bare paths. */
function barePath(pathname: string): string {
  return pathname.replace(LOCALE_PREFIX, '/') || '/';
}

export default auth((request) => {
  const path = barePath(request.nextUrl.pathname);
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/billing') ||
    path.startsWith('/chat') ||
    path.startsWith('/intent');

  if (isProtected && !request.auth && !isDevAuthBypass()) {
    // Redirect to the login page, keeping the active locale prefix if any.
    const prefix = request.nextUrl.pathname.match(LOCALE_PREFIX)?.[1];
    const loginPath = prefix ? `/${prefix}/login` : '/login';
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  return handleI18nRouting(request);
});

export const config = {
  // Run middleware on all page routes except API, static assets and files.
  // /api routes are locale-free and must not pass through next-intl.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public|.*\\..*).*)'],
};
