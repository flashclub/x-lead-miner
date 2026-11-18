import { cn } from '@/lib/cn';

interface CardProps {
  className?: string;
  children: React.ReactNode;
}

/**
 * Solid card with a fine border. Hover adds a subtle theme glow —
 * decoration stays a garnish; content must never depend on it.
 */
export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-surface p-6',
        'transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-glow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}
