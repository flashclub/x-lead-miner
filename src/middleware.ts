import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';
import { ANON_COOKIE, ANON_COOKIE_MAX_AGE } from '@/lib/anon-cookie';

// i18n routing plus one concern: handing every browser an anonymous id cookie.
// The site has no login; the DB user row is keyed by this id (see
// src/lib/user.ts) and powers usage counters and the history page. API routes
// are excluded from the matcher — they read the cookie the page load set, and
// generate their own when called directly.
const handleI18nRouting = createMiddleware(routing);

export default function middleware(request: Parameters<typeof handleI18nRouting>[0]) {
  const response = handleI18nRouting(request);
  if (!request.cookies.get(ANON_COOKIE)?.value) {
    response.cookies.set(ANON_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: ANON_COOKIE_MAX_AGE,
    });
  }
  return response;
}

export const config = {
  // Run middleware on all page routes except API, static assets and files.
  // /api routes are locale-free and must not pass through next-intl.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public|.*\\..*).*)'],
};
