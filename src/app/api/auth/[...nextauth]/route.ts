import { handlers } from '@/auth';

// Auth.js route handler — /api/auth/* (sign-in callbacks, session, sign-out).
// Lives under /api, which the middleware matcher excludes, so next-intl never
// touches it.
export const { GET, POST } = handlers;
