'use client';

import { cn } from '@/lib/cn';

/**
 * Segmented control (Latest/Top, on/off) styled after Aceternity UI's Tabs —
 * the active pill is a filled surface with an accent label, and the switch is
 * a plain CSS transition (no motion library; see DESIGN.md animation budget).
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  /** [display label, value] pairs, rendered in order. */
  options: [string, T][];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-border bg-surface p-0.5"
    >
      {options.map(([label, optionValue]) => {
        const active = optionValue === value;
        return (
          <button
            key={optionValue}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(optionValue)}
            className={cn(
              'rounded px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-surface-2 font-medium text-accent'
                : 'text-text-muted hover:text-text'
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
