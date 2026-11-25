/**
 * X Lead Miner — content script for x.com / twitter.com.
 *
 * Reads every tweet straight out of the page and appends a small buying-intent
 * badge next to its timestamp. Nothing here talks to the network: x.com's
 * origin is blocked by CORS on /api/leads/score, so all scoring goes through
 * the background service worker (see background.js).
 *
 * Design notes that are easy to get wrong:
 *  - Tweets are keyed by a hash of their text, not by DOM node. X recycles and
 *    re-renders nodes while scrolling; a text key survives that, dedupes
 *    retweets/quotes, and lets a response find its targets by attribute.
 *  - Scores are cached twice (memory + chrome.storage.local, 24h) because the
 *    endpoint spends Workers AI neurons and has no rate limit to push back.
 *  - The DOM contract lives in SELECTORS only. When X reshuffles its markup,
 *    that is the single place to fix.
 */

const SELECTORS = {
  tweet: 'article[data-testid="tweet"]',
  text: '[data-testid="tweetText"]',
  permalink: 'a[href*="/status/"] time',
  userName: '[data-testid="User-Name"]',
  promoted: '[data-testid="placementTracking"]',
};

const MIN_TEXT_LEN = 12; // mirrors the queue filter in src/lib/intent.ts
const BATCH_SIZE = 20; // API accepts 100; keep bodies small and latency visible
const QUEUE_DEBOUNCE_MS = 250;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHED = 5000;
const MAX_ATTEMPTS = 2;
const FAILURES_BEFORE_PAUSE = 3;
const PAUSE_MS = 60_000;
const STORAGE_PREFIX = 's:';

/* ---------------- helpers ---------------- */

/** djb2. Stable across reloads and cheap enough to run on every scan. */
function textKey(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

function cleanText(node) {
  return (node?.innerText ?? '').replace(/\s+/g, ' ').trim();
}

function tierOf(percent) {
  if (percent >= 80) return 'high';
  if (percent >= 60) return 'mid';
  return 'low';
}

/* ---------------- state ---------------- */

/** key -> { score, sec, at }; mirror of the persisted cache. */
const scores = new Map();
/** key -> text, waiting to be sent. */
const queue = new Map();
/** key -> attempts, so a poisoned batch cannot retry forever. */
const attempts = new Map();

let flushTimer = null;
let inFlight = false;
let failures = 0;
let pausedUntil = 0;
let scoredCount = 0;
let observer = null;

/* ---------------- badge ---------------- */

function makeBadge(score, sec) {
  const percent = Math.round(score * 100);
  const badge = document.createElement('span');
  badge.className = 'xlm-badge';
  badge.dataset.tier = tierOf(percent);
  badge.textContent = `score ${percent}`;
  badge.title = [
    `X Lead Miner — buying intent ${score.toFixed(3)}`,
    typeof sec === 'number' ? `${sec.toFixed(4)}s` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return badge;
}

/** Anchored right after the timestamp so it reads as metadata, not content.
 *  Falls back to an absolutely-positioned overlay if that spot disappears. */
function attachBadge(article, score, sec) {
  const badge = makeBadge(score, sec);
  const existing = article.querySelector('.xlm-badge');
  if (existing) {
    existing.replaceWith(badge);
    return;
  }
  try {
    const link = article.querySelector(SELECTORS.permalink)?.closest('a');
    if (link?.parentElement) {
      link.after(badge);
      return;
    }
  } catch {
    // X re-rendered mid-insert — try the overlay below instead.
  }
  try {
    badge.classList.add('xlm-badge--overlay');
    article.appendChild(badge);
  } catch {
    // Nothing left to try; the next mutation sweep will attempt again.
  }
}

/* ---------------- scanning ---------------- */

function scanArticle(article) {
  if (article.dataset.xlmKey) return; // already scored, queued, or skipped

  if (article.querySelector(SELECTORS.promoted)) {
    article.dataset.xlmKey = 'skip';
    return;
  }

  const text = cleanText(article.querySelector(SELECTORS.text));
  if (text.length < MIN_TEXT_LEN) {
    article.dataset.xlmKey = 'skip';
    return;
  }

  const key = textKey(text);
  article.dataset.xlmKey = key;

  const cached = scores.get(key);
  if (cached) {
    attachBadge(article, cached.score, cached.sec);
    return;
  }

  if (!queue.has(key)) queue.set(key, text);
  scheduleFlush();
}

/** Re-attach badges X's own re-render may have dropped, and pick up new cards. */
function rescan() {
  for (const article of document.querySelectorAll(SELECTORS.tweet)) {
    const key = article.dataset.xlmKey;
    if (!key) {
      scanArticle(article);
      continue;
    }
    if (key === 'skip') continue;
    const cached = scores.get(key);
    if (cached && !article.querySelector('.xlm-badge')) {
      attachBadge(article, cached.score, cached.sec);
    }
  }
}

/** Apply a score to every live node carrying that text key. */
function applyToKey(key) {
  const cached = scores.get(key);
  if (!cached) return;
  for (const article of document.querySelectorAll(`article[data-xlm-key="${key}"]`)) {
    attachBadge(article, cached.score, cached.sec);
  }
}

/* ---------------- queue / flush ---------------- */

function scheduleFlush(delay = QUEUE_DEBOUNCE_MS) {
  if (flushTimer || inFlight) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delay);
}

async function flush() {
  if (inFlight || queue.size === 0) return;

  const now = Date.now();
  if (now < pausedUntil) {
    scheduleFlush(pausedUntil - now);
    return;
  }

  const batch = [...queue.entries()].slice(0, BATCH_SIZE);
  for (const [key] of batch) queue.delete(key);

  const keys = batch.map(([key]) => key);
  const texts = batch.map(([, text]) => text);

  inFlight = true;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'xlm:score', texts, perItem: true });
    if (!reply || reply.error) throw new Error(reply?.error || 'no reply from background');
    if (!Array.isArray(reply.scores) || reply.scores.length !== texts.length) {
      throw new Error('score response length mismatch');
    }

    const stamp = Date.now();
    keys.forEach((key, index) => {
      const sec = Array.isArray(reply.timesSec) ? reply.timesSec[index] : undefined;
      scores.set(key, { score: reply.scores[index], sec, at: stamp });
      attempts.delete(key);
      applyToKey(key);
      scoredCount += 1;
    });

    failures = 0;
    reportStats();
    await persist(keys);
  } catch (err) {
    failures += 1;
    reportError(err);
    // Retry once, then let the key fall out of the queue — a permanently
    // failing text must not wedge every later batch behind it.
    for (const [key, text] of batch) {
      const tries = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, tries);
      if (tries < MAX_ATTEMPTS && !scores.has(key)) queue.set(key, text);
    }
    if (failures >= FAILURES_BEFORE_PAUSE) {
      pausedUntil = Date.now() + PAUSE_MS;
      failures = 0;
    }
  } finally {
    inFlight = false;
    if (queue.size) {
      const wait = Math.max(0, pausedUntil - Date.now());
      scheduleFlush(wait || QUEUE_DEBOUNCE_MS);
    }
  }
}

/* ---------------- persistence ---------------- */

function reportStats() {
  chrome.runtime.sendMessage({ type: 'xlm:stats', count: scoredCount }).catch(() => {});
}

function reportError(err) {
  console.warn('[x-lead-miner] scoring failed:', err);
  chrome.runtime
    .sendMessage({ type: 'xlm:error', message: err?.message || String(err) })
    .catch(() => {});
}

async function persist(keys) {
  const bag = {};
  for (const key of keys) {
    const cached = scores.get(key);
    if (cached) bag[STORAGE_PREFIX + key] = cached;
  }
  try {
    await chrome.storage.local.set(bag);
  } catch {
    // Quota or a torn-down worker: the in-memory copy still serves this page.
  }
  pruneOverflow();
}

/** Drop the oldest entries once the cache outgrows its cap. */
function pruneOverflow() {
  const overflow = scores.size - MAX_CACHED;
  if (overflow <= 0) return;
  const evicted = [...scores.entries()]
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, overflow)
    .map(([key]) => key);
  const bag = evicted.map((key) => STORAGE_PREFIX + key);
  for (const key of evicted) scores.delete(key);
  chrome.storage.local.remove(bag).catch(() => {});
}

async function loadCache() {
  let all = {};
  try {
    all = await chrome.storage.local.get(null);
  } catch {
    return;
  }
  const now = Date.now();
  const expired = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(STORAGE_PREFIX)) continue;
    if (!value || typeof value.score !== 'number') continue;
    if (now - (value.at ?? 0) > CACHE_TTL_MS) {
      expired.push(key);
      continue;
    }
    scores.set(key.slice(STORAGE_PREFIX.length), value);
  }
  if (expired.length) chrome.storage.local.remove(expired).catch(() => {});
}

/* ---------------- lifecycle ---------------- */

function startObserving() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.(SELECTORS.tweet) || node.querySelector?.(SELECTORS.tweet)) {
          scheduleScan();
          return;
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

let scanTimer = null;
function scheduleScan() {
  if (scanTimer) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    rescan();
  }, 150);
}

function stopAndClear() {
  observer?.disconnect();
  observer = null;
  if (flushTimer) clearTimeout(flushTimer);
  if (scanTimer) clearTimeout(scanTimer);
  flushTimer = null;
  scanTimer = null;
  queue.clear();
  for (const badge of document.querySelectorAll('.xlm-badge')) badge.remove();
  for (const article of document.querySelectorAll('[data-xlm-key]')) delete article.dataset.xlmKey;
}

async function boot() {
  const { enabled } = await chrome.storage.sync.get({ enabled: true });
  if (!enabled) return;
  await loadCache();
  rescan();
  startObserving();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes.enabled) return;
  if (changes.enabled.newValue) void boot();
  else stopAndClear();
});

boot().catch((err) => console.warn('[x-lead-miner] boot failed:', err));
