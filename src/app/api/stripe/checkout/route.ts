import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getStripe } from '@/lib/stripe';
import { getPublicEnv } from '@/lib/env';

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session for upgrading to Pro.
 * Uses `customer_email` (not `customer`) — the customer is created by Stripe
 * only on successful payment, then recorded by the webhook.
 *
 * Returns JSON { url } — the client redirects to this Stripe-hosted URL.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { NEXT_PUBLIC_STRIPE_PRO_PRICE_ID } = getPublicEnv();
  const stripe = await getStripe();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: session.user.email,
    line_items: [{ price: NEXT_PUBLIC_STRIPE_PRO_PRICE_ID, quantity: 1 }],
    success_url: `${appUrl}/billing?success=true`,
    cancel_url: `${appUrl}/billing?canceled=true`,
    // subscription_data.metadata lets the webhook map back to our user via
    // email (the customer doesn't exist yet at checkout-creation time).
    subscription_data: {
      metadata: { user_email: session.user.email },
    },
  });

  if (!checkoutSession.url) {
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }

  return NextResponse.json({ url: checkoutSession.url });
}
