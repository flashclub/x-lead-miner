import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const base =
  'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-glow-sm hover:brightness-110',
  secondary:
    'border border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2',
  ghost: 'text-text-muted hover:text-text',
};

interface CommonProps {
  variant?: ButtonVariant;
  className?: string;
  children: React.ReactNode;
}

type ButtonProps = CommonProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

type ButtonLinkProps = CommonProps & { href: string };

/**
 * Button renders a <button>, or a next/link when `href` is given.
 * Colors come from the active theme tokens — never hardcode palettes here.
 */
export function Button(props: ButtonProps | ButtonLinkProps) {
  const { variant = 'primary', className, children } = props;
  const cls = cn(base, variants[variant], className);

  if ('href' in props) {
    return (
      <Link href={props.href} className={cls}>
        {children}
      </Link>
    );
  }

  const { ...rest } = props as ButtonProps;
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
