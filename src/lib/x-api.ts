import { z } from 'zod';

/**
 * Typed client for the AI API Key X API (https://aiapikey.ai).
 *
 * Contract verified against the live API on 2026-11-25 — see docs/x-api.md
 * for the full field lists and quirks. Known traps baked into this client:
 *   - Auth is the `Authorization: Bearer` header; keys look like `ua_live_…`.
 *   - Billing is per returned result (12 credits/tweet; $1 = 100k credits).
 *     429 `quota_exceeded` means credits ran out, not request rate limiting.
 *   - Errors are proper HTTP status codes with `{"error":{"code","message"}}`
 *     bodies (402 = no auth header, an x402 payment challenge).
 *   - `createdAt` keeps Twitter's legacy date format — `toIso` handles it.
 *   - The single-tweet endpoint can return `author.followers = 0` and
 *     `author.avatar = ""` even when search shows real values; tweet-level
 *     author fields are best-effort.
 *   - Upstream has no per-tweet `rest_id` / `conversation_id`, and no
 *     profile `location` / `statusesCount` / `isProtected` — the shared
 *     interfaces keep those slots and they stay undefined.
 * Do not add schema fields without re-verifying against the live API
 * (`pnpm x:smoke`) or the reference at https://aiapikey.ai/docs/reference.
 */

const BASE_URL = 'https://aiapikey.ai';
const REQUEST_TIMEOUT_MS = 30_000;

export type SearchType = 'Top' | 'Latest' | 'Media' | 'People' | 'Lists';

export interface XApiErrorOptions {
  kind: XApiErrorKind;
  status: number;
  cause?: unknown;
}

export type XApiErrorKind = 'network' | 'rate_limited' | 'upstream' | 'schema';

export class XApiError extends Error {
  readonly kind: XApiErrorKind;
  readonly status: number;

  constructor(message: string, options: XApiErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'XApiError';
    this.kind = options.kind;
    this.status = options.status;
  }
}

/** Numbers may arrive as numbers or numeric strings. */
const num = () =>
  z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    z.coerce.number().optional().catch(undefined)
  );

const str = () => z.string().nullish().transform((v) => v ?? undefined);

const bool = () => z.boolean().optional().catch(undefined);

const authorSchema = z.object({
  name: str(),
  screenName: str(),
  avatar: str(),
  followers: num(),
  verified: bool(),
});

const metricsSchema = z.object({
  bookmarks: num(),
  favorites: num(),
  quotes: num(),
  replies: num(),
  retweets: num(),
  views: num(),
});

/** Shared shape of /v1/x/search, /v1/x/tweets and timeline-style endpoints. */
const tweetSchema = z.object({
  id: z.string(),
  url: str(),
  text: str(),
  createdAt: str(),
  language: str(),
  author: authorSchema.nullish().transform((v) => v ?? undefined).catch(undefined),
  metrics: metricsSchema.nullish().transform((v) => v ?? undefined).catch(undefined),
  hashtags: z.array(z.string()).optional().catch(undefined),
  mentions: z.array(z.string()).optional().catch(undefined),
});

const searchResponseSchema = z.object({
  tweets: z.array(tweetSchema).default([]),
  nextCursor: str(),
  previousCursor: str(),
});

const userResponseSchema = z.object({
  id: str(),
  name: str(),
  screenName: str(),
  avatar: str(),
  followers: num(),
  verified: bool(),
  bio: str(),
  createdAt: str(),
});

export type SearchPage = {
  posts: XPost[];
  nextCursor: string | undefined;
  prevCursor: string | undefined;
};

export interface XAuthor {
  restId: string | undefined;
  handle: string;
  name: string | undefined;
  followers: number | undefined;
  verified: boolean | undefined;
}

export interface XPostMetrics {
  favorites: number | undefined;
  replies: number | undefined;
  retweets: number | undefined;
  quotes: number | undefined;
  views: number | undefined;
  bookmarks: number | undefined;
}

export interface XPost {
  id: string;
  text: string;
  /** Raw upstream date, e.g. "Sat Nov 07 00:00:01 +0000 2026". */
  createdAtRaw: string | undefined;
  /** ISO string parsed from createdAtRaw, undefined when unparseable. */
  createdAtIso: string | undefined;
  author: XAuthor;
  metrics: XPostMetrics;
  conversationId: string | undefined;
  lang: string | undefined;
  url: string;
  /** Buying-intent score 0..1 from the local PyTorch sidecar (intent/).
   *  Not part of the upstream API — attached by /api/leads/search when
   *  INTENT_SERVICE_URL is configured and healthy; omitted otherwise. */
  intentScore?: number;
  /** per-post model latency in seconds (reported by the sidecar) */
  intentScoreSec?: number;
}

export interface XProfile {
  handle: string;
  restId: string;
  name: string | undefined;
  description: string | undefined;
  location: string | undefined;
  followers: number | undefined;
  following: number | undefined;
  statusesCount: number | undefined;
  verified: boolean | undefined;
  isProtected: boolean | undefined;
  createdAtRaw: string | undefined;
  createdAtIso: string | undefined;
  avatar: string | undefined;
}

/** V8 parses Twitter's legacy date format directly; guard anyway. */
function toIso(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function postUrl(handle: string | undefined, id: string): string {
  return `https://x.com/${handle ?? 'i'}/status/${id}`;
}

function toPost(tweet: z.infer<typeof tweetSchema>): XPost {
  return {
    id: tweet.id,
    text: tweet.text ?? '',
    createdAtRaw: tweet.createdAt,
    createdAtIso: toIso(tweet.createdAt),
    author: {
      // Upstream provides no author rest_id on tweets — see header note.
      restId: undefined,
      handle: tweet.author?.screenName ?? '',
      name: tweet.author?.name,
      followers: tweet.author?.followers,
      verified: tweet.author?.verified,
    },
    metrics: {
      favorites: tweet.metrics?.favorites,
      replies: tweet.metrics?.replies,
      retweets: tweet.metrics?.retweets,
      quotes: tweet.metrics?.quotes,
      views: tweet.metrics?.views,
      bookmarks: tweet.metrics?.bookmarks,
    },
    conversationId: undefined,
    lang: tweet.language,
    url: tweet.url || postUrl(tweet.author?.screenName, tweet.id),
  };
}

export interface XApiClientConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class XApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: XApiClientConfig) {
    if (!config.apiKey) throw new Error('XApiClient requires an apiKey');
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? BASE_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Search public posts. X advanced operators (phrases, lang:, -filter:,
   *  since:/until:, min_faves:) pass through — verified 2026-11-25. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchPage> {
    const data = await this.request('v1/x/search', {
      query,
      searchType: options.searchType ?? 'Latest',
      cursor: options.cursor ?? '',
    }, searchResponseSchema);

    return {
      posts: data.tweets.map(toPost),
      nextCursor: data.nextCursor,
      prevCursor: data.previousCursor,
    };
  }

  /** Public profile info by handle. Upstream has no location / tweet count /
   *  protected flag — those XProfile slots stay undefined (see header note). */
  async profile(handle: string): Promise<XProfile> {
    const data = await this.request('v1/x/users', { username: handle }, userResponseSchema);

    return {
      handle: data.screenName ?? handle,
      restId: data.id ?? '',
      name: data.name,
      description: data.bio,
      location: undefined,
      followers: data.followers,
      following: undefined,
      statusesCount: undefined,
      verified: data.verified,
      isProtected: undefined,
      createdAtRaw: data.createdAt,
      createdAtIso: toIso(data.createdAt),
      avatar: data.avatar,
    };
  }

  /** Single tweet by id. Same normalized XPost shape as search(). Author
   *  fields here are best-effort upstream (followers may be 0). */
  async tweet(id: string): Promise<XPost> {
    const data = await this.request('v1/x/tweets', { id }, tweetSchema);
    return toPost(data);
  }

  /** Extract a human-readable message from an error body. Shape is
   *  `{"error":{"code","message"}}`; tolerate a legacy string form too. */
  private static errorMessage(json: unknown, fallback: string): string {
    if (json !== null && typeof json === 'object' && 'error' in json) {
      const error = (json as { error: unknown }).error;
      if (typeof error === 'string' && error.length > 0) return error;
      if (error !== null && typeof error === 'object') {
        const { code, message } = error as { code?: unknown; message?: unknown };
        const text = typeof message === 'string' ? message : '';
        const name = typeof code === 'string' ? code : '';
        if (text && name) return `${name}: ${text}`;
        if (text || name) return text || name;
      }
    }
    return fallback;
  }

  private async request<S extends z.ZodTypeAny>(
    endpoint: string,
    params: Record<string, string>,
    schema: S
  ): Promise<z.infer<S>> {
    const url = new URL(endpoint, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new XApiError(`request to ${endpoint} failed`, {
        kind: 'network',
        status: 0,
        cause: error,
      });
    }

    if (response.status === 429) {
      // aiapikey.ai: 429 = quota_exceeded (credits), not request rate limiting.
      throw new XApiError('X data provider quota exhausted (out of credits)', {
        kind: 'rate_limited',
        status: 429,
      });
    }
    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Non-JSON error body — fall through to the status-code message.
      }
      const fallback =
        response.status === 401
          ? 'unauthorized — API key missing, invalid or revoked'
          : response.status === 402
            ? 'payment required — request went out without an API key'
            : `${endpoint} responded HTTP ${response.status}`;
      throw new XApiError(XApiClient.errorMessage(body, fallback), {
        kind: 'upstream',
        status: response.status,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new XApiError(`${endpoint} returned non-JSON body`, {
        kind: 'schema',
        status: response.status,
      });
    }
    // Defensive: a 200 carrying an in-body error object should not pass as data.
    if (
      json !== null &&
      typeof json === 'object' &&
      'error' in json &&
      (json as { error: unknown }).error !== undefined &&
      (json as { error: unknown }).error !== null
    ) {
      throw new XApiError(XApiClient.errorMessage(json, `${endpoint} returned an error body`), {
        kind: 'upstream',
        status: response.status,
      });
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new XApiError(
        `${endpoint} schema mismatch at ${issue?.path.join('.') ?? '?'}: ${issue?.message ?? 'unknown'}`,
        { kind: 'schema', status: response.status }
      );
    }
    return parsed.data;
  }
}

export interface SearchOptions {
  searchType?: SearchType;
  cursor?: string;
}
