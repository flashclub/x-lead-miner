import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';

// Only canonical, public, indexable routes belong here — /login, /dashboard
// and /billing are noindex and intentionally excluded. One entry per locale
// (default locale lives without a prefix).
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3019';
  return routing.locales.map((locale) => ({
    url: locale === routing.defaultLocale ? `${base}/` : `${base}/${locale}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 1,
  }));
}
