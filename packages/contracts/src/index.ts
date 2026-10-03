/** The complete public identity allowlist. Private account records stay server-side. */
export interface PublicProfile {
  displayName: string | null;
  avatar: string | null;
}
