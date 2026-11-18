'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Client component that calls /api/stripe/checkout and redirects to the
 * Stripe-hosted checkout URL returned in the JSON response.
 *
 * We use a client component (not a plain form POST) because the checkout
 * route returns JSON { url } rather than a 302 redirect.
 */
export function CheckoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to start checkout');
      }
      // Redirect to Stripe-hosted checkout
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }

  return (
    <div className="mt-4">
      <Button type="button" onClick={handleClick} disabled={loading}>
        {loading ? 'Redirecting...' : 'Upgrade to Pro'}
      </Button>
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  );
}
