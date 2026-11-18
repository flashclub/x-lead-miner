import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ChatPanel } from '@/components/chat-panel';

export default async function ChatPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('chat');

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>
      <div className="mt-6">
        <ChatPanel />
      </div>
    </div>
  );
}
