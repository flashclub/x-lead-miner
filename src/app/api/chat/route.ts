import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerVar } from '@/lib/server-env';

const chatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(8_000),
      })
    )
    .min(1)
    .max(20),
});

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MULERUN_BASE_URL = 'https://api.mulerun.com';
const LLM_TIMEOUT_MS = 60_000;

// The assistant knows the product so its advice stays concrete.
const SYSTEM_PROMPT = [
  'You are the assistant inside X Lead Miner, a tool that mines public X (Twitter) posts for buying intent and turns them into a scored lead queue.',
  'Help the user: compose X advanced search queries (exact "phrases", lang:en, -filter:replies, since:/until: dates, min_faves:), interpret whether a post shows buying intent, and plan which niches/signals to mine.',
  'Be concise and concrete; show example queries in code formatting.',
  'You are read-only: you cannot post, like, follow, or DM on X, and you cannot browse the web.',
].join(' ');

/**
 * POST /api/chat — relays a chat turn to MuleRun's OpenAI-compatible
 * endpoint (server-side only; the key never reaches the browser).
 */
export async function POST(request: Request) {

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return NextResponse.json({ error: issue?.message ?? 'Invalid request' }, { status: 400 });
  }

  const [apiKey, model] = await Promise.all([
    getServerVar('MULERUN_API_KEY'),
    getServerVar('MULERUN_LLM_MODEL'),
  ]);
  if (!apiKey) {
    return NextResponse.json(
      { error: 'MULERUN_API_KEY is not configured on the server' },
      { status: 500 }
    );
  }

  let response: Response;
  try {
    response = await fetch(`${MULERUN_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...parsed.data.messages],
        temperature: 0.4,
        // Gemini-style models spend thinking tokens from this budget.
        max_tokens: 1_500,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch {
    return NextResponse.json(
      { error: 'Could not reach the LLM provider' },
      { status: 504 }
    );
  }

  if (response.status === 429) {
    return NextResponse.json(
      { error: 'LLM provider rate limit hit — try again in a moment' },
      { status: 429 }
    );
  }
  if (!response.ok) {
    return NextResponse.json(
      { error: `LLM provider returned HTTP ${response.status}` },
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return NextResponse.json({ error: 'LLM provider returned non-JSON' }, { status: 502 });
  }

  const content = (
    data as {
      choices?: { message?: { content?: unknown } }[];
      error?: { message?: string };
    }
  )?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.length === 0) {
    // Some gateways return 200 with an in-body error object.
    const upstreamError =
      typeof (data as { error?: { message?: string } }).error?.message === 'string'
        ? (data as { error: { message: string } }).error.message
        : 'LLM returned an empty response';
    return NextResponse.json({ error: upstreamError }, { status: 502 });
  }

  return NextResponse.json({ reply: content });
}
