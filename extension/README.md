# X Lead Miner — browser extension

Scores every tweet you see on x.com for buying intent and pins the score next
to its timestamp. It bypasses the site's search pipeline entirely.

## Why it exists

The site's search depends on a third-party X data API, and that API can go
down. The scoring path, however, is independent: frozen sentence embeddings
plus a locally-trained MLP head, served by Workers AI. The extension reads
tweets straight from the page DOM and only ever calls `POST /api/leads/score`,
so it keeps working when search cannot.

## Install

Chrome / Edge. No build step, no dependencies:

1. Open `chrome://extensions` (Edge: `edge://extensions`)
2. Enable **Developer mode**
3. **Load unpacked** and select this `extension/` directory
4. Open `https://x.com/home` or any search page — badges appear as you scroll

## How it works

```
x.com page
  └─ content.js   read DOM → extract text → dedupe by text hash → queue
         │ chrome.runtime.sendMessage
         ▼
  background.js   the only network egress: POST /api/leads/score (≤20 texts/batch)
         │
         ▼
  Workers AI      bge-base-en-v1.5 (CLS pooling) + MLP head → 0–1
```

Requests are sent from the background service worker on purpose: the score
endpoint sends no CORS headers, so a content-script fetch from the x.com
origin would fail its preflight. A service-worker request with
`host_permissions` is exempt from CORS.

## Reading the scores

| tier | range | color |
| --- | --- | --- |
| high intent | `score ≥ 80` | green |
| mid intent | `60–79` | amber |
| watchlist | `< 60` | gray |

Thresholds match the site (`src/lib/intent.ts` tiering, `messages/*.json`
labels). Hover a badge for the raw score and the per-post inference time.

## Cost controls

The endpoint is unauthenticated and unthrottled, and every tweet costs one
Workers AI call — so the extension converges on three layers:

- **Text-hash dedupe** — a tweet (including retweets/quotes) is scored once
- **Two-tier cache** — in memory + `chrome.storage.local`, 24h TTL, capped at
  5,000 entries; reloads and revisits never re-score
- **Batching** — at most 20 texts per request, one in-flight request at a time

## Troubleshooting

- **No badges at all** — check the popup's "last error". `cannot reach …`
  means the endpoint is unreachable; `Intent model sidecar unavailable` means
  the Workers AI path is down (the site would be equally affected).
- **Badges disappeared after an X redesign** — every selector lives in the
  `SELECTORS` constant at the top of `content.js`. Locate the new markup from
  the x.com console (e.g. `$$('article[data-testid="tweet"]')`) and fix it
  there.
- **Custom endpoint** (local `wrangler dev`, a preview deploy) — set it in the
  popup; saving requests access to that origin at runtime.

## Debugging

`chrome://extensions` → this extension → *service worker* opens the
background console (one request per batch). Content-script logs land in the
page console, prefixed `[x-lead-miner]`.
