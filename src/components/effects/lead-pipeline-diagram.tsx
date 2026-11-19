'use client';

/**
 * LeadPipelineDiagram — the landing-page pipeline animation.
 *
 * Layout: a dashed frame on the left holds the search input (top) and the
 * lead pool (bottom); the intent model sits centered between the frame and
 * the three score-tier bins on the right.
 *
 * Data story (continuous, no leaks):
 *   1. The input types a query (typewriter, no blinking caret), then shows
 *      "N 条命中".
 *   2. The N retrieved posts drop INTO the pool and stay — the pool visibly
 *      grows (slots are assigned in order; recycled oldest-first when full).
 *   3. The model continuously consumes from the mining queue at ~5 posts/s:
 *      each consumed post slides along an inlet lane into the model, then
 *      exits linearly toward its score-tier bin and docks (+1 count).
 *   4. The next query starts typing the moment intake finishes — the miner
 *      never idles.
 *
 * The docked leads are REAL scored posts (`leads`, cached server-side in
 * lib/intent.ts). Every particle maps to one post; bin counts start at the
 * fetched distribution and grow on every dock.
 *
 * Engineering: zero deps; state = f(t, seed) pure; SSR static frame;
 * rAF only when motion is allowed; imperative per-frame writes; React
 * state only on dock events. Colors are theme tokens; text ≥17px SVG.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ScoredLead } from '@/lib/intent';

export interface PipelineLabels {
  input: string;
  hitSuffix: string;
  model: string;
  modelSub: string;
  queue: string;
  binHigh: string;
  binMid: string;
  binLow: string;
  binCountSuffix: string;
  statScored: string;
  statQualified: string;
  scoringHint: string;
  emptyBin: string;
  sampleNote: string;
  aria: string;
}

/* ---------------- deterministic helpers ---------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pt {
  x: number;
  y: number;
}
interface Seg {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
}

function segAt(s: Seg, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * s.p0.x + 3 * u * u * t * s.p1.x + 3 * u * t * t * s.p2.x + t * t * t * s.p3.x,
    y: u * u * u * s.p0.y + 3 * u * u * t * s.p1.y + 3 * u * t * t * s.p2.y + t * t * t * s.p3.y,
  };
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/* ---------------- geometry (viewBox 1440x400) ---------------- */

/* left module: dashed frame holds the input (top) and the pool (bottom).
 * Left and right modules share the same width; the three modules sit
 * horizontally symmetric in the 1440-wide viewBox (40px margins). */
const FRAME_RECT = { x: 40, y: 56, w: 400, h: 340 };
const INPUT_RECT = { x: 60, y: 76, w: 360, h: 60 };
const POOL_RECT = { x: 60, y: 176, w: 360, h: 192 };
const MODEL_RECT = { x: 625, y: 150, w: 190, h: 100 }; // centered between the modules
const BIN_X = 1000;
const BIN_W = 400;
const BIN_H = 96;
const BIN_TOP = 56;
const BIN_GAP = 12;
const VIEW_W = 1440;

/* input → pool connector (drawn line the intake drops follow) */
const CONNECTOR = { x: 240, y0: 136, y1: 176 };

/* eight inlet lines leaving the LEFT MODULE's edge into the model — the
 * lines must not poke out of the pool box (product decision 2026-11-16) */
const IN_LINES: Seg[] = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  p0: { x: 440, y: 110 + i * 31.5 },
  p1: { x: 510, y: 110 + i * 31.5 },
  p2: { x: 575, y: 168 + i * 9.2 },
  p3: { x: 625, y: 168 + i * 9.2 },
}));
/* model → tier bins, constant linear speed */
const OUT_LANES: Seg[] = [
  { p0: { x: 815, y: 182 }, p1: { x: 880, y: 165 }, p2: { x: 950, y: 135 }, p3: { x: 996, y: 108 } },
  { p0: { x: 815, y: 200 }, p1: { x: 880, y: 200 }, p2: { x: 950, y: 208 }, p3: { x: 996, y: 214 } },
  { p0: { x: 815, y: 218 }, p1: { x: 880, y: 235 }, p2: { x: 950, y: 285 }, p3: { x: 996, y: 318 } },
];
/* retrieved posts fall from the input box along the connector into the pool */
const INTAKE_FROM: Pt = { x: CONNECTOR.x, y: CONNECTOR.y0 };

/* ---------------- timing ---------------- */

const TYPE_CHAR_S = 0.03; // s per typed character
const HIT_HOLD = 0.45; // s the "N hits" line holds before the next query types
const INTAKE_INTERVAL = 0.04; // s between leads falling into the pool (~25/s)
const INTAKE_DURATION = 0.22; // s to fall into the pool
const CYCLE_TAIL = 0.25; // s of quiet before the next query starts typing
// consumed faster than any intake rate — the model is never the bottleneck
// (effect design rule: particles are created freely, no capacity gates)
const TRANSIT_DURATION = 0.25; // s pool-dot → model (eased)
const FLY_DURATION = 0.4; // s model → bin
const POOL_SLOTS = 60; // visual buffer dots; recycled oldest-first when full
const POOL_PREFILL = 8; // dots shown before the first retrieval lands
const DOT_LIFETIME = 1.4; // s a pool dot stays before it flows away into the model

/* ── COUNTER SPEED — numbers ride the particles: each dot carries a burst
   of posts (see rollBurst); at ~25 dots/s the stats race at ~250/s ── */
const HIT_RADIUS = 14;

const laneOf = (score: number) => (score >= 80 ? 0 : score >= 60 ? 1 : 2);

/** Overall dock ratio 1:3:6 (strong:mid:low) — directed animation ratio set
 *  with the product owner; deliberately NOT the model's live distribution. */
const TIER_RATIO = [0.1, 0.3, 0.6];

/** Real search operators used by the app — no quotes on purpose. */
const QUERIES = [
  'anyone recommend',
  'I wish there was',
  'alternative to',
  'looking for a tool',
  'anyone know an app',
  'worth paying for',
  'is there a tool that',
  'recommend me a',
  'switching from',
  'hate how slow',
];

const NOISE_SAMPLES = [
  'just watched the new Dune movie, cinematography was insane',
  'happy monday everyone! coffee first, then grind',
  'can anyone recommend me some cool youtubers to watch?',
  'my feed is full of slop lately, not gonna lie',
  'gm to everyone who says gm back',
];

interface BinState {
  counts: [number, number, number];
  latest: (ScoredLead | null)[];
  seq: [number, number, number];
}

function initBins(leads: ScoredLead[]): BinState {
  // Open mid-stream: the miner has "already been running", so the tier
  // boxes start seeded with the real score distribution of the fetched
  // leads (and the stats agree with the boxes from frame one).
  const counts: [number, number, number] = [0, 0, 0];
  const latest: (ScoredLead | null)[] = [null, null, null];
  for (const l of leads) {
    counts[laneOf(l.score)] += 1;
    const lane = laneOf(l.score);
    if (!latest[lane]) latest[lane] = l;
  }
  return { counts, latest, seq: [-1, -2, -3] };
}

type HoverTarget =
  | { kind: 'pool'; index: number }
  | { kind: 'fly'; key: number }
  | { kind: 'bin'; index: number }
  | { kind: 'model' };

/** live fly particle mirrored for event handlers (hit-test + tooltip) */
interface FlyLive {
  key: number;
  leadIdx: number;
  x: number;
  y: number;
}

/** Hover/pin selection: the lead payload is resolved in the event handler
 *  (refs must not be read during render — react-hooks/refs). */
interface Selection {
  target: HoverTarget;
  lead: ScoredLead | null;
}

/* ---------------- component ---------------- */

export function LeadPipelineDiagram({
  labels,
  leads,
  live,
}: {
  labels: PipelineLabels;
  leads: ScoredLead[];
  /** false when leads are the built-in samples — disclosed on the page. */
  live: boolean;
}) {
  const BIN_LABELS = [labels.binHigh, labels.binMid, labels.binLow];
  const [bins, setBins] = useState<BinState>(() => initBins(leads));
  const flowRefs = useRef<(SVGCircleElement | null)[]>([]);
  const intakeRefs = useRef<(SVGCircleElement | null)[]>([]);
  const transitLayerRef = useRef<SVGGElement | null>(null);
  const flyLayerRef = useRef<SVGGElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const poolCountRef = useRef<HTMLSpanElement | null>(null);
  const binnedRef = useRef<HTMLSpanElement | null>(null);
  const binCountRefs = useRef<(SVGTSpanElement | null)[]>([null, null, null]);
  /** live counters — advanced in bursts carried by the visible particles */
  const counters = useRef<{ pooled: number; binned: number; lanes: [number, number, number] } | null>(null);
  const inputTextRef = useRef<SVGTSpanElement | null>(null);
  const hitCountRef = useRef<SVGTSpanElement | null>(null);
  const hitTextRef = useRef<SVGTextElement | null>(null);
  /** cumulative pooled-lead stat, written imperatively from the rAF loop */
  /** cumulative FRESH-signal docks (recycled re-surfacing doesn't double-count) */
  /** last-frame positions for hit-testing (svg units) */
  const hitPos = useRef<{ pool: Pt[]; fly: Pt[] }>({ pool: [], fly: [] });
  /** live fly particles bridged for event handlers (hit-test + tooltip) */
  const fliesLiveRef = useRef<{ key: number; leadIdx: number; x: number; y: number }[]>([]);
  /** which real lead each pool slot currently shows (for tooltips) */
  const poolSlotLead = useRef<(ScoredLead | null)[]>(Array(POOL_SLOTS).fill(null));

  const [hover, setHover] = useState<Selection | null>(null);
  const [pinned, setPinned] = useState<Selection | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null);

  const total = leads.length;

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let running = false;
    let visible = true;
    let last = 0;
    let elapsed = 0;
    let cycleStart = 0;
    let queryIdx = 0;
    let intakeCursor = 0; // rotating pointer into `leads`
    let intakeClock = 0; // accumulates real time for framerate-independent intake
    const intakes: { slot: number; born: number; leadIdx: number; intakeSlot: number }[] = [];
    let arrivalSlot = POOL_PREFILL; // next virgin pool slot (dots grow 8 → 60)
    const freeSlots: number[] = []; // slots released by expired dots, LIFO
    /** Take a free slot if one exists, otherwise claim the next virgin one. */
    const takeSlot = () => {
      if (freeSlots.length > 0) return freeSlots.pop() as number;
      const slot = arrivalSlot % POOL_SLOTS;
      arrivalSlot += 1;
      return slot;
    };
    const slotBornAt: (number | undefined)[] = [];
    // Animation balance: track when each bin last docked; the ambient feeder
    // serves the least-recently-fed lane so no bin sits static for long.
    const lastDockAt: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    // Funnel stat: counts high/mid docks only (the qualified tiers) — the
    // watchlist tier is the noise the funnel filters out. Starts seeded at
    // the 1:3:6 initial split, grows at 40% of the pooled rate → pooled
    // leads binned, always.
    let rngState = 20261116;
    const rand = () => {
      rngState = (rngState * 1103515245 + 12345) % 2147483648;
      return rngState / 2147483648;
    };
    // Deterministic 1:3:6 — a shuffled 10-dock window guarantees the exact
    // ratio every window; per-dock weighted random drifted off-ratio.
    let ratioQueue: number[] = [];
    const nextRatioLane = () => {
      if (ratioQueue.length === 0) {
        ratioQueue = [0, 1, 1, 1, 2, 2, 2, 2, 2, 2];
        for (let i = ratioQueue.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [ratioQueue[i], ratioQueue[j]] = [ratioQueue[j], ratioQueue[i]];
        }
      }
      return ratioQueue.pop() as number;
    };
    // decorative per-cycle hit count — random each query so it reads alive
    let cycleHits = 45 + Math.floor(rand() * 45);
    let intakeBudget = cycleHits; // hits stream into the pool at intake pace
    const transits: { key: number; el: SVGGElement; born: number; from: Pt; lane: number; lineIdx: number; leadIdx: number; fresh: boolean; amount: number }[] = [];
    const flies: { key: number; el: SVGGElement; born: number; lane: number; leadIdx: number; fresh: boolean; amount: number; live: FlyLive }[] = [];
    let lastLineIdx = -1; // no immediate repeat — keeps the flow organic
    let particleKey = 0;
    /** Transit particles are created freely — the effect never throttles,
     *  drops or queues a signal, whatever the data volume. */
    const spawnTransit = (from: Pt, lane: number, leadIdx: number, fresh: boolean, amount: number) => {
      // uniform random line, never the same twice in a row: every line keeps
      // ~12.5% of the flow (no starvation) without a visible top-to-bottom
      // round-robin march
      let lineIdx = Math.floor(rand() * IN_LINES.length);
      if (lineIdx === lastLineIdx) lineIdx = (lineIdx + 1) % IN_LINES.length;
      lastLineIdx = lineIdx;
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      el.setAttribute('opacity', '0');
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('r', '4.5');
      c.style.fill = 'var(--text-subtle)';
      el.appendChild(c);
      transitLayerRef.current?.appendChild(el);
      transits.push({ key: particleKey, el, born: elapsed, from, lane, lineIdx, leadIdx, fresh, amount });
      particleKey += 1;
    };
    const spawnFly = (lane: number, leadIdx: number, fresh: boolean, amount: number) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      halo.setAttribute('r', '10');
      halo.style.fill = 'var(--accent)';
      halo.style.opacity = '0.25';
      const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      core.setAttribute('r', '5');
      core.style.fill = 'var(--accent)';
      el.appendChild(halo);
      el.appendChild(core);
      flyLayerRef.current?.appendChild(el);
      const live: FlyLive = {
        key: particleKey,
        leadIdx,
        x: OUT_LANES[lane].p0.x,
        y: OUT_LANES[lane].p0.y,
      };
      flies.push({ key: particleKey, el, born: elapsed, lane, leadIdx, fresh, amount, live });
      fliesLiveRef.current.push(live);
      particleKey += 1;
    };
    if (!counters.current) {
      counters.current = {
        pooled: leads.length,
        binned: leads.length,
        lanes: [...bins.counts] as [number, number, number],
      };
    }
    const C = counters.current;
    hitPos.current.pool = Array.from({ length: POOL_SLOTS }, () => ({ x: -999, y: -999 }));
    /** posts represented by one visible dot — irregular so the stats
     *  breathe instead of ticking like a stopwatch */
    const rollBurst = (): number => {
      const base = 5 + Math.floor(rand() * 8); // 5–12
      return rand() < 0.15 ? base * 2 : base; // occasional big cluster
    };
    const slotBurst: number[] = Array(POOL_SLOTS).fill(0);
    for (let i = 0; i < Math.min(POOL_PREFILL, leads.length); i++) {
      const slot = takeSlot();
      poolSlotLead.current[slot] = leads[i]; // pre-filled dots carry real posts
      slotBurst[slot] = rollBurst();
      // staggered births IN THE PAST: the first dot flows to the model at
      // ~0.3s, then one every 0.3s — the stream is alive from frame one
      slotBornAt[slot] = 0.3 * (i + 1) - DOT_LIFETIME;
    }

    /* pool slot positions — fixed per slot, scattered across the rect */
    const slotPos: Pt[] = Array.from({ length: POOL_SLOTS }, (_, s) => {
      const rng = mulberry32(s * 613 + 7);
      return {
        x: POOL_RECT.x + 20 + rng() * (POOL_RECT.w - 40),
        y: POOL_RECT.y + 26 + rng() * (POOL_RECT.h - 52),
      };
    });

    const tick = (now: number) => {
      try {
      if (!last) last = now;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      elapsed += dt;

      const q = QUERIES[queryIdx % QUERIES.length];
      const typeDur = q.length * TYPE_CHAR_S;
      const hitAt = typeDur;
      const hitEnd = hitAt + HIT_HOLD;
      const cycleEnd = hitEnd + CYCLE_TAIL; // next query types right away —
      // intake keeps streaming into the pool in the background
      const ct = elapsed - cycleStart;

      // 0) write the burst-carried counters to the DOM (bursts land where
      // the particles are — the numbers move WITH the picture, not on a timer)
      if (poolCountRef.current) poolCountRef.current.textContent = String(C.pooled);
      if (binnedRef.current) binnedRef.current.textContent = String(C.binned);
      for (let i = 0; i < 3; i++) {
        const el = binCountRefs.current[i];
        if (el) el.textContent = String(C.lanes[i]);
      }

      // 1) typewriter input — steady text, caret transparent (per design)
      if (inputTextRef.current) {
        const typed = q.slice(0, Math.max(0, Math.min(q.length, Math.floor(ct / TYPE_CHAR_S))));
        inputTextRef.current.textContent = typed;
      }
      if (hitCountRef.current) {
        hitCountRef.current.textContent = String(cycleHits);
      }
      // hit counter line — visible while the current query is being typed
      if (hitTextRef.current) {
        hitTextRef.current.setAttribute('opacity', ct >= hitAt && ct <= hitEnd ? '1' : '0');
      }

      // 2) intake — budget-driven so the rate is framerate-independent:
      // one dot per INTAKE_INTERVAL of real time, capped per frame
      intakeClock += dt;
      let guard = 0;
      while (
        intakeBudget > 0 &&
        intakeClock >= INTAKE_INTERVAL &&
        guard < 8
      ) {
        intakeClock -= INTAKE_INTERVAL;
        const intakeSlot = [0, 1, 2, 3, 4, 5].find(
          (s) => !intakes.some((t) => t.intakeSlot === s)
        );
        if (intakeSlot === undefined) break; // all 6 lanes busy — next frame
        guard += 1;
        intakeBudget -= 1;
        const slot = takeSlot();
        intakes.push({
          slot,
          born: elapsed,
          leadIdx: intakeCursor % leads.length,
          intakeSlot,
        });
        intakeCursor += 1;
      }
      for (let k = intakes.length - 1; k >= 0; k--) {
        const it = intakes[k];
        const p = Math.min(1, (elapsed - it.born) / INTAKE_DURATION);
        const el = intakeRefs.current[it.intakeSlot];
        if (el) {
          const pos = lerp(INTAKE_FROM, slotPos[it.slot], p);
          el.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
          el.setAttribute('opacity', p < 1 ? '0.9' : '0');
        }
        if (p >= 1) {
          intakes.splice(k, 1);
          if (el) el.setAttribute('opacity', '0');
          poolSlotLead.current[it.slot] = leads[it.leadIdx];
          slotBornAt[it.slot] = elapsed;
          slotBurst[it.slot] = rollBurst();
          C.pooled += slotBurst[it.slot];
        }
      }

      // 3) pool dots — wobble inside the pool rect; every signal has a
      // lifetime (pop in → live → fade out) so the pool visibly churns.
      for (let s = 0; s < POOL_SLOTS; s++) {
        const el = flowRefs.current[s];
        if (!el) continue;
        const lead = poolSlotLead.current[s];
        if (!lead) {
          el.setAttribute('opacity', '0');
          hitPos.current.pool[s] = { x: -999, y: -999 };
          continue;
        }
        const born = slotBornAt[s] ?? elapsed;
        const age = elapsed - born;
        const remain = DOT_LIFETIME - age;
        if (remain <= 0) {
          // Lifetime over — the signal FLOWS away along an inlet line into
          // the model (it must never fade in place). Particles are spawned
          // freely; nothing throttles or drops it.
          spawnTransit(hitPos.current.pool[s], nextRatioLane(), leads.indexOf(lead), false, slotBurst[s]);
          poolSlotLead.current[s] = null;
          slotBornAt[s] = undefined;
          freeSlots.push(s);
          el.setAttribute('opacity', '0');
          hitPos.current.pool[s] = { x: -999, y: -999 };
          continue;
        }
        const rng = mulberry32(s * 613 + 7);
        const w1 = 0.25 + rng() * 0.5;
        const w2 = 0.2 + rng() * 0.45;
        const amp = 4 + rng() * 6;
        const p1 = rng() * Math.PI * 2;
        const x = Math.min(POOL_RECT.x + POOL_RECT.w - 14, Math.max(POOL_RECT.x + 14, slotPos[s].x + Math.cos(elapsed * w1 + p1) * amp));
        const y = Math.min(POOL_RECT.y + POOL_RECT.h - 14, Math.max(POOL_RECT.y + 14, slotPos[s].y + Math.sin(elapsed * w2 + p1 * 1.7) * amp));
        const grow = Math.min(1, age / 0.35); // pop-in ramp
        // No shrink/fade in place: an expired signal waits at FULL size until
        // a transit slot frees, then visibly flows away into the model.
        el.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(0.3 + 0.7 * grow).toFixed(2)})`);
        el.setAttribute('opacity', (0.55 * grow).toFixed(2));
        hitPos.current.pool[s] = { x, y };
      }

      for (let k = transits.length - 1; k >= 0; k--) {
        const tr = transits[k];
        const p = Math.min(1, (elapsed - tr.born) / TRANSIT_DURATION);
        const line = IN_LINES[tr.lineIdx];
        // Travel the drawn line: a short eased approach onto the line start,
        // then exactly along the drawn bezier into the model inlet.
        const pos =
          p < 0.4
            ? lerp(tr.from, line.p0, easeInOutQuad(p / 0.4))
            : segAt(line, easeInOutQuad((p - 0.4) / 0.6));
        tr.el.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
        tr.el.setAttribute('opacity', '0.85');
        if (p >= 1) {
          transits.splice(k, 1);
          tr.el.remove();
          spawnFly(tr.lane, tr.leadIdx, tr.fresh, tr.amount);
        }
      }

      // 5) exit flies — linear speed toward the tier bins
      for (let k = flies.length - 1; k >= 0; k--) {
        const fly = flies[k];
        const p = Math.min(1, (elapsed - fly.born) / FLY_DURATION);
        const lead = leads[fly.leadIdx];
        const pos = segAt(OUT_LANES[fly.lane], p);
        fly.el.setAttribute('transform', `translate(${pos.x.toFixed(1)} ${pos.y.toFixed(1)})`);
        fly.el.setAttribute('opacity', p < 0.94 ? '1' : ((1 - p) / 0.06).toFixed(2));
        fly.live.x = pos.x;
        fly.live.y = pos.y;
        if (p >= 1) {
          flies.splice(k, 1);
          fly.el.remove();
          const liveIdx = fliesLiveRef.current.findIndex((f) => f.key === fly.key);
          if (liveIdx >= 0) fliesLiveRef.current.splice(liveIdx, 1);
          const lane = fly.lane;
          lastDockAt[lane] = elapsed;
          C.binned += fly.amount;
          C.lanes[lane] += fly.amount;
          // the fly also swaps the tier's example card
          setBins((prev) => {
            const latest = [...prev.latest];
            latest[lane] = lead;
            const seq: [number, number, number] = [...prev.seq];
            seq[lane] = prev.seq[lane] + 1;
            return { ...prev, latest, seq };
          });
        }
      }

      // 6) continuous mining — next query starts typing right away
      if (ct >= cycleEnd) {
        cycleStart = elapsed;
        queryIdx += 1;
        cycleHits = 45 + Math.floor(rand() * 45); // new random hit count per query
        intakeBudget += cycleHits; // streams in behind the previous cycle
      }

      if (running) raf = requestAnimationFrame(tick);
      } catch (err) {
        console.error('[lead-pipeline] tick error:', err);
        running = false;
      }
    };

    const start = () => {
      if (running || !visible) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        start();
      } else {
        stop();
      }
    });
    io.observe(document.getElementById('lead-pipeline') ?? document.body);
    start();

    return () => {
      stop();
      io.disconnect();
    };
  }, [leads, total]);

  /* ---------------- hit testing ---------------- */

  const toSvgPoint = useCallback((clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W,
      y: ((clientY - rect.top) / rect.height) * 400,
    };
  }, []);

  const findTarget = useCallback((svgX: number, svgY: number): HoverTarget | null => {
    const m = MODEL_RECT;
    if (svgX >= m.x && svgX <= m.x + m.w && svgY >= m.y && svgY <= m.y + m.h) {
      return { kind: 'model' };
    }
    for (let b = 0; b < 3; b++) {
      const by = BIN_TOP + b * (BIN_H + BIN_GAP);
      if (svgX >= BIN_X && svgX <= BIN_X + BIN_W && svgY >= by && svgY <= by + BIN_H) {
        return { kind: 'bin', index: b };
      }
    }
    for (const f of fliesLiveRef.current) {
      if (Math.hypot(f.x - svgX, f.y - svgY) <= HIT_RADIUS) {
        return { kind: 'fly', key: f.key };
      }
    }
    let best = -1;
    let bestDist = HIT_RADIUS;
    for (let i = 0; i < hitPos.current.pool.length; i++) {
      const f = hitPos.current.pool[i];
      const d = Math.hypot(f.x - svgX, f.y - svgY);
      if (d <= bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best >= 0 ? { kind: 'pool', index: best } : null;
  }, []);

  /** Resolve the lead behind a target. Event handlers only — reads refs. */
  const resolveLead = useCallback(
    (target: HoverTarget | null): ScoredLead | null => {
      if (!target) return null;
      if (target.kind === 'fly') {
        const entry = fliesLiveRef.current.find((f) => f.key === target.key);
        return entry ? leads[entry.leadIdx] : null;
      }
      if (target.kind === 'pool') {
        return poolSlotLead.current[target.index] ?? null;
      }
      return null;
    },
    [leads]
  );

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svgPt = toSvgPoint(e.clientX, e.clientY);
      if (!svgPt) return;
      const target = findTarget(svgPt.x, svgPt.y);
      setHover(target ? { target, lead: resolveLead(target) } : null);
      setTip({ x: svgPt.x, y: svgPt.y });
      e.currentTarget.style.cursor = target ? 'pointer' : 'default';
    },
    [findTarget, resolveLead, toSvgPoint]
  );

  const active = pinned ?? hover;

  /* ---------------- tooltip ---------------- */

  const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const renderTooltip = () => {
    if (!active) return null;
    if (active.target.kind === 'model') {
      return (
        <div className="pipeline-tip">
          <div className="font-semibold">{labels.model}</div>
          <div className="text-text-muted">{labels.modelSub}</div>
        </div>
      );
    }
    if (active.target.kind === 'fly') {
      const s = active.lead;
      if (!s) return null;
      return (
        <div className="pipeline-tip">
          <div className="font-semibold">{s.handle}</div>
          <div className="text-text-muted">{truncate(s.text, 60)}</div>
        </div>
      );
    }
    if (active.target.kind === 'bin') {
      const lane = active.target.index;
      return (
        <div className="pipeline-tip">
          <div className="font-semibold">{[labels.binHigh, labels.binMid, labels.binLow][lane]}</div>
          <div className="text-text-muted">
            {bins.latest[lane]
              ? `${bins.latest[lane]!.handle} · ${bins.counts[lane]} ${labels.binCountSuffix}`
              : labels.emptyBin}
          </div>
        </div>
      );
    }
    const s = active.lead;
    return (
      <div className="pipeline-tip">
        {s ? (
          <>
            <div className="font-semibold">{s.handle}</div>
            <div className="text-text-muted">{truncate(s.text, 60)}</div>
          </>
        ) : (
          <div className="text-text-muted">
            {NOISE_SAMPLES[active.target.index % NOISE_SAMPLES.length]}
          </div>
        )}
        <div className="mt-1 text-[13px] font-medium" style={{ color: 'var(--accent)' }}>
          {labels.scoringHint.replace(
            '@query',
            active.lead?.sourceQuery || inputTextRef.current?.textContent || QUERIES[0]
          )}
        </div>
      </div>
    );
  };

  /* static SSR frame (t = 0): first query typed, pool pre-filled, real bins */
  const poolDots = Array.from({ length: POOL_SLOTS }, (_, s) => {
    const rng = mulberry32(s * 613 + 7);
    return {
      x: POOL_RECT.x + 20 + rng() * (POOL_RECT.w - 40),
      y: POOL_RECT.y + 26 + rng() * (POOL_RECT.h - 52),
      visible: s < POOL_PREFILL,
    };
  });

  return (
    <div>
      {/* The viewBox is 1440 units wide; scaling it down to a phone would
          render SVG text at ~4px, so narrow viewports scroll instead. */}
      <div className="overflow-x-auto">
        <div id="lead-pipeline" className="relative min-w-[900px]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_W} 400`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={labels.aria}
        onMouseMove={handleMove}
        onMouseLeave={() => {
          setHover(null);
          setTip(null);
        }}
        onClick={(e) => {
          const svgPt = toSvgPoint(e.clientX, e.clientY);
          if (!svgPt) return;
          const target = findTarget(svgPt.x, svgPt.y);
          if (target) {
            setPinned({ target, lead: resolveLead(target) });
            setTip(svgPt);
          } else {
            setPinned(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setPinned(null);
        }}
        tabIndex={0}
      >
        {/* left module frame: input + pool together */}
        <rect
          x={FRAME_RECT.x}
          y={FRAME_RECT.y}
          width={FRAME_RECT.w}
          height={FRAME_RECT.h}
          rx={18}
          style={{ fill: 'var(--surface-2)', stroke: 'var(--border)' }}
          strokeDasharray="6 7"
        />
        {/* module header — outside the frame, mirroring the bins header */}
        <text x={FRAME_RECT.x + FRAME_RECT.w / 2} y={44} textAnchor="middle" fontSize={20} fontWeight={600} style={{ fill: 'var(--text-muted)' }}>
          {labels.input}
        </text>
        <rect
          x={INPUT_RECT.x}
          y={INPUT_RECT.y}
          width={INPUT_RECT.w}
          height={INPUT_RECT.h}
          rx={10}
          style={{ fill: 'var(--surface)', stroke: 'var(--accent)' }}
          strokeWidth={1.5}
        />
        {/* typed query — centered in the box, caret transparent */}
        <text
          x={INPUT_RECT.x + INPUT_RECT.w / 2}
          y={INPUT_RECT.y + 37}
          textAnchor="middle"
          fontSize={20}
          style={{ fill: 'var(--text)', fontFamily: 'var(--font-mono)' }}
        >
          <tspan ref={inputTextRef}>{QUERIES[0]}</tspan>
        </text>
        <text
          ref={hitTextRef}
          x={FRAME_RECT.x + FRAME_RECT.w / 2}
          y={INPUT_RECT.y + INPUT_RECT.h + 30}
          textAnchor="middle"
          fontSize={17}
          fontWeight={600}
          opacity={0}
          style={{ fill: 'var(--accent)' }}
        >
          <tspan ref={hitCountRef}>{leads.length}</tspan> {labels.hitSuffix}
        </text>

        {/* input → pool connector */}
        <path
          d={`M ${CONNECTOR.x} ${CONNECTOR.y0} L ${CONNECTOR.x} ${CONNECTOR.y1}`}
          style={{ fill: 'none', stroke: 'var(--border)' }}
          strokeWidth={1.5}
        />

        {/* pool — accumulates retrieved posts */}
        <rect x={POOL_RECT.x} y={POOL_RECT.y} width={POOL_RECT.w} height={POOL_RECT.h} rx={14} style={{ fill: 'var(--surface)' }} />
        {poolDots.map((d, i) => (
          <circle
            key={`pool-${i}`}
            ref={(el) => {
              flowRefs.current[i] = el;
            }}
            cx={0}
            cy={0}
            r={4}
            style={{ fill: 'var(--text-subtle)' }}
            opacity={d.visible ? 0.55 : 0}
            transform={`translate(${d.x} ${d.y})`}
          />
        ))}

        {/* inlet lines (left module → model) */}
        {IN_LINES.map((s, i) => (
          <path
            key={`in-${i}`}
            d={`M ${s.p0.x} ${s.p0.y} C ${s.p1.x} ${s.p1.y}, ${s.p2.x} ${s.p2.y}, ${s.p3.x} ${s.p3.y}`}
            style={{ fill: 'none', stroke: 'var(--border)' }}
            strokeWidth={1.5}
          />
        ))}
        {/* transit particles (spawned freely — no throttle, no cap) */}
        <g ref={transitLayerRef} />

        {/* model node — centered between frame and bins */}
        <circle className="pipeline-pulse" cx={MODEL_RECT.x + MODEL_RECT.w / 2} cy={200} r={58} style={{ fill: 'none', stroke: 'var(--accent)' }} strokeWidth={1.5} />
        <rect
          x={MODEL_RECT.x}
          y={MODEL_RECT.y}
          width={MODEL_RECT.w}
          height={MODEL_RECT.h}
          rx={16}
          style={{ fill: 'var(--surface)', stroke: 'var(--accent)' }}
          strokeWidth={1.5}
        />
        <text x={MODEL_RECT.x + MODEL_RECT.w / 2} y={194} textAnchor="middle" fontSize={22} fontWeight={700} style={{ fill: 'var(--text)' }}>
          {labels.model}
        </text>
        <text x={MODEL_RECT.x + MODEL_RECT.w / 2} y={226} textAnchor="middle" fontSize={17} style={{ fill: 'var(--text-muted)' }}>
          {labels.modelSub}
        </text>

        {/* exit lanes (model → bins) */}
        {OUT_LANES.map((s, i) => (
          <path
            key={`out-${i}`}
            d={`M ${s.p0.x} ${s.p0.y} C ${s.p1.x} ${s.p1.y}, ${s.p2.x} ${s.p2.y}, ${s.p3.x} ${s.p3.y}`}
            style={{ fill: 'none', stroke: 'var(--accent-soft)' }}
            strokeWidth={1.5}
          />
        ))}
        {/* fly particles (spawned freely — no throttle, no cap) */}
        <g ref={flyLayerRef} />

        {/* right zone: three score-tier bins with real leads */}
        <text x={BIN_X + BIN_W / 2} y={44} textAnchor="middle" fontSize={20} fontWeight={600} style={{ fill: 'var(--text-muted)' }}>
          {labels.queue}
        </text>
        {bins.counts.map((count, lane) => {
          const y = BIN_TOP + lane * (BIN_H + BIN_GAP);
          const binLead = bins.latest[lane];
          return (
            <g key={`bin-${lane}`}>
              <rect
                x={BIN_X}
                y={y}
                width={BIN_W}
                height={BIN_H}
                rx={12}
                style={{ fill: 'var(--surface)', stroke: lane === 0 ? 'var(--accent-soft)' : 'var(--border)' }}
                strokeWidth={lane === 0 ? 1.5 : 1}
              />
              <text x={BIN_X + 16} y={y + 32} fontSize={19} fontWeight={600} style={{ fill: 'var(--text)' }}>
                {BIN_LABELS[lane]}
              </text>
              <text x={BIN_X + BIN_W - 16} y={y + 32} textAnchor="end" fontSize={17} style={{ fill: 'var(--text-muted)' }}>
                <tspan
                  ref={(el) => {
                    binCountRefs.current[lane] = el;
                  }}
                >
                  {count}
                </tspan>{' '}
                {labels.binCountSuffix}
              </text>
              {binLead ? (
                <g
                  key={`lead-${lane}-${bins.seq[lane]}`}
                  className="pipeline-card-enter"
                  style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
                >
                  <text x={BIN_X + 16} y={y + 60} fontSize={18} fontWeight={600} style={{ fill: 'var(--text)' }}>
                    {binLead.handle}
                  </text>
                  <text x={BIN_X + 16} y={y + 84} fontSize={18} style={{ fill: 'var(--text-muted)' }}>
                    {truncate(binLead.text, 26)}
                  </text>
                  <rect x={BIN_X + BIN_W - 76} y={y + 42} width={60} height={26} rx={8} style={{ fill: 'var(--accent)' }} />
                  <text
                    x={BIN_X + BIN_W - 46}
                    y={y + 60}
                    textAnchor="middle"
                    fontSize={17}
                    fontWeight={700}
                    style={{ fill: 'var(--accent-fg)' }}
                  >
                    {binLead.score}
                  </text>
                </g>
              ) : (
                <text x={BIN_X + 16} y={y + 64} fontSize={17} style={{ fill: 'var(--text-subtle)' }}>
                  {labels.emptyBin}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* tooltip (HTML overlay, clamped inside the container) */}
      {active && tip && (
        <div
          className="pipeline-tooltip pointer-events-none absolute z-10"
          style={{
            left: `${Math.min(78, Math.max(2, (tip.x / VIEW_W) * 100))}%`,
            top: `${Math.min(92, Math.max(2, (tip.y / 400) * 100))}%`,
          }}
        >
          {renderTooltip()}
        </div>
      )}

        </div>
      </div>

      {/* honest stats: real fetched leads + live dock count from bins */}
      {/* stats: derived from bins state — always consistent with the bins */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 font-mono text-base text-text-muted">
        <span>
          <span ref={poolCountRef} className="font-semibold text-text">{leads.length}</span>{' '}
          {labels.statScored}
        </span>
        <span>
          <span ref={binnedRef} className="font-semibold text-text">
            {leads.length}
          </span>{' '}
          {labels.statQualified}
        </span>
      </div>
    </div>
  );
}
