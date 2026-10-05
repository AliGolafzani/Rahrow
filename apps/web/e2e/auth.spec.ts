import { randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, type AuthHarness } from './fixtures';

const mobileField = (page: Page) => page.getByRole('textbox', { name: 'شماره همراه', exact: true });
const codeField = (page: Page) => page.getByRole('textbox', { name: 'کد یک‌بارمصرف', exact: true });
const sendButton = (page: Page) => page.getByRole('button', { name: 'دریافت کد ورود', exact: true });
const verifyButton = (page: Page) => page.getByRole('button', { name: 'تأیید و ورود', exact: true });
const resendButton = (page: Page) => page.getByRole('button', { name: /ارسال دوباره کد/ });
const logoutButton = (page: Page) => page.getByRole('button', { name: /خروج/ });
const freshMobile = () => `+999${randomInt(100_000_000, 999_999_999)}`;
const errorText = {
  invalid: 'کد واردشده درست نیست.',
  expired: 'زمان استفاده از این کد تمام شده است.',
  exhausted: 'تعداد تلاش‌های این کد به پایان رسیده است.',
  throttled: 'درخواست‌های زیادی فرستاده‌اید.',
  unavailable: 'در حال حاضر ارتباط با سرویس ورود برقرار نیست.',
  delivery: 'در حال حاضر ارسال پیامک ممکن نیست.',
};

async function requestCode(page: Page, auth: AuthHarness, mobile = freshMobile()) {
  await mobileField(page).fill(mobile);
  const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/otp/request') && response.request().method() === 'POST');
  await sendButton(page).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const body: unknown = await response.json();
  expect(typeof body === 'object' && body !== null && 'challengeId' in body).toBe(true);
  const challengeId = (body as { challengeId: string }).challengeId;
  const code = auth.codeFor(challengeId);
  await expect(codeField(page)).toBeVisible();
  // Return secrets only to this caller. Reporter, traces, snapshots and logs never inspect them.
  return { challengeId, mobile, code };
}

async function verifyCode(page: Page, code: string) {
  await codeField(page).fill(code);
  const response = page.waitForResponse(value => value.url().endsWith('/api/v1/auth/otp/verify'));
  await verifyButton(page).click();
  return response;
}

async function login(page: Page, auth: AuthHarness) {
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(logoutButton(page)).toBeVisible();
  return challenge;
}

async function allowResend(page: Page, auth: AuthHarness) {
  auth.advance(60_001);
  await page.clock.fastForward(60_001);
  await expect(resendButton(page)).toBeEnabled();
}

function wrongCode(code: string) { return code === '000000' ? '000001' : '000000'; }

test('guest navigation and protected Dashboard require confirmed session', async ({ page, auth }) => {
  void auth;
  await page.goto('/');
  await expect(page.getByRole('link', { name: /ورود/ })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard$/);
  await expect(mobileField(page)).toBeVisible();
  await expect(logoutButton(page)).toHaveCount(0);
});

test('real OTP login creates a cookie session and valid login entry returns to Dashboard', async ({ page, auth, context }) => {
  await login(page, auth);
  const cookies = await context.cookies();
  expect(cookies.some(cookie => cookie.name === 'rahrow_local_session' && cookie.httpOnly && cookie.sameSite === 'Lax')).toBe(true);
  expect(await page.evaluate(() => document.cookie.includes('rahrow_local_session'))).toBe(false);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.goto('/login?returnTo=%2Fdashboard');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.reload();
  await expect(logoutButton(page)).toBeVisible();
});

test('hostile and unapproved return targets never navigate outside approved Dashboard', async ({ page, auth }) => {
  await login(page, auth);
  for (const target of ['https://example.invalid/', '//example.invalid', '/\\example.invalid', '%2f%2fexample.invalid', '/admin', '/dashboard?next=x', '/login', '/auth/complete']) {
    await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
    await expect(page).toHaveURL('http://127.0.0.1:3100/dashboard');
  }
  await page.goto('/auth/complete?returnTo=https%3A%2F%2Fexample.invalid');
  await expect(page).toHaveURL('http://127.0.0.1:3100/dashboard');
});

test('mobile and OTP input validation preserves exact ASCII entry and field focus', async ({ page, auth }) => {
  await page.goto('/login');
  const mobile = mobileField(page);
  await expect(mobile).toHaveAttribute('type', 'tel');
  await expect(mobile).toHaveAttribute('autocomplete', 'tel');
  await mobile.fill('۰۹۱۲۳۴۵۶۷۸۹');
  await sendButton(page).click();
  await expect(mobile).toBeFocused();
  await expect(mobile).toHaveAttribute('aria-invalid', 'true');
  await requestCode(page, auth);
  const field = codeField(page);
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveAttribute('inputmode', 'numeric');
  await expect(field).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(field).toBeFocused();
  await field.fill('001234');
  expect(await field.inputValue() === '001234').toBe(true);
  await field.fill('۱۲۳۴۵۶');
  await verifyButton(page).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
});

test('invalid OTP stays on challenge and valid proof remains usable', async ({ page, auth }) => {
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  expect((await verifyCode(page, wrongCode(challenge.code))).status()).toBe(401);
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.invalid);
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('expired and exhausted OTP are distinguished and never imply a session', async ({ page, auth }) => {
  await page.goto('/login');
  const expired = await requestCode(page, auth);
  auth.advance(300_001);
  expect((await verifyCode(page, expired.code)).status()).toBe(401);
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.expired);
  await page.goto('/login');
  const exhausted = await requestCode(page, auth);
  for (let attempt = 0; attempt < 5; attempt++) {
    expect((await verifyCode(page, wrongCode(exhausted.code))).status()).toBe(401);
    await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.invalid);
  }
  expect((await verifyCode(page, exhausted.code)).status()).toBe(401);
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.exhausted);
  await expect(logoutButton(page)).toHaveCount(0);
});

test('successful resend selects only newest challenge while older UI proof works in another tab', async ({ page, auth, context }) => {
  const other = await context.browser()!.newContext({ baseURL: 'http://127.0.0.1:3100' });
  try {
    const olderPage = await other.newPage();
    await olderPage.goto('/login');
    const older = await requestCode(olderPage, auth);
    auth.advance(60_001);
    await page.clock.install();
    await page.goto('/login');
    const current = await requestCode(page, auth, older.mobile);
    await allowResend(page, auth);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/otp/request'));
    await resendButton(page).click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const latest = await response.json() as { challengeId: string };
    expect(latest.challengeId !== current.challengeId && latest.challengeId !== older.challengeId).toBe(true);
    await expect(codeField(page)).toHaveValue('');
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /previous|older|قبلی|قدیمی/i })).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
    let submittedNewest = false;
    page.on('request', request => {
      if (request.url().endsWith('/api/v1/auth/otp/verify')) {
        const input = request.postDataJSON() as { challengeId: string };
        submittedNewest = input.challengeId === latest.challengeId;
      }
    });
    expect((await verifyCode(olderPage, older.code)).status()).toBe(200);
    await expect(olderPage).toHaveURL(/\/dashboard$/);
    expect((await verifyCode(page, auth.codeFor(latest.challengeId))).status()).toBe(200);
    expect(submittedNewest).toBe(true);
    await expect(page).toHaveURL(/\/dashboard$/);
  } finally { await other.close(); }
});

test('failed resend preserves the active challenge and typed code', async ({ page, auth }) => {
  await page.clock.install();
  await page.goto('/login');
  const current = await requestCode(page, auth);
  await codeField(page).fill(current.code);
  await allowResend(page, auth);
  auth.failNext('requestOtp', 'AUTH_DELIVERY_UNAVAILABLE');
  await resendButton(page).click();
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.delivery);
  expect(await codeField(page).inputValue() === current.code).toBe(true);
  expect((await verifyCode(page, current.code)).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('actual target throttling disables resend and keeps current proof', async ({ page, auth }) => {
  await page.clock.install();
  await page.goto('/login');
  let current = await requestCode(page, auth);
  let throttled = false;
  // Six minute advances can cross at most one default 15-minute boundary. Seven
  // total requests therefore hit its budget of three without changing any limit.
  for (let resend = 0; resend < 6; resend++) {
    await allowResend(page, auth);
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/otp/request'));
    await resendButton(page).click();
    const response = await responsePromise;
    if (response.status() === 429) { throttled = true; break; }
    expect(response.status()).toBe(202);
    const body = await response.json() as { challengeId: string };
    current = { ...current, challengeId: body.challengeId, code: auth.codeFor(body.challengeId) };
  }
  expect(throttled).toBe(true);
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.throttled);
  await expect(resendButton(page)).toBeDisabled();
  expect((await verifyCode(page, current.code)).status()).toBe(200);
});

test('request unavailable is recoverable without pretending delivery or login succeeded', async ({ page, auth }) => {
  await page.goto('/login');
  auth.failNext('requestOtp');
  await mobileField(page).fill(freshMobile());
  await sendButton(page).click();
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.unavailable);
  await expect(codeField(page)).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();
  await requestCode(page, auth);
});

test('duplicate request clicks and Enter produce only one in-flight mutation', async ({ page, auth }) => {
  void auth;
  await page.goto('/login');
  await mobileField(page).fill(freshMobile());
  let count = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/otp/request', async route => {
    count++;
    await barrier;
    await route.continue();
  });
  await sendButton(page).click();
  await expect(page.locator('form button[type=submit]')).toBeDisabled();
  await page.keyboard.press('Enter');
  release();
  await expect(codeField(page)).toBeVisible();
  expect(count).toBe(1);
});

test('session bootstrap failure hides authenticated controls and can recover', async ({ page, auth }) => {
  await login(page, auth);
  auth.failNext('currentSession');
  await page.reload();
  await expect(logoutButton(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'وضعیت ورود روشن نیست' })).toBeVisible();
  await page.reload();
  await expect(logoutButton(page)).toBeVisible();
});

test('session expiry on refresh removes protected Dashboard and requires login', async ({ page, auth }) => {
  await login(page, auth);
  auth.advance(43_200_001);
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await expect(mobileField(page)).toBeVisible();
  await expect(logoutButton(page)).toHaveCount(0);
});

test('logout failure is explicit and retry succeeds without restoring protected history', async ({ page, auth, context }) => {
  await login(page, auth);
  auth.failNext('logout');
  await logoutButton(page).click();
  await expect(page.getByRole('heading', { name: 'وضعیت ورود روشن نیست' })).toBeVisible();
  await expect(page.locator('.logout-control').getByRole('alert')).toContainText('خروج تأیید نشد');
  expect((await context.cookies()).some(cookie => cookie.name === 'rahrow_local_session')).toBe(true);
  await expect(logoutButton(page)).toBeEnabled();
  await logoutButton(page).click();
  await expect(page).toHaveURL(/\/login\?reason=signed-out$/);
  expect((await context.cookies()).some(cookie => cookie.name === 'rahrow_local_session')).toBe(false);
  await page.goBack();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
  await expect(logoutButton(page)).toHaveCount(0);
});

async function expectReducedMotion(page: Page) {
  expect(await page.locator('body').evaluate(body => {
    const elements = [body, ...body.querySelectorAll('*')];
    return elements.every(element => [undefined, '::before', '::after'].every(pseudo => {
      const style = getComputedStyle(element, pseudo);
      const zeroDurations = (value: string) => value.split(',').every(duration => Number.parseFloat(duration) === 0);
      return zeroDurations(style.transitionDuration) && zeroDurations(style.animationDuration) &&
        style.animationName.split(',').every(name => name.trim() === 'none') && style.scrollBehavior === 'auto';
    }));
  })).toBe(true);
}

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
  test(`accessible keyboard flow at ${viewport.width}px and reduced motion`, async ({ page, auth }) => {
    await page.clock.install();
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fa');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(mobileField(page)).toBeVisible();
    const brand = page.locator(viewport.width >= 1024 ? '.auth-editorial .brand-mark' : '.mobile-brand .brand-mark');
    await expect(brand).toBeVisible();
    await expect(brand).toHaveAttribute('alt', '');
    await expect(brand).toHaveAttribute('aria-hidden', 'true');
    await expect(brand).toHaveAttribute('src', '/brand/rahrow-symbol.png');
    await expect.poll(() => brand.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1114);
    expect(await brand.evaluate(element => {
      const { width, height } = element.getBoundingClientRect();
      return width === height && width >= 32;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectReducedMotion(page);

    // Enter the form through the actual document Tab order, with no locator.focus/fill.
    await page.keyboard.press('Tab');
    if (viewport.width >= 1024) {
      await expect(page.getByRole('link', { name: 'راهرو، صفحه نخست', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
    }
    await expect(page.getByRole('link', { name: /بازگشت به صفحه نخست/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(mobileField(page)).toBeFocused();
    expect(await mobileField(page).evaluate(element => {
      const style = getComputedStyle(element);
      return style.outlineStyle !== 'none' && style.outlineWidth !== '0px' || style.boxShadow !== 'none';
    })).toBe(true);
    await page.keyboard.insertText(freshMobile());
    await page.keyboard.press('Tab');
    await expect(sendButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(mobileField(page)).toBeFocused();
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/otp/request'));
    await page.keyboard.press('Enter');
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const result = await response.json() as { challengeId: string };
    await expect(codeField(page)).toBeFocused();
    await expectReducedMotion(page);
    await allowResend(page, auth);

    // OTP receives focus automatically. Reverse and forward traversal reaches every action.
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'تغییر شماره همراه', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(codeField(page)).toBeFocused();
    await page.keyboard.insertText(auth.codeFor(result.challengeId));
    await page.keyboard.press('Tab');
    await expect(verifyButton(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(resendButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(verifyButton(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(codeField(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expectReducedMotion(page);
  });
}

test('verification throttle disables repeat attempts until backend retry interval', async ({ page, auth }) => {
  await page.clock.install();
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  auth.failNext('verifyOtp', 'AUTH_THROTTLED');
  expect((await verifyCode(page, challenge.code)).status()).toBe(429);
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText(errorText.throttled);
  await expect(verifyButton(page)).toBeDisabled();
  await page.clock.fastForward(2_001);
  await expect(verifyButton(page)).toBeEnabled();
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
});

test('interrupted verification checks session before offering a new proof attempt', async ({ page, auth }) => {
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  let checks = 0;
  let mutations = 0;
  page.on('request', request => {
    if (request.url().endsWith('/api/v1/auth/session')) checks++;
    if (request.url().endsWith('/api/v1/auth/otp/verify')) mutations++;
  });
  await page.route('**/api/v1/auth/otp/verify', route => route.abort('connectionfailed'));
  await codeField(page).fill(challenge.code);
  await verifyButton(page).click();
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText('ورود تأیید نشد');
  expect(checks).toBeGreaterThan(0);
  expect(mutations).toBe(1);
  await expect(verifyButton(page)).toBeEnabled();
  await page.unroute('**/api/v1/auth/otp/verify');
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
});

test('unknown bootstrap never flashes authenticated controls', async ({ page, auth }) => {
  void auth;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/session', async route => { await pending; await route.continue(); });
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('در حال بررسی ورود');
  await expect(page.getByRole('link', { name: 'داشبورد', exact: true })).toHaveCount(0);
  await expect(logoutButton(page)).toHaveCount(0);
  release();
  await expect(page.getByRole('link', { name: /ورود/ })).toBeVisible();
});

test('public navigation and Back never restore a logged-out protected shell', async ({ page, auth, context }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /ورود/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  const challenge = await requestCode(page, auth);
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'داشبورد', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto('/dashboard');
  await logoutButton(other).click();
  await expect(other).toHaveURL(/\/login\?reason=signed-out$/);
  await page.bringToFront();
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await expect(logoutButton(page)).toHaveCount(0);
  await expect(mobileField(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await expect(page.getByRole('link', { name: /ورود/ })).toBeVisible();
  await expect(logoutButton(page)).toHaveCount(0);
  await other.close();
});

test('public navigation logout network failure remains explicit and retryable', async ({ page, auth }) => {
  await login(page, auth);
  await page.goto('/');
  await expect(logoutButton(page)).toBeVisible();
  await page.route('**/api/v1/auth/logout', route => route.abort('connectionfailed'));
  await logoutButton(page).click();
  await expect(page.locator('.logout-control').getByRole('alert')).toContainText('خروج تأیید نشد');
  await expect(page.getByRole('button', { name: 'تلاش دوباره برای خروج' })).toBeEnabled();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await page.unroute('**/api/v1/auth/logout');
  await page.getByRole('button', { name: 'تلاش دوباره برای خروج' }).click();
  await expect(page).toHaveURL(/\/login\?reason=signed-out$/);
});

test('consumed challenge resolves an already committed cookie session before continuing', async ({ page, auth, context }) => {
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  const committed = await context.request.post('http://127.0.0.1:3100/api/v1/auth/otp/verify', {
    headers: { Origin: 'http://127.0.0.1:3100', 'Content-Type': 'application/json', 'X-Rahrow-Auth': '1' },
    data: challenge,
  });
  expect(committed.status()).toBe(200);
  let sessionChecks = 0;
  page.on('request', request => { if (request.url().endsWith('/api/v1/auth/session')) sessionChecks++; });
  expect((await verifyCode(page, challenge.code)).status()).toBe(401);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(sessionChecks).toBeGreaterThan(0);
});

test('truncated verification body after real commit resolves session without replaying mutation', async ({ page, auth }) => {
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  let proofs = 0;
  let sessionChecks = 0;
  page.on('request', request => { if (request.url().endsWith('/api/v1/auth/session')) sessionChecks++; });
  await page.route('**/api/v1/auth/otp/verify', async route => {
    proofs++;
    // The actual Nest transaction commits and its HttpOnly cookie header reaches the browser.
    // Only the body is interrupted; the UI must resolve with a read instead of replaying proof.
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    await route.fulfill({ response: committed, body: '{"interrupted":' });
  });
  await codeField(page).fill(challenge.code);
  await verifyButton(page).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(proofs).toBe(1);
  expect(sessionChecks).toBeGreaterThan(0);
});

test('change number and guest refresh clear only the current page challenge context', async ({ page, auth }) => {
  await page.goto('/login');
  await requestCode(page, auth);
  await codeField(page).fill('001234');
  await page.getByRole('button', { name: 'تغییر شماره همراه', exact: true }).click();
  await expect(mobileField(page)).toBeFocused();
  await expect(codeField(page)).toHaveCount(0);
  await requestCode(page, auth);
  await page.reload();
  await expect(mobileField(page)).toHaveValue('');
  await expect(codeField(page)).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});

test('protected entry completes OTP and uses the approved destination with no challenge in history', async ({ page, auth }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: /ورود/ })).toBeVisible();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdashboard$/);
  const challenge = await requestCode(page, auth);
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
  await expect(page).toHaveURL('http://127.0.0.1:3100/dashboard');
  await page.goBack();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await expect(codeField(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'داشبورد', exact: true })).toBeVisible();
});


test('valid unavailable verification response blocks another proof until session uncertainty resolves', async ({ page, auth }) => {
  await page.goto('/login');
  const challenge = await requestCode(page, auth);
  auth.failNext('verifyOtp', 'AUTH_UNAVAILABLE');
  let proofs = 0;
  let sessionChecks = 0;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  page.on('request', request => { if (request.url().endsWith('/api/v1/auth/otp/verify')) proofs++; });
  await page.route('**/api/v1/auth/session', async route => {
    sessionChecks++;
    await pending;
    await route.continue();
  });
  expect((await verifyCode(page, challenge.code)).status()).toBe(503);
  await expect.poll(() => sessionChecks).toBe(1);
  await expect(codeField(page)).toBeDisabled();
  await expect(resendButton(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: 'تغییر شماره همراه', exact: true })).toBeDisabled();
  await expect(verifyButton(page)).toHaveCount(0);
  expect(proofs).toBe(1);
  release();
  await expect(page.locator('.auth-form form').getByRole('alert')).toContainText('ورود تأیید نشد');
  await expect(verifyButton(page)).toBeEnabled();
  expect(await codeField(page).inputValue() === challenge.code).toBe(true);
  expect(proofs).toBe(1);
  await page.unroute('**/api/v1/auth/session');
  expect((await verifyCode(page, challenge.code)).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
});
