/**
 * HeroBackground — decorative hero backdrop, pure CSS, zero client JS.
 *
 * Provenance (docs/ui adoption record):
 * - Source: https://reactbits.dev/components/Backgrounds/Aurora (TypeScript + Tailwind variant)
 * - Adopted: 2026-08-20
 * - Local file: src/components/effects/hero-background.tsx
 * - Changes: reduced to two static layers driven entirely by theme CSS
 *   variables (--hero-glow-image / --hero-grid-image); removed JS props,
 *   keyframe orchestration and canvas logic; global prefers-reduced-motion
 *   freeze applied in globals.css. Visual method referenced, no substantial
 *   upstream code retained.
 *
 * Rendered inside a `relative overflow-hidden` hero section.
 */
export function HeroBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="hero-glow absolute -inset-[15%]" />
      <div className="hero-grid absolute inset-0" />
    </div>
  );
}
