import { canonicalInternalPath, DEFAULT_RETURN_TARGET } from './return-target.ts';
/** A future registered destination must provide an explicit server permission predicate. */
export type RoutePolicy = Readonly<Record<string, (session: { authenticated: true }) => boolean | Promise<boolean>>>;
const protectedRoutes: RoutePolicy = Object.freeze({ '/dashboard': () => true });
export async function permittedReturnTarget(value: unknown, session: { authenticated: true }, policies: RoutePolicy = protectedRoutes): Promise<string> {
  const path = canonicalInternalPath(value);
  if (path && Object.hasOwn(policies, path) && await policies[path](session)) return path;
  return DEFAULT_RETURN_TARGET;
}
