import { z } from 'zod';

/**
 * Typed client for the Scraper.tech X API (https://api.scraper.tech).
 *
 * Contract verified against the live API on 2026-11-16 — see docs/x-api.md
 * for the full field lists and quirks. Known traps baked into this client:
 *   - Auth is the `Scraper-Key` header (not Bearer, not query param).
 *   - Upstream returns HTTP 200 for business errors; the error lives in the
 *     JSON body (`{"error": "..."}`). Rate limiting can also surface as a
 *     body-level error, not only as HTTP 429.
 *   - search and tweet return DIFFERENT tweet shapes:
 *     search → tweet_id / user_info / favorites, tweet → id / author / likes.
 *   - Follower count is `followers_count` inside search's user_info, but
 *     `sub_count` in tweet's author and screenname's profile.
 * Do not add schema fields without re-verifying against the live API or the
 * Playground (https://scraper.tech/panel/playground/twitter/).
 */

const BASE_URL = 'https://api.scraper.tech';
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

/** Metrics arrive as numbers for some fields and strings for others. */
const num = () =>
  z.preprocess(
    (value) => (value === null || value === '' ? undefined : value),
    z.coerce.number().optional().catch(undefined)
  );

const str = () => z.string().nullish().transform((v) => v ?? undefined);

const bool = () => z.boolean().optional().catch(undefined);

const searchUserInfoSchema = z.object({
  rest_id: str(),
  screen_name: str(),
  name: str(),
  description: str(),
  location: str(),
  created_at: str(),
  url: str(),
  avatar: str(),
  followers_count: num(),
  friends_count: num(),
  favorites_count: num(),
  verified: bool(),
  verified_type: str(),
});

const searchTweetSchema = z.object({
  tweet_id: z.string(),
  text: str(),
  created_at: str(),
  conversation_id: str(),
  lang: str(),
  type: str(),
  screen_name: str(),
  favorites: num(),
  retweets: num(),
  replies: num(),
  quotes: num(),
  views: num(),
  bookmarks: num(),
  user_info: searchUserInfoSchema.optional().catch(undefined),
});

const searchResponseSchema = z.object({
  timeline: z.array(searchTweetSchema).default([]),
  next_cursor: str(),
  prev_cursor: str(),
});

const screennameResponseSchema = z.object({
  status: str(),
  profile: str(),
  rest_id: str(),
  id: str(),
  name: str(),
  desc: str(),
  location: str(),
  protected: bool(),
  blue_verified: bool(),
  // Scraper.tech naming: friends = following count, sub_count = followers.
  friends: num(),
  sub_count: num(),
  statuses_count: num(),
  media_count: num(),
  created_at: str(),
  avatar: str(),
});

const tweetAuthorSchema = z.object({
  rest_id: str(),
  screen_name: str(),
  name: str(),
  sub_count: num(),
  blue_verified: bool(),
  image: str(),
});

const tweetDetailResponseSchema = z.object({
  id: z.string(),
  text: str(),
  display_text: str(),
  created_at: str(),
  conversation_id: str(),
  lang: str(),
  status: str(),
  likes: num(),
  retweets: num(),
  replies: num(),
  quotes: num(),
  views: num(),
  bookmarks: num(),
  in_reply_to_screen_name: str(),
  author: tweetAuthorSchema.optional().catch(undefined),
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
   *  since:/until:) pass through — verified 2026-11-16. */
  async search(query: string, options: SearchOptions = {}): Promise<SearchPage> {
    const data = await this.request('search.php', {
      query,
      search_type: options.searchType ?? 'Latest',
      cursor: options.cursor ?? '',
    }, searchResponseSchema);

    const posts = data.timeline.map((tweet) => {
      const handle = tweet.user_info?.screen_name ?? tweet.screen_name;
      return {
        id: tweet.tweet_id,
        text: tweet.text ?? '',
        createdAtRaw: tweet.created_at,
        createdAtIso: toIso(tweet.created_at),
        author: {
          restId: tweet.user_info?.rest_id,
          handle: handle ?? '',
          name: tweet.user_info?.name,
          followers: tweet.user_info?.followers_count,
          verified: tweet.user_info?.verified,
        },
        metrics: {
          favorites: tweet.favorites,
          replies: tweet.replies,
          retweets: tweet.retweets,
          quotes: tweet.quotes,
          views: tweet.views,
          bookmarks: tweet.bookmarks,
        },
        conversationId: tweet.conversation_id,
        lang: tweet.lang,
        url: postUrl(handle, tweet.tweet_id),
      } satisfies XPost;
    });

    return { posts, nextCursor: data.next_cursor, prevCursor: data.prev_cursor };
  }

  /** Public profile info by handle. */
  async profile(handle: string): Promise<XProfile> {
    const data = await this.request('screenname.php', {
      screenname: handle,
      rest_id: '',
    }, screennameResponseSchema);

    return {
      handle: data.profile ?? handle,
      restId: data.rest_id ?? data.id ?? '',
      name: data.name,
      description: data.desc,
      location: data.location,
      followers: data.sub_count,
      following: data.friends,
      statusesCount: data.statuses_count,
      verified: data.blue_verified,
      isProtected: data.protected,
      createdAtRaw: data.created_at,
      createdAtIso: toIso(data.created_at),
      avatar: data.avatar,
    };
  }

  /** Single tweet by id. Note: returns the same normalized XPost shape as
   *  search(), although the upstream schema is different. */
  async tweet(id: string): Promise<XPost> {
    const data = await this.request('tweet.php', { id }, tweetDetailResponseSchema);

    return {
      id: data.id,
      text: data.display_text ?? data.text ?? '',
      createdAtRaw: data.created_at,
      createdAtIso: toIso(data.created_at),
      author: {
        restId: data.author?.rest_id,
        handle: data.author?.screen_name ?? '',
        name: data.author?.name,
        followers: data.author?.sub_count,
        verified: data.author?.blue_verified,
      },
      metrics: {
        favorites: data.likes,
        replies: data.replies,
        retweets: data.retweets,
        quotes: data.quotes,
        views: data.views,
        bookmarks: data.bookmarks,
      },
      conversationId: data.conversation_id,
      lang: data.lang,
      url: postUrl(data.author?.screen_name, data.id),
    };
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
        headers: { 'Scraper-Key': this.apiKey },
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
      throw new XApiError('rate limited by scraper.tech', {
        kind: 'rate_limited',
        status: 429,
      });
    }
    if (!response.ok) {
      throw new XApiError(`${endpoint} responded HTTP ${response.status}`, {
        kind: 'upstream',
        status: response.status,
      });
    }

    // Upstream returns HTTP 200 for business errors — check the body first.
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new XApiError(`${endpoint} returned non-JSON body`, {
        kind: 'schema',
        status: response.status,
      });
    }
    if (
      json !== null &&
      typeof json === 'object' &&
      'error' in json &&
      typeof (json as { error: unknown }).error === 'string' &&
      (json as { error: string }).error.length > 0
    ) {
      const message = (json as { error: string }).error;
      throw new XApiError(message, {
        kind: /rate|limit/i.test(message) ? 'rate_limited' : 'upstream',
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
