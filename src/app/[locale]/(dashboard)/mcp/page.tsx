import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/**
 * MCP module — SCAFFOLD ONLY. The Model Context Protocol server (transport,
 * auth, tool schemas) is not implemented yet; this page communicates the plan
 * and reserves the navigation slot.
 */
export default async function McpPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('mcp');

  const tools = [
    { name: t('toolSearch'), desc: t('toolSearchDesc') },
    { name: t('toolHistory'), desc: t('toolHistoryDesc') },
    { name: t('toolScore'), desc: t('toolScoreDesc') },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
        <Badge className="border-accent text-accent">{t('plannedBadge')}</Badge>
      </div>
      <p className="mt-2 max-w-3xl text-text-muted">{t('subtitle')}</p>

      <h2 className="mt-8 font-display text-lg font-semibold">{t('toolsTitle')}</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {tools.map((tool) => (
          <Card key={tool.name}>
            <p className="font-mono text-sm font-medium text-accent">{tool.name}</p>
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{tool.desc}</p>
          </Card>
        ))}
      </div>

      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">{t('noteTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-text-muted">{t('noteBody')}</p>
      </Card>
    </div>
  );
}
