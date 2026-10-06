/** Return targets are canonical route keys, not URLs to normalize or repeatedly decode. */
export const DEFAULT_RETURN_TARGET = '/dashboard';
export function canonicalInternalPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 ||
      !/^\/[a-z0-9]+(?:\/[a-z0-9-]+)*$/.test(value)) return null;
  return value;
}
export function safeReturnTarget(value: unknown): string {
  return canonicalInternalPath(value) === '/dashboard' ? '/dashboard' : DEFAULT_RETURN_TARGET;
}
