import type { AuthenticatedSelf } from '@rahrow/contracts';
export type { AuthenticatedSelf } from '@rahrow/contracts';

/** Explicit private self projection, never used by public profile queries. */
export const authenticatedSelfSelect = {
  id: true, mobile: true, email: true, firstName: true, lastName: true,
  birthDate: true, displayName: true, avatar: true,
} as const;

export function toAuthenticatedSelf(user: Omit<AuthenticatedSelf, 'birthDate'> & { birthDate: Date | null }): AuthenticatedSelf {
  return {
    id: user.id, mobile: user.mobile, email: user.email, firstName: user.firstName, lastName: user.lastName,
    birthDate: user.birthDate === null ? null : user.birthDate.toISOString().slice(0, 10),
    displayName: user.displayName, avatar: user.avatar,
  };
}
