# The Lead Analyst — the second model on this site

Two models read a post here, and they are kept apart on purpose.

| | Intent scorer | Lead Analyst |
| --- | --- | --- |
| what | bge-base-en-v1.5 embedding (Workers AI) + a 49,281-parameter head | Qwen3-4B-Instruct-2507 + a LoRA adapter (rank 16) |
| where it runs | inside the Cloudflare Worker | on Modal, started on demand |
| output | one 0–1 buying-intent score | a lead card: intent type, buying stage, domain, quoted evidence, reason, reply direction |
| speed | about 0.2 s per post | about 6 s per post once started; a batch costs about the same |
| called by | search results, the landing page, the browser extension | search results (score ≥ 0.7), the "Lead card" button, the Intent Lab playground |
| code | `src/lib/intent.ts`, `/api/leads/score` | `src/lib/analyst.ts`, `/api/leads/analyze` |

The scorer stays the first stage: cheap enough to read every post. The analyst
only sees posts that pass, because each call runs a GPU model.

## Requesting a card

```
POST /api/leads/analyze   { "texts": ["...", ...] }        1–10 posts, ≤ 8,000 chars each
                         -> { results: [{ status: "ok"|"reject", attempt, card }], timesSec, elapsedSec }
```

- `card` has seven keys: `intent_type`, `buy_stage`, `domain`, `evidence`
  (verbatim substrings of the post), `rationale`, `reply_angle` (or `null`) and
  `score`. `reply_angle` is a direction to reply from, not a message to send.
- Status codes: `400` invalid request · `429` per-IP limit (`code: "rate"`) or
  the endpoint's GPU budget for the day (`code: "budget"`) · `503` not
  configured or not reachable · `502` the model errored · `504` timeout.
- The route is rate limited to 30 requests per hour per IP (in memory, per
  Worker isolate — the same limiter shape as the search route).

## Configuration

Three Worker secrets, all optional. Unset, the site offers no lead cards and
everything else works exactly as before.

| secret | value |
| --- | --- |
| `ANALYST_URL` | the deployed endpoint, e.g. `https://<workspace>--xlead-analyst-serve-serve.us-east.modal.run` |
| `MODAL_KEY` / `MODAL_SECRET` | a Modal **proxy token** (`modal workspace proxy-tokens create`) |

In production they are read from the GitHub repository's `dev` environment by
`.github/workflows/deploy.yml`. For local development put them in `.dev.vars`
(`pnpm dev:edge`) or `.env` (`pnpm dev`).

The endpoint is deployed from the model repository with
`modal deploy analyst/serve_api.py`; `analyst/serve_api.py` there documents
the knobs (GPU, idle window, daily GPU budget).

## What it costs, and what keeps it bounded

Measured on 2026-11-25 on a Modal A10G ($0.000306 per second):

- **Nothing runs while nobody asks.** The container starts on the first
  request and goes away 5 minutes after the last one.
- **Starting takes time.** 60–67 s on two boots, 445 s on a third where the
  machine downloaded and loaded the model slowly. The UI says the model is
  being started; a request that outlives the route's 150 s timeout returns
  `504`, and a retry usually lands on a container that is already up.
- **One container at most.** A burst cannot start a fleet of cold boots.
- **A hard ceiling per UTC day** in GPU seconds (3,000 by default, about
  $0.92), counted in a place that survives restarts, so repeated cold starts
  cannot reset it. Past it the endpoint answers `429` until the next UTC day.
- Warm, a page of ten cards costs about $0.002 of GPU time. A single isolated
  visit costs roughly the start-up plus up to five idle minutes: $0.10–0.25.

## Known limits

- **Not perfectly repeatable.** The same post can occasionally get a different
  intent type from one call to the next (98.7–100% agreement between runs on
  149 posts). Requests are batched by arrival time, which perturbs floating
  point results; posts where two labels are nearly tied can flip.
- **Accuracy is measured against one person's labels.** On the 150-post gold
  set the analyst's intent type agrees with the owner's verdict on about 83% of
  posts — the same as the teacher model it was distilled from.
- **Posts over 8,000 characters are refused**, as they are by `/api/leads/score`.
- **The model is not running until asked.** Do not wire this route into
  anything that fires on page load.
