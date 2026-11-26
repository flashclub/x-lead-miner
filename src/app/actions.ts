'use server';

import { signOut } from '@/auth';

/** Server action for the sidebar sign-out button (passed to the client
 *  component as a prop — the action itself stays server-side). */
export async function signOutAction() {
  await signOut({ redirectTo: '/' });
}
