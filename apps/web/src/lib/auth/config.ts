import process from 'node:process';
export interface AuthWebConfig { apiOrigin: string; webOrigin: string }
function origin(value: string | undefined): string {
  if (!value) throw new Error('Authentication web configuration is unavailable.');
  const parsed = new URL(value);
  if (parsed.origin !== value || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
      (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
    throw new Error('Authentication web configuration is unavailable.');
  }
  return parsed.origin;
}
/** No NEXT_PUBLIC variables, inferred Host, forwarded headers, or caller-provided upstream. */
export function authWebConfig(): AuthWebConfig {
  const apiOrigin = origin(process.env.RAHROW_API_ORIGIN);
  const webOrigin = origin(process.env.RAHROW_WEB_ORIGIN);
  if (apiOrigin === webOrigin) throw new Error('Authentication web configuration is unavailable.');
  return { apiOrigin, webOrigin };
}
