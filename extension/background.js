/**
 * X Lead Miner — background service worker.
 *
 * This is the extension's only network egress on purpose. x.com's origin
 * cannot reach /api/leads/score with fetch(): the route sends no CORS headers,
 * so the preflight dies. A service worker request is different — it is issued
 * from the extension origin, and the host_permissions entry in the manifest
 * exempts it from CORS entirely (verified against Chrome's MV3 rules). The
 * content script therefore never fetches; it only postMessages us texts.
 */

const DEFAULT_ENDPOINT = 'https://x-lead-miner.ideaguard.dev/api/leads/score';
const TIMEOUT_MS = 30_000;

/** Resolve the endpoint from sync storage (popup can override it for previews). */
async function resolveEndpoint() {
  const { endpoint } = await chrome.storage.sync.get({ endpoint: DEFAULT_ENDPOINT });
  return (endpoint || DEFAULT_ENDPOINT).trim();
}

/** POST a batch of texts and return { scores, timesSec, elapsedSec }.
 *  Throws on any non-2xx so the content script can back off. */
async function scoreBatch(texts) {
  const url = await resolveEndpoint();
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts, perItem: true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`cannot reach ${new URL(url).host} (${err?.name || 'network error'})`);
  }

  // Workers AI hiccups surface as 5xx with an in-body reason; read it before
  // deciding whether the batch is retryable.
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      (typeof data?.error === 'string' && data.error) ||
      (typeof data?.nativeError === 'string' && data.nativeError) ||
      `HTTP ${response.status}`;
    throw new Error(detail);
  }
  if (!Array.isArray(data?.scores) || data.scores.length !== texts.length) {
    throw new Error('score response missing or malformed');
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'xlm:score': {
      scoreBatch(message.texts)
        .then((data) => {
          chrome.storage.session.remove('lastError').catch(() => {});
          sendResponse({
            scores: data.scores,
            timesSec: data.timesSec,
            elapsedSec: data.elapsedSec,
          });
        })
        .catch((err) => sendResponse({ error: err?.message || String(err) }));
      return true; // keep the channel open for the async reply
    }

    case 'xlm:stats': {
      const count = Number(message.count) || 0;
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' }).catch(() => {});
      chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' }).catch(() => {});
      chrome.storage.session.set({ scoredCount: count }).catch(() => {});
      return false;
    }

    case 'xlm:error': {
      chrome.storage.session
        .set({ lastError: { message: String(message.message ?? 'unknown error'), at: Date.now() } })
        .catch(() => {});
      return false;
    }

    default:
      return false;
  }
});
