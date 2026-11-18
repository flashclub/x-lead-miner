import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// serverExternalPackages is REQUIRED for Prisma + @opennextjs/cloudflare.
// Without it, the generated client is not correctly bundled for the Workers runtime.
const nextConfig: NextConfig = {
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
};

export default withNextIntl(nextConfig);
