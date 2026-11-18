import { z } from 'zod';

// Public env vars (exposed to the client via NEXT_PUBLIC_ prefix)
const publicEnvSchema = z.object({
  NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: z.string().optional(),
});

// Private env vars (server-only). Accessed via getCloudflareContext().env on
// Workers, or process.env in `next dev` (Node).
const serverEnvSchema = z.object({
  AUTH_SECRET: z.string().optional(),
  AUTH_TRUST_HOST: z.string().optional().default('true'),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Scraper.tech X API key — optional so auth/stripe-only flows work without
  // it; the XApiClient checks presence at call time.
  SCRAPER_API_KEY: z.string().optional(),
  // MuleRun LLM gateway (chat assistant + intent-model labeling teacher).
  MULERUN_API_KEY: z.string().optional(),
  MULERUN_LLM_MODEL: z.string().optional(),
  // Local PyTorch intent sidecar (intent/serve.py); unset = scores omitted.
  INTENT_SERVICE_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getPublicEnv(): PublicEnv {
  return publicEnvSchema.parse({
    NEXT_PUBLIC_STRIPE_PRO_PRICE_ID: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  });
}

// Helper for Node `next dev` mode — reads from process.env.
// On Workers, callers read env from getCloudflareContext().env directly.
export function getServerEnvFromProcess(): ServerEnv {
  return serverEnvSchema.parse(process.env);
}
