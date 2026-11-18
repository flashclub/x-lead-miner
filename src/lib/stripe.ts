import Stripe from 'stripe';

let cached: Stripe | null = null;

/**
 * Returns a Stripe client. On Cloudflare Workers, the secret key is read from
 * the env binding; in `next dev` it comes from process.env.
 *
 * We cache the instance per-isolate (fine for Stripe — it's stateless HTTP).
 */
export async function getStripe(): Promise<Stripe> {
  if (cached) return cached;

  const secretKey = await resolveSecret('STRIPE_SECRET_KEY');
  cached = new Stripe(secretKey);
  return cached;
}

/**
 * Reads an env value from process.env first (covers `next dev` and tests),
 * then falls back to the Cloudflare binding (production + opennext preview).
 */
async function resolveSecret(name: string): Promise<string> {
  const fromProcess = process.env[name];
  if (fromProcess) return fromProcess;

  const { getCloudflareContext } = await import('@opennextjs/cloudflare');
  const { env } = await getCloudflareContext({ async: true });
  const value = (env as Record<string, string | undefined>)[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}
