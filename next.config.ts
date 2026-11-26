import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// serverExternalPackages is REQUIRED for Prisma + @opennextjs/cloudflare.
// Without it, the generated client is not correctly bundled for the Workers runtime.
const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
};

// Bindings (D1, AI, …) inside plain `next dev`: starts the wrangler proxy and
// persists miniflare state to .wrangler/state so local data survives restarts.
// No-op outside development.
if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev();
}

export default withNextIntl(nextConfig);
