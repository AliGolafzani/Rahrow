import type { PublicProfile } from '@rahrow/contracts';

export function toPublicProfile(user: { displayName: string | null; avatar: string | null }): PublicProfile {
  return { displayName: user.displayName, avatar: user.avatar };
}
