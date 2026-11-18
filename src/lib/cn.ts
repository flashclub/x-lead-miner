/**
 * Tiny class-name combiner. Deliberately dependency-free — do not add
 * clsx/tailwind-merge for a two-line helper.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
