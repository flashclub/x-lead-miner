/**
 * Contract smoke test for the Scraper.tech X API — 3 authorized requests
 * asserting the shapes src/lib/x-api.ts relies on (see docs/x-api.md).
 *
 *   pnpm x:smoke
 *
 * Requires SCRAPER_API_KEY in .dev.vars (or the environment). A failure
 * usually means the upstream schema changed — re-verify against the
 * Playground before editing x-api.ts. Never prints the key.
 */
import { XApiClient } from '../src/lib/x-api';

async function main() {
  const apiKey = process.env.SCRAPER_API_KEY;
  if (!apiKey) {
    console.error('SCRAPER_API_KEY is not set — put it in .dev.vars or the environment');
    process.exit(1);
  }

  const client = new XApiClient({ apiKey });
  let failures = 0;
  const check = (name: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
  };

  const profile = await client.profile('elonmusk');
  check('profile.restId is a numeric id', /^\d+$/.test(profile.restId), profile.restId);
  check('profile.followers parsed', (profile.followers ?? 0) > 0, String(profile.followers));
  check('profile.createdAt parsed to ISO', profile.createdAtIso !== undefined, profile.createdAtIso);

  const page = await client.search('"anyone recommend a tool" lang:en -filter:replies', {
    searchType: 'Latest',
  });
  check('search returned posts', page.posts.length > 0, `${page.posts.length} posts`);
  const phrase = 'anyone recommend a tool';
  const allMatch = page.posts.every((post) => post.text.toLowerCase().includes(phrase));
  check('exact-phrase operator honored', allMatch);
  check('nextCursor present', typeof page.nextCursor === 'string' && page.nextCursor.length > 0);

  const first = page.posts[0];
  check('post has author handle', first.author.handle.length > 0, first.author.handle);
  check('post has post URL', first.url.includes('/status/'), first.url);

  const detail = await client.tweet(first.id);
  check('tweet id matches search result', detail.id === first.id, detail.id);
  check('tweet text non-empty', detail.text.length > 0);

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed — upstream contract may have changed`);
    process.exit(1);
  }
  console.log('\nall contract checks passed');
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`smoke test error: ${message}`);
  process.exit(1);
});
