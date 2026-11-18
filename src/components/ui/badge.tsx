import { cn } from '@/lib/cn';

interface BadgeProps {
  className?: string;
  children: React.ReactNode;
}

export function Badge({ className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-border bg-surface-2 px-2.5 py-0.5 font-mono text-sm text-text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}
