'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { requestOtp, verifyOtp } from '../../lib/auth/client';
import { authErrorMessage, type AuthFailure } from '../../lib/auth/errors';
import { activeChallenge, completeAuthPath, normalizeMobileInput, isOtpCode, remainingSeconds, verificationNeedsSessionResolution, type ActiveChallenge } from '../../lib/auth/state';
import { useAuth } from './AuthProvider';

type PendingAction = 'request' | 'resend' | 'verify' | 'resolve' | null;
const persianNumber = new Intl.NumberFormat('fa-IR', { useGrouping: false });

export function AuthForm({ returnTo }: Readonly<{ returnTo: string }>) {
  const { state, revalidate, announceAuthentication } = useAuth();
  const prefix = useId();
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<ActiveChallenge | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<'mobile' | 'code' | null>(null);
  const [status, setStatus] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [verifyRetryAt, setVerifyRetryAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [needsSessionCheck, setNeedsSessionCheck] = useState(false);
  const [challengeBlocked, setChallengeBlocked] = useState(false);
  const mobileInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<PendingAction>(null);
  const generation = useRef(0);
  const mounted = useRef(false);
  const navigating = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const retrySeconds = remainingSeconds(Math.max(retryAt, challenge?.retryAt ?? 0), now);
  const verifyRetrySeconds = remainingSeconds(verifyRetryAt, now);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (retrySeconds === 0 && verifyRetrySeconds === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [retrySeconds, verifyRetrySeconds]);

  useEffect(() => {
    if (challenge) codeInput.current?.focus();
  }, [challenge]);

  useEffect(() => {
    if (state.status === 'authenticated' && !navigating.current) {
      navigating.current = true;
      window.location.replace(completeAuthPath(returnTo));
    }
  }, [state.status, returnTo]);

  function enter() {
    if (navigating.current) return;
    navigating.current = true;
    announceAuthentication();
    setStatus('ورود تأیید شد. در حال ادامه…');
    window.location.replace(completeAuthPath(returnTo));
  }

  function begin(action: PendingAction): number | null {
    if (pendingRef.current || navigating.current) return null;
    pendingRef.current = action;
    setPending(action);
    setError(null);
    setInvalidField(null);
    setStatus('');
    controller.current = new AbortController();
    return ++generation.current;
  }

  function isCurrent(requestGeneration: number): boolean {
    return mounted.current && generation.current === requestGeneration && !navigating.current;
  }

  function finish(requestGeneration: number) {
    if (!isCurrent(requestGeneration)) return;
    pendingRef.current = null;
    setPending(null);
  }

  function showFailure(failure: AuthFailure, operation: 'request' | 'verify' = 'request') {
    setError(authErrorMessage(failure));
    if (failure.retryAfterSeconds !== undefined) {
      const timestamp = Date.now();
      setNow(timestamp);
      if (operation === 'verify') setVerifyRetryAt(timestamp + failure.retryAfterSeconds * 1_000);
      else setRetryAt(timestamp + failure.retryAfterSeconds * 1_000);
    }
  }

  async function sendCode(resend: boolean) {
    if (remainingSeconds(Math.max(retryAt, challenge?.retryAt ?? 0), Date.now()) > 0) return;
    const targetMobile = resend && challenge ? challenge.mobile : normalizeMobileInput(mobile);
    if (targetMobile === null) {
      setError('شماره همراه معتبر وارد کنید؛ مثلاً 09121234567، با اعداد انگلیسی.');
      setInvalidField('mobile');
      mobileInput.current?.focus();
      return;
    }
    const requestGeneration = begin(resend ? 'resend' : 'request');
    if (requestGeneration === null) return;
    const result = await requestOtp({ mobile: targetMobile }, controller.current?.signal);
    if (!isCurrent(requestGeneration)) return;
    if (result.ok) {
      const timestamp = Date.now();
      // An accepted resend only replaces this screen's active challenge. It does not revoke old ones.
      setChallenge(activeChallenge(result.value, targetMobile, timestamp));
      setCode('');
      setChallengeBlocked(false);
      setNeedsSessionCheck(false);
      setRetryAt(0);
      setVerifyRetryAt(0);
      setNow(timestamp);
      setStatus(resend ? 'کد جدید ارسال شد. کد جدید را وارد کنید.' : 'کد ورود ارسال شد. پیامک خود را بررسی کنید.');
    } else {
      // Failed resends deliberately retain the active challenge and every entered code digit.
      showFailure(result.error);
    }
    finish(requestGeneration);
  }

  async function resolveVerification(requestGeneration: number, consumed: boolean) {
    pendingRef.current = 'resolve';
    setPending('resolve');
    setNeedsSessionCheck(true);
    setStatus('در حال بررسی وضعیت ورود…');
    const session = await revalidate(true);
    if (!isCurrent(requestGeneration)) return;
    if (session.status === 'authenticated') { enter(); return; }
    setStatus('');
    if (session.status === 'guest') {
      setNeedsSessionCheck(false);
      setError(consumed ? 'این کد قبلاً استفاده شده است. کد جدید بگیرید.' :
        'ورود تأیید نشد. می‌توانید کد را دوباره بررسی و ارسال کنید.');
    } else {
      setError('نتیجهٔ ورود هنوز روشن نیست. پیش از تلاش دوباره، وضعیت ورود را بررسی کنید.');
    }
    finish(requestGeneration);
  }

  async function confirmCode() {
    if (!challenge || needsSessionCheck || challengeBlocked || remainingSeconds(verifyRetryAt, Date.now()) > 0) return;
    if (!isOtpCode(code)) {
      setError('کد ۶ رقمی پیامک را با اعداد انگلیسی وارد کنید.');
      setInvalidField('code');
      requestAnimationFrame(() => codeInput.current?.focus());
      return;
    }
    const requestGeneration = begin('verify');
    if (requestGeneration === null) return;
    const result = await verifyOtp({ mobile: challenge.mobile, challengeId: challenge.challengeId, code }, controller.current?.signal);
    if (!isCurrent(requestGeneration)) return;
    if (result.ok) { enter(); return; }
    const consumed = result.error.code === 'AUTH_OTP_CONSUMED';
    if (consumed) { setChallengeBlocked(true); setInvalidField('code'); }
    if (verificationNeedsSessionResolution(result.error)) {
      await resolveVerification(requestGeneration, consumed);
      return;
    }
    showFailure(result.error, 'verify');
    if (result.error.code === 'AUTH_OTP_EXPIRED' || result.error.code === 'AUTH_OTP_EXHAUSTED') {
      setChallengeBlocked(true);
      setInvalidField('code');
    }
    if (result.error.code === 'AUTH_OTP_INVALID' || result.error.code === 'AUTH_INVALID_INPUT') {
      setInvalidField('code');
      requestAnimationFrame(() => codeInput.current?.focus());
    }
    finish(requestGeneration);
  }

  async function retrySession() {
    const requestGeneration = begin('resolve');
    if (requestGeneration !== null) await resolveVerification(requestGeneration, challengeBlocked);
  }

  function changeMobile() {
    if (pendingRef.current || needsSessionCheck) return;
    generation.current += 1;
    controller.current?.abort();
    setChallenge(null);
    setCode('');
    setError(null);
    setInvalidField(null);
    setStatus('شماره همراه را ویرایش کنید.');
    setRetryAt(0);
    setVerifyRetryAt(0);
    setNeedsSessionCheck(false);
    setChallengeBlocked(false);
    requestAnimationFrame(() => mobileInput.current?.focus());
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (challenge) void confirmCode();
    else void sendCode(false);
  }

  return <div className="auth-form" dir="rtl">
    <ol className="auth-steps" aria-label="مراحل ورود">
      <li className={!challenge ? 'current' : 'complete'} aria-current={!challenge ? 'step' : undefined}>
        <span className="step-number" aria-hidden="true">۰۱</span><span>شماره همراه</span>
      </li>
      <li className={challenge ? 'current' : ''} aria-current={challenge ? 'step' : undefined}>
        <span className="step-number" aria-hidden="true">۰۲</span><span>تأیید کد</span>
      </li>
    </ol>
    <div className="form-intro">
      <p className="eyebrow">ورود / ثبت‌نام</p>
      <h1>{challenge ? 'پیامک را بررسی کنید' : 'به راهرو خوش آمدید'}</h1>
      {challenge ? <p>کد فرستاده‌شده به <bdi className="mobile-value" dir="ltr">{challenge.mobile}</bdi> را وارد کنید.</p> :
        <p>شماره همراهتان را وارد کنید.<br />با یک کد، وارد حساب شوید یا حساب بسازید.</p>}
    </div>
    <form onSubmit={onSubmit} noValidate aria-busy={pending !== null}>
      {!challenge ? <div className="form-field">
        <label htmlFor={`${prefix}-mobile`}>شماره همراه</label>
        <input ref={mobileInput} id={`${prefix}-mobile`} name="mobile" type="tel" inputMode="tel" dir="ltr"
          autoComplete="tel" placeholder="09121234567" maxLength={64} required value={mobile}
          disabled={pending !== null} aria-invalid={invalidField === 'mobile'}
          aria-describedby={`${prefix}-mobile-help${invalidField === 'mobile' ? ` ${prefix}-error` : ''}`}
          onChange={event => { setMobile(event.target.value); setInvalidField(null); setError(null); }} />
        <p id={`${prefix}-mobile-help`} className="field-hint">شماره همراهتان را وارد کنید؛ مثلاً 09121234567</p>
      </div> : <div className="form-field">
        <div className="field-label-row"><label htmlFor={`${prefix}-code`}>کد یک‌بارمصرف</label>
          <button className="text-button" type="button" onClick={changeMobile} disabled={pending !== null || needsSessionCheck}>تغییر شماره همراه</button>
        </div>
        <input ref={codeInput} id={`${prefix}-code`} className="otp-input" name="code" type="text" inputMode="numeric"
          autoComplete="one-time-code" dir="ltr" pattern="[0-9]{6}" maxLength={6} required placeholder="------"
          value={code} disabled={pending !== null || needsSessionCheck || challengeBlocked}
          aria-invalid={invalidField === 'code'} aria-describedby={`${prefix}-code-help ${prefix}-code-expiry${error ? ` ${prefix}-error` : ''}`}
          onChange={event => { setCode(event.target.value); setInvalidField(null); setError(null); }} />
        <p id={`${prefix}-code-help`} className="field-hint">کد ۶ رقمی، با اعداد انگلیسی</p>
        <p id={`${prefix}-code-expiry`} className="field-hint">مهلت اعلام‌شدهٔ کد: تا ساعت <time dateTime={challenge.expiresAt}>
          {new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(new Date(challenge.expiresAt))}
        </time></p>
      </div>}
      <div className="form-feedback">
        {error && <p id={`${prefix}-error`} className="form-error" role="alert">{error}</p>}
        <p className="form-status" role="status" aria-live="polite" aria-atomic="true">{status ||
          (pending === 'request' || pending === 'resend' ? 'در حال ارسال کد…' : pending === 'verify' ? 'در حال بررسی کد…' : '')}</p>
      </div>
      {needsSessionCheck ? <button className="button button-primary" type="button" onClick={() => void retrySession()} disabled={pending !== null}>
        {pending === 'resolve' ? 'در حال بررسی…' : 'بررسی وضعیت ورود'}
      </button> : <button className="button button-primary" type="submit"
        disabled={pending !== null || (challenge ? challengeBlocked || verifyRetrySeconds > 0 : retrySeconds > 0)}>
        <span>{pending === 'request' ? 'در حال ارسال…' : pending === 'verify' ? 'در حال بررسی…' : challenge ? 'تأیید و ورود' : 'دریافت کد ورود'}</span>
        <span aria-hidden="true">←</span>
      </button>}
      {verifyRetrySeconds > 0 && <p className="retry-hint">بررسی دوبارهٔ کد تا {persianNumber.format(verifyRetrySeconds)} ثانیه دیگر</p>}
      {challenge && <div className="resend-row"><span className="field-hint">کد را دریافت نکردید؟</span>
        <button className="text-button" type="button" onClick={() => void sendCode(true)}
          disabled={pending !== null || retrySeconds > 0 || needsSessionCheck}>ارسال دوباره کد</button>
      </div>}
      {retrySeconds > 0 && <p className="retry-hint">تلاش دوباره تا {persianNumber.format(retrySeconds)} ثانیه دیگر</p>}
    </form>
    <p className="auth-footnote">برای ورود و ساخت حساب، همین شماره همراه کافی است.</p>
  </div>;
}
