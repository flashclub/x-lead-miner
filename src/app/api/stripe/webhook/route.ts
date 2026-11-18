import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getDb } from '@/lib/db';

/**
 * POST /api/stripe/webhook
 * Public route — NOT behind auth middleware (Stripe has no session cookie).
 * Excluded in middleware matcher.
 *
 * Verifies the raw body, then updates billing columns on the user row based on
 * event type. The user row is created on sign-in (auth.ts signIn callback); the
 * webhook only fills in the Stripe columns. Idempotent: the unique
 * stripeCustomerId constraint prevents duplicate updates.
 */
export async function POST(req: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const stripe = await getStripe();

  // Stripe requires the RAW body for signature verification.
  // req.text() preserves the raw bytes; req.json() would break the signature.
  const body = await req.text();
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await handleSubscriptionChange(event);
        break;
      default:
        // Unhandled events are acknowledged but not acted on.
        break;
    }
  } catch (err) {
    // Log but return 200 to avoid Stripe retry storms; investigate via logs.
    console.error('Webhook handler error', err);
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const prisma = await getDb();

  const stripeCustomerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id;
  const email = session.customer_email ?? session.metadata?.user_email;
  if (!stripeCustomerId || !email) {
    console.warn('checkout.session.completed missing customer or email', { session });
    return;
  }

  // The user row already exists (created on sign-in). Look it up by email.
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Sign-in should have created this row. If missing, the user signed up
    // through some other path; warn and skip rather than fabricating a row.
    console.warn('checkout.session.completed: no user for email', { email });
    return;
  }

  // Read subscription status + current period end.
  let status: string = session.status ?? 'active';
  let currentPeriodEnd: Date | null = null;
  if (typeof session.subscription === 'string') {
    const stripe = await getStripe();
    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    status = subscription.status;
    currentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null;
  }

  // Attach billing columns to the existing user row.
  // The unique stripeCustomerId constraint makes this safe against event replays.
  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId,
      subscriptionPlan: 'pro',
      subscriptionStatus: status,
      currentPeriodEnd,
    },
  });
}

async function handleSubscriptionChange(event: Stripe.Event) {
  const subscription = event.data.object as Stripe.Subscription;
  const stripeCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!stripeCustomerId) return;

  const prisma = await getDb();
  // Canceled/deleted → free; active/trialing → pro.
  const isActive = subscription.status === 'active' || subscription.status === 'trialing';
  const plan = isActive ? 'pro' : 'free';
  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000)
    : null;

  await prisma.user.updateMany({
    where: { stripeCustomerId },
    data: {
      subscriptionPlan: plan,
      subscriptionStatus: subscription.status,
      currentPeriodEnd,
    },
  });
}
