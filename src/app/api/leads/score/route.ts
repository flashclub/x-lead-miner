import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scoreTexts, lastNativeError } from '@/lib/intent';

const scoreParamsSchema = z.object({
  texts: z.array(z.string().min(1).max(8000)).min(1).max(100),
  perItem: z.boolean().optional(),
});

/**
 * POST /api/leads/score  { texts: string[] }
 * → { scores: number[], elapsedSec: number | null }
 *
 * Called by the UI AFTER search results render: search returns instantly,
 * scoring streams in asynchronously (see lead-search.tsx). elapsedSec is
 * the model inference wall time in seconds (sidecar-reported).
 */
export async function POST(request: Request) {

  let parsed: z.SafeParseReturnType<z.infer<typeof scoreParamsSchema>, z.infer<typeof scoreParamsSchema>>;
  try {
    const body = await request.json();
    parsed = scoreParamsSchema.safeParse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? 'Invalid request' }, { status: 400 });
  }

  const result = await scoreTexts(parsed.data.texts, { perItem: parsed.data.perItem === true });
  if (!result) {
    return NextResponse.json(
      {
        error: 'Intent model sidecar unavailable — scores omitted',
        nativeError: lastNativeError(),
      },
      { status: 503 }
    );
  }
  return NextResponse.json({
    scores: result.scores,
    timesSec: result.timesSec,
    elapsedSec: result.elapsedSec,
  });
}
