import { defineRouting } from 'next-intl/routing';

/**
 * Locale routing: en is the default (overseas market) and lives without a
 * prefix (/), zh lives under /zh. Middleware + navigation + request config
 * all derive from this single definition.
 */
export const routing = defineRouting({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  // Clean URLs: the default locale (en) lives without a prefix, zh under /zh.
  localePrefix: 'as-needed',
});
