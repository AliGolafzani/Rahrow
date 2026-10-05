import type { Page, TestInfo } from '@playwright/test';

// Temporary, allowlisted diagnostics for the ten failures on the reviewed AUTH-03 head.
const cases: Record<string, { id: number; route: 'login' | 'dashboard' | 'public'; message: string }> = {
  'invalid OTP stays on challenge and valid proof remains usable': { id: 1, route: 'login', message: 'کد واردشده درست نیست.' },
  'expired and exhausted OTP are distinguished and never imply a session': { id: 2, route: 'login', message: 'زمان استفاده از این کد تمام شده است.' },
  'failed resend preserves the active challenge and typed code': { id: 3, route: 'login', message: 'در حال حاضر ارسال پیامک ممکن نیست.' },
  'actual target throttling disables resend and keeps current proof': { id: 4, route: 'login', message: 'درخواست‌های زیادی فرستاده‌اید.' },
  'request unavailable is recoverable without pretending delivery or login succeeded': { id: 5, route: 'login', message: 'در حال حاضر ارتباط با سرویس ورود برقرار نیست.' },
  'logout failure is explicit and retry succeeds without restoring protected history': { id: 6, route: 'dashboard', message: 'خروج تأیید نشد' },
  'verification throttle disables repeat attempts until backend retry interval': { id: 7, route: 'login', message: 'درخواست‌های زیادی فرستاده‌اید.' },
  'interrupted verification checks session before offering a new proof attempt': { id: 8, route: 'login', message: 'ورود تأیید نشد' },
  'public navigation logout network failure remains explicit and retryable': { id: 9, route: 'public', message: 'خروج تأیید نشد' },
  'valid unavailable verification response blocks another proof until session uncertainty resolves': { id: 10, route: 'login', message: 'ورود تأیید نشد' },
};
const fields = ['alerts', 'expected', 'form', 'formExpected', 'logout', 'logoutExpected', 'session', 'announcer'] as const;

export async function diagnoseFailedAlert(page: Page, info: TestInfo) {
  const entry = Object.hasOwn(cases, info.title) ? cases[info.title] : undefined;
  if (!entry || info.status !== 'failed') return;
  // Count-only DOM reads. Never collect text, input values, URLs, requests or snapshots.
  try {
    const alerts = page.getByRole('alert');
    const form = page.locator('.auth-form form').getByRole('alert');
    const logout = page.locator('.logout-control').getByRole('alert');
    const counts = await Promise.all([
      alerts.count(), alerts.filter({ hasText: entry.message }).count(),
      form.count(), form.filter({ hasText: entry.message }).count(),
      logout.count(), logout.filter({ hasText: entry.message }).count(),
      page.locator('.session-notice').getByRole('alert').count(),
      page.locator('next-route-announcer').getByRole('alert').count(),
    ]);
    info.annotations.push({ type: 'temporary-alert-diagnostic', description: JSON.stringify({
      id: entry.id, route: entry.route,
      strict: info.errors.some(error => error.message?.includes('strict mode violation') === true),
      ...Object.fromEntries(fields.map((field, index) => [field, Math.min(counts[index], 20)])),
    }) });
  } catch {
    // No error contents are retained. Missing diagnostics are a blocker, never a pass.
    info.annotations.push({ type: 'temporary-alert-diagnostic-unavailable', description: String(entry.id) });
  }
}

/** Reject untrusted/malformed annotations; render only fixed labels and bounded primitives. */
export function formatAlertDiagnostic(annotation: { type: string; description?: string }): string | undefined {
  if (annotation.type === 'temporary-alert-diagnostic-unavailable' && /^(?:[1-9]|10)$/.test(annotation.description ?? '')) {
    return `ALERT_DIAGNOSTIC case=${Number(annotation.description)} unavailable=true`;
  }
  if (annotation.type !== 'temporary-alert-diagnostic' || !annotation.description || annotation.description.length > 512) return;
  try {
    const value = JSON.parse(annotation.description) as Record<string, unknown>;
    if (!Number.isInteger(value.id) || Number(value.id) < 1 || Number(value.id) > 10 ||
      !['login', 'dashboard', 'public'].includes(String(value.route)) || typeof value.strict !== 'boolean' ||
      fields.some(field => !Number.isInteger(value[field]) || Number(value[field]) < 0 || Number(value[field]) > 20)) return;
    const cardinality = value.alerts === 0 ? 'zero' : value.alerts === 1 ? 'one' : 'multiple';
    return `ALERT_DIAGNOSTIC case=${value.id} route=${value.route} strict=${value.strict} candidates=${cardinality} ` +
      fields.map(field => `${field}=${value[field]}`).join(' ');
  } catch { return; }
}
