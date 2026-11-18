import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation. Use this Link/usePathname/useRouter everywhere
 * instead of next/link + next/navigation so hrefs stay on the active locale.
 */
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
