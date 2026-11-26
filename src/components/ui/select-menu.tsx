'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

export interface SelectMenuOption<T extends string> {
  /** Display label. */
  label: string;
  value: T;
}

/**
 * Styled dropdown for short option lists (≤6). Visual recipe from Aceternity
 * UI's dropdown/outline-button patterns (bordered surface, hover raise, small
 * caret), rendered with the repo's semantic tokens — no animation library:
 * open/close is instant, hover states are CSS transitions.
 *
 * Closes on outside click and Escape; the trigger is a real <button> so it is
 * keyboard-reachable (Enter/Space opens, Esc closes).
 */
export function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text transition-colors hover:border-border-strong"
      >
        <span aria-hidden="true" className="text-text-subtle">
          {ariaLabel}
        </span>
        <span className="font-medium">{current?.label ?? value}</span>
        <span aria-hidden="true" className="text-text-subtle">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 top-full z-20 mt-1 min-w-full overflow-hidden rounded-md border border-border bg-surface py-1 shadow-glow-sm"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <li key={option.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-accent-soft text-accent'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  )}
                >
                  {active && <span aria-hidden="true">✓</span>}
                  <span className={active ? '' : 'pl-4'}>{option.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
