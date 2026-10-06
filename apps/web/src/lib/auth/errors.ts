import type { AuthErrorCode } from '@rahrow/contracts';

/** Only this bounded vocabulary is shown. Upstream messages never enter the UI. */
export const AUTH_ERROR_MESSAGES: Readonly<Record<AuthErrorCode, string>> = {
  AUTH_INVALID_INPUT: 'اطلاعات واردشده را بررسی کنید.',
  AUTH_REQUEST_FORBIDDEN: 'درخواست ورود پذیرفته نشد. صفحه را تازه کنید و دوباره تلاش کنید.',
  AUTH_THROTTLED: 'درخواست‌های زیادی فرستاده‌اید. کمی صبر کنید و دوباره تلاش کنید.',
  AUTH_OTP_INVALID: 'کد واردشده درست نیست. دوباره بررسی کنید.',
  AUTH_OTP_EXPIRED: 'زمان استفاده از این کد تمام شده است. کد جدید بگیرید.',
  AUTH_OTP_EXHAUSTED: 'تعداد تلاش‌های این کد به پایان رسیده است. کد جدید بگیرید.',
  AUTH_OTP_CONSUMED: 'این کد قبلاً استفاده شده است. وضعیت ورود را بررسی کنید یا کد جدید بگیرید.',
  AUTH_SESSION_INVALID: 'برای ادامه، دوباره وارد شوید.',
  AUTH_SESSION_EXPIRED: 'نشست شما به پایان رسیده است. دوباره وارد شوید.',
  AUTH_DELIVERY_UNAVAILABLE: 'در حال حاضر ارسال پیامک ممکن نیست. کمی بعد دوباره تلاش کنید.',
  AUTH_UNAVAILABLE: 'در حال حاضر ارتباط با سرویس ورود برقرار نیست. دوباره تلاش کنید.',
};

export interface AuthFailure {
  code: AuthErrorCode;
  status: number | null;
  retryAfterSeconds?: number;
  /** The mutation may have committed. Resolve the session before another verification. */
  interrupted: boolean;
}

export function authErrorMessage(failure: Pick<AuthFailure, 'code'>): string {
  return AUTH_ERROR_MESSAGES[failure.code];
}

export function isGuestFailure(failure: AuthFailure): boolean {
  return failure.status === 401 &&
    (failure.code === 'AUTH_SESSION_INVALID' || failure.code === 'AUTH_SESSION_EXPIRED');
}
