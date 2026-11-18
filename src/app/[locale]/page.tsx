import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PLANS } from '@/lib/plans';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageSwitcher } from '@/components/language-switcher';
import { HeroBackground } from '@/components/effects/hero-background';
import { GradientText } from '@/components/effects/gradient-text';
import { LeadPipelineDiagram } from '@/components/effects/lead-pipeline-diagram';
import { getPipelineLeads } from '@/lib/intent';

const PRODUCT = 'X Lead Miner';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3019';

interface CopyItem {
  title: string;
  body: string;
}

interface FaqItem {
  question: string;
  answer: string;
}

export const revalidate = 1800;

export default async function LandingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations('landing');
  const meta = await getTranslations('metadata');
  const steps = t.raw('how.steps') as CopyItem[];
  const features = t.raw('features.items') as CopyItem[];
  const faq = t.raw('faq.items') as FaqItem[];
  const heroSubtitle = meta('description');
  const { leads, live } = await getPipelineLeads();

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      '@id': `${APP_URL}/#product`,
      name: PRODUCT,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: heroSubtitle,
      offers: Object.values(PLANS).map((plan) => ({
        '@type': 'Offer',
        name: plan.name,
        price: plan.id === 'pro' ? '19.00' : '0',
        priceCurrency: 'USD',
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      '@id': `${APP_URL}/#faq`,
      mainEntity: faq.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: { '@type': 'Answer', text: item.answer },
      })),
    },
  ];

  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight">
            {PRODUCT}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a href="#pricing" className="text-text-muted transition-colors hover:text-text">
              {t('navPricing')}
            </a>
            <LanguageSwitcher />
            <ThemeToggle />
            <Button href="/login" variant="secondary">
              {t('signIn')}
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero: one background effect, no scroll-triggered motion. */}
      <section className="relative overflow-hidden border-b border-border">
        <HeroBackground />
        <div className="relative mx-auto max-w-3xl px-6 py-28 text-center">
          <Badge>{t('badge')}</Badge>
          <h1 className="mt-6 font-display text-5xl font-bold tracking-tight sm:text-6xl">
            <GradientText>{t('heroTitle')}</GradientText>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-text-muted">{heroSubtitle}</p>
          <div className="mt-10 flex justify-center gap-3">
            <Button href="/login">{t('ctaPrimary')}</Button>
            <Button href="#pricing" variant="secondary">
              {t('ctaSecondary')}
            </Button>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="font-display text-2xl font-semibold tracking-tight">{t('how.title')}</h2>
        <p className="mt-2 text-text-muted">{t('how.subtitle')}</p>
        <div className="mt-10">
          <LeadPipelineDiagram
            leads={leads}
            live={live}
            labels={{
              input: t('pipeline.input'),
              hitSuffix: t('pipeline.hitSuffix'),
              model: t('pipeline.model'),
              modelSub: t('pipeline.modelSub'),
              queue: t('pipeline.queue'),
              binHigh: t('pipeline.binHigh'),
              binMid: t('pipeline.binMid'),
              binLow: t('pipeline.binLow'),
              binCountSuffix: t('pipeline.binCountSuffix'),
              statScored: t('pipeline.statScored'),
              statQualified: t('pipeline.statQualified'),
              scoringHint: t('pipeline.scoringHint'),
              emptyBin: t('pipeline.emptyBin'),
              sampleNote: t('pipeline.sampleNote'),
              aria: t('pipeline.aria'),
            }}
          />
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {steps.map((step, index) => (
            <Card key={step.title}>
              <div className="font-mono text-sm text-text-subtle">
                {String(index + 1).padStart(2, '0')}
              </div>
              <h3 className="mt-3 font-display text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm text-text-muted">{step.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            {t('features.title')}
          </h2>
          <p className="mt-2 text-text-muted">{t('features.subtitle')}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {features.map((feature, index) => (
              <Card key={feature.title}>
                <div className="font-mono text-sm text-text-subtle">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <h3 className="mt-3 font-display text-lg font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-text-muted">{feature.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="border-t border-border">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{t('pricing.title')}</h2>
          <p className="mt-2 text-text-muted">{t('pricing.subtitle')}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {Object.values(PLANS).map((plan) => (
              <Card
                key={plan.id}
                className={plan.id === 'pro' ? 'border-accent shadow-glow-sm' : undefined}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl font-semibold">{plan.name}</h3>
                  {plan.id === 'pro' && (
                    <Badge className="border-accent text-accent">{t('pricing.popular')}</Badge>
                  )}
                </div>
                <p className="mt-3 font-display text-3xl font-semibold">{plan.priceLabel}</p>
                <ul className="mt-4 space-y-2 text-sm text-text-muted">
                  {(t.raw(`pricing.${plan.id}.features`) as string[]).map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span aria-hidden="true" className="font-mono text-accent">
                        {'///'}
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {plan.id === 'pro' ? (
                    <Button href="/login">{t('pricing.upgrade')}</Button>
                  ) : (
                    <Button href="/login" variant="secondary">
                      {t('pricing.startFree')}
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-border">
        <div className="mx-auto max-w-3xl px-6 py-20">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{t('faq.title')}</h2>
          <div className="mt-8 space-y-3">
            {faq.map((item) => (
              <details
                key={item.question}
                className="group rounded-lg border border-border bg-surface px-5 py-4"
              >
                <summary className="cursor-pointer list-none font-medium marker:hidden">
                  <span className="mr-2 font-mono text-accent group-open:rotate-90 inline-block transition-transform">
                    &gt;
                  </span>
                  {item.question}
                </summary>
                <p className="mt-3 text-sm text-text-muted">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-10 text-sm text-text-subtle sm:flex-row sm:items-center sm:justify-between">
          <span>{PRODUCT}</span>
          <span className="font-mono">{t('footerRight')}</span>
        </div>
      </footer>
    </div>
  );
}
