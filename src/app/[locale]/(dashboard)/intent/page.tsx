import fs from 'node:fs';
import path from 'node:path';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getServerVar } from '@/lib/server-env';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnalystPlayground } from '@/components/analyst-playground';

export const dynamic = 'force-dynamic';

interface PipelineStatus {
  collected: number | null;
  labeled: number | null;
  trained: boolean;
  metrics: Record<string, unknown> | null;
  sidecar: 'up' | 'down' | 'unset';
}

async function readStatus(): Promise<PipelineStatus> {
  const intentDir = path.join(process.cwd(), 'intent');
  const countLines = (file: string): number | null => {
    try {
      const content = fs.readFileSync(path.join(intentDir, file), 'utf8');
      return content.split('\n').filter((line) => line.trim()).length;
    } catch {
      return null;
    }
  };

  let metrics: Record<string, unknown> | null = null;
  try {
    metrics = JSON.parse(
      fs.readFileSync(path.join(intentDir, 'model', 'metrics.json'), 'utf8')
    ) as Record<string, unknown>;
  } catch {
    metrics = null;
  }

  const serviceUrl = await getServerVar('INTENT_SERVICE_URL');
  let sidecar: PipelineStatus['sidecar'] = 'unset';
  if (serviceUrl) {
    try {
      const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      sidecar = response.ok ? 'up' : 'down';
    } catch {
      sidecar = 'down';
    }
  }

  return {
    collected: countLines('data/posts.jsonl'),
    labeled: countLines('data/labeled.jsonl'),
    trained: metrics !== null,
    metrics,
    sidecar,
  };
}

export default async function IntentLabPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('intent');
  const status = await readStatus();

  const stepProps = [
    {
      index: '01',
      title: t('collect.title'),
      command: t('collect.command'),
      done: (status.collected ?? 0) > 0,
      state: status.collected ? t('posts', { n: status.collected }) : t('notStarted'),
      detail: t('collect.detail'),
    },
    {
      index: '02',
      title: t('label.title'),
      command: t('label.command'),
      done: (status.labeled ?? 0) > 0,
      state: status.labeled ? t('labeled', { n: status.labeled }) : t('notStarted'),
      detail: t('label.detail'),
    },
    {
      index: '03',
      title: t('train.title'),
      command: t('train.command'),
      done: status.trained,
      state: status.trained ? t('trained') : t('notStarted'),
      detail: t('train.detail'),
    },
    {
      index: '04',
      title: t('serve.title'),
      command: t('serve.command'),
      done: status.sidecar === 'up',
      state:
        status.sidecar === 'up'
          ? t('sidecarUp')
          : status.sidecar === 'down'
            ? t('sidecarDown')
            : t('sidecarUnset'),
      detail: t('serve.detail'),
    },
  ];

  const quickStart = `cd intent
python3 collect.py && python3 label.py --limit 50
pip install -r requirements.txt
python3 train.py
python3 serve.py   # then set INTENT_SERVICE_URL=http://127.0.0.1:5019`;

  return (
    <div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="mt-2 text-text-muted">{t('subtitle')}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {stepProps.map((step) => (
          <Card key={step.index}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm text-text-subtle">{step.index}</span>
              <Badge className={step.done ? 'border-accent text-accent' : undefined}>
                {step.state}
              </Badge>
            </div>
            <h3 className="mt-3 font-display text-lg font-semibold">{step.title}</h3>
            {step.detail && <p className="mt-2 text-sm text-text-muted">{step.detail}</p>}
            <p className="mt-3 font-mono text-sm text-text-subtle">{step.command}</p>
          </Card>
        ))}
      </div>

      {status.metrics && (
        <Card className="mt-4">
          <h2 className="font-display text-lg font-semibold">{t('metricsTitle')}</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-2">
            {Object.entries(status.metrics).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4">
                <dt className="text-text-subtle">{key}</dt>
                <dd className="text-text">{String(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">{t('quickStart')}</h2>
        <pre className="mt-3 overflow-x-auto font-mono text-sm text-text-muted">{quickStart}</pre>
        <p className="mt-3 text-sm text-text-muted">
          {t.rich('readmeNote', {
            code: (chunks) => <code className="font-mono text-sm">{chunks}</code>,
          })}
        </p>
      </Card>

      {/* The second model. Static copy and a client-side playground only: unlike
          the four steps above this reads nothing from disk, so it renders on
          Workers too. Nothing calls a model until the reader presses a button. */}
      <Card className="mt-4">
        <h2 className="font-display text-lg font-semibold">{t('twoModels.title')}</h2>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">{t('twoModels.subtitle')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="font-mono text-xs text-text-subtle">
                {(['colModel', 'colRuns', 'colOutput', 'colSpeed', 'colMeasured'] as const).map((key) => (
                  <th key={key} className="border-b border-border py-2 pr-4 font-normal">
                    {t(`twoModels.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(['scorer', 'analyst'] as const).map((row) => (
                <tr key={row} className="align-top" data-testid={`two-models-${row}`}>
                  {(['Model', 'Runs', 'Output', 'Speed', 'Measured'] as const).map((column) => (
                    <td key={column} className="border-b border-border py-3 pr-4 text-text-muted">
                      {t(`twoModels.${row}${column}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-text-muted">{t('twoModels.docsLink')}</p>
      </Card>

      <div className="mt-4">
        <AnalystPlayground />
      </div>
    </div>
  );
}
