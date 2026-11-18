import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Pure i18n routing — the demo site has no auth: every page and API route
// is public (search is IP-rate-limited at the route level).
const handleI18nRouting = createMiddleware(routing);

export default function middleware(request: Parameters<typeof handleI18nRouting>[0]) {
  return handleI18nRouting(request);
}

export const config = {
  // Run middleware on all page routes except API, static assets and files.
  // /api routes are locale-free and must not pass through next-intl.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|public|.*\\..*).*)'],
};
