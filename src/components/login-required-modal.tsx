'use client';

import { signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Forced free-quota gate: shown when an anonymous visitor has collected their
 * FREE_POST_LIMIT posts and tries to keep mining. Copy is written from the
 * visitor's point of view — what they got, what stays, what login unlocks —
 * and signing in adopts their anonymous data automatically (see
 * resolveUserIdentityForRequest), so nothing they did is lost.
 */
export function LoginRequiredModal({
  open,
  onClose,
  used,
  enabledProviders,
}: {
  open: boolean;
  onClose: () => void;
  used: number;
  enabledProviders: readonly string[];
}) {
  const t = useTranslations('loginRequired');
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
    >
      <Card className="w-full max-w-md p-6">
        <h2 className="font-display text-lg font-semibold">{t('title')}</h2>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">{t('body', { used })}</p>

        {enabledProviders.length > 0 ? (
          <div className="mt-5 space-y-2">
            {enabledProviders.includes('github') && (
              <Button
                className="w-full"
                onClick={() => void signIn('github', { redirectTo: '/dashboard' })}
              >
                {t('github')}
              </Button>
            )}
            {enabledProviders.includes('google') && (
              <Button
                className="w-full"
                onClick={() => void signIn('google', { redirectTo: '/dashboard' })}
              >
                {t('google')}
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-5 rounded-md bg-surface-2 px-3 py-2 text-xs leading-relaxed text-text-muted">
            {t('unconfigured')}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full text-center text-xs text-text-subtle transition-colors hover:text-text"
        >
          {t('dismiss')}
        </button>
      </Card>
    </div>
  );
}
