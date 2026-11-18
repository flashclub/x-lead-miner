import { cn } from '@/lib/cn';

interface GradientTextProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * GradientText — accent-gradient text for hero headlines.
 *
 * Provenance (docs/ui adoption record):
 * - Source: pattern referenced from https://reactbits.dev/components/Text/GradientText
 *   and https://ui.aceternity.com/components/text-generate-effect (visual method only)
 * - Adopted: 2026-08-20
 * - Local file: src/components/effects/gradient-text.tsx
 * - Changes: plain CSS background-clip implementation bound to theme tokens
 *   (--text → --accent); text remains in the DOM for SEO and screen readers.
 */
export function GradientText({ className, children }: GradientTextProps) {
  return <span className={cn('gradient-text', className)}>{children}</span>;
}
