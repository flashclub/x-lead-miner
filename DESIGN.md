# Design System v2

The system is token-driven: pages reference semantic tokens, themes define
their values. Never hardcode hex colors in components — change the theme or
add a token instead.

Decision basis: community design research with weighted evidence. Highlights:
distinctiveness is the highest-rated quality; unearned decoration (excess
animation, glassmorphism everywhere, custom cursors, scroll-jacking) is the
most-criticized failure mode.

## Theme

This app ships **two palettes of the ember brand**, user-switchable:

| Palette | Look | Mode |
| --- | --- | --- |
| `ember-light` | warm paper white, amber accent | **light — default** (`:root`) |
| `ember` | warm black forge, amber glow | dark (`html[data-theme='dark']`) |

`globals.css` imports both. The header `ThemeToggle` flips `data-theme` on
`<html>` and persists the choice in `localStorage` (`xlm-theme`); an inline
script in `layout.tsx` restores a saved 'dark' before first paint, so there
is no flash. Toggle glyphs swap via CSS — the component holds no React
state. The other theme presets (aurora/terminal/tide/minimal) remain unused
in `src/app/themes/` as alternative bases.

## Tokens

Defined per theme as plain CSS variables, mapped to Tailwind v4 utilities in
`globals.css` (`@theme inline`):

| Token | Utility examples | Use |
| --- | --- | --- |
| `--bg` | `bg-bg` | page background |
| `--surface` / `--surface-2` | `bg-surface`, `bg-surface-2` | cards, raised panels |
| `--border` / `--border-strong` | `border-border`, `border-border-strong` | card borders, hover emphasis |
| `--text` / `--text-muted` / `--text-subtle` | `text-text`, `text-text-muted` | heading / body / footnote text |
| `--accent` / `--accent-fg` / `--accent-soft` | `bg-accent text-accent-fg` | primary actions, highlights |
| `--glow` (RGB triplet) | `shadow-glow`, `shadow-glow-sm` | accent shadows/selection |
| `--hero-glow-image` / `--hero-grid-image` | (used by `.hero-glow`, `.hero-grid`) | hero background layers |

Fonts are fixed across themes: Geist (body) + Space Grotesk (display) +
Geist Mono (numbers/code), loaded via `next/font` in `src/app/layout.tsx`
(`font-sans`, `font-display`, `font-mono`). Deliberately not Poppins or
Montserrat.

## Animation budget

Community data is unambiguous: more than 2–3 animations per page reads as
unusable, and scroll-triggered reveals read as "the site is slow". This
design system therefore ships exactly:

1. **Hero background drift** — one slow CSS transform on `.hero-glow`
   (disabled in the `terminal` and `minimal` themes).
2. **Card/button hover states** — color/border/shadow transitions only.

No scroll-reveal, no scroll-jacking, no custom cursors, no entrance
animations. All effects are pure CSS (zero client JS, no animation library)
and freeze under `prefers-reduced-motion: reduce` via the global rule in
`globals.css`.

Glassmorphism is limited to the dashboard header (`bg-bg/80
backdrop-blur-md`) — cards stay solid.

## Component provenance (docs/ui adoption records)

| Component | Source | Adopted | Changes |
| --- | --- | --- | --- |
| `components/effects/hero-background.tsx` | https://reactbits.dev/components/Backgrounds/Aurora (TS+TW) | 2026-08-20 | reduced to two CSS-variable-driven layers; removed JS props/canvas; reduced-motion freeze. Visual method only; no substantial upstream code retained. License: MIT + Commons Clause (do not resell the components themselves). |
| `components/effects/gradient-text.tsx` | https://reactbits.dev/components/Text/GradientText (pattern) | 2026-08-20 | plain CSS `background-clip: text` bound to theme tokens; text remains in DOM for SEO/screen readers. |

| `components/effects/lead-pipeline-diagram.tsx` | original (in-house) | 2026-11-16 | rAF pipeline diagram, zero deps; shows real scored leads from `lib/intent.ts` with a disclosed sample fallback. IntersectionObserver-gated (paused offscreen); prefers-reduced-motion renders the static SSR frame only. Note: it raises the landing page to two continuous effects (hero drift + pipeline pulse) — the pipeline IS this page's signature effect; do not add a third. |

`components/ui/*` (Button/Card/Badge) are original, dependency-free
implementations.

| Component | Source | Adopted | Changes |
|---|---|---|---|
| `components/search-composer.tsx` + `components/ui/segmented.tsx` + `components/ui/select-menu.tsx` | Visual recipes from Aceternity UI (Tabs pill segmented control; outline buttons as chips; signup-form input styling) — https://ui.aceternity.com/components/tabs | 2026-11-26 | rebuilt with semantic tokens and pure CSS transitions; the Aceternity originals depend on motion (framer-motion), which the animation budget forbids, so no motion library is used and the motion-driven effects (spring pill, cursor-following glow) are replaced by standard hover/active transitions. |

`components/ui/*` (Button/Card/Badge) are original, dependency-free
implementations.

## Maintenance rules

- Components must use semantic tokens; the only hardcoded colors allowed are
  inside `src/app/themes/*.css` and `opengraph-image.tsx` (server-rendered
  OG images cannot read CSS variables — its aurora-style palette is the
  house default; re-brand it when you adopt a real brand).
- Keep landing pages honest: the hero subtitle slot must state what the
  product does and for whom, in one plain sentence.
- If you add an effect: CSS-only first, one per page, functional (not
  decorative), with a reduced-motion fallback, and record provenance above.
