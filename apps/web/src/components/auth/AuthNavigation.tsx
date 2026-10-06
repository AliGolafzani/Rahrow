'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { AUTH_ERROR_MESSAGES } from '../../lib/auth/errors';
import { useAuth } from './AuthProvider';
import { DocumentLink } from './DocumentLink';

export function LogoutButton() {
  const errorId = useId();
  const { state, logoutFailed, signOut } = useAuth();
  const pending = useRef(false);
  const handleLogout = async () => {
    if (pending.current) return;
    pending.current = true;
    await signOut();
    pending.current = false;
  };
  return <div className="logout-control">
    <button type="button" className="button button-quiet" onClick={() => void handleLogout()}
      disabled={state.status === 'signing-out'} aria-describedby={logoutFailed ? errorId : undefined}>
      {state.status === 'signing-out' ? 'در حال خروج…' : logoutFailed ? 'تلاش دوباره برای خروج' : 'خروج از حساب'}
    </button>
    {logoutFailed && <p id={errorId} className="inline-error" role="alert">خروج تأیید نشد. دوباره تلاش کنید.</p>}
  </div>;
}

export function AuthNavigation() {
  const { state, logoutFailed, revalidate } = useAuth();
  return <header className="site-header">
    <DocumentLink href="/" className="brand-placement" aria-label="راهرو، صفحه نخست">راهرو</DocumentLink>
    <nav className="auth-navigation" aria-label="حساب کاربری">
      {state.status === 'authenticated' && <><DocumentLink className="text-link" href="/dashboard">داشبورد</DocumentLink><LogoutButton /></>}
      {state.status === 'guest' && <DocumentLink className="button button-small" href="/login">ورود / ثبت‌نام</DocumentLink>}
      {state.status === 'unknown' && <span className="nav-status" role="status">در حال بررسی ورود…</span>}
      {state.status === 'signing-out' && <span className="nav-status" role="status">در حال خروج…</span>}
      {state.status === 'temporarily-unavailable' && <><button className="button button-quiet" type="button"
        onClick={() => void revalidate()}>بررسی وضعیت ورود</button>{logoutFailed && <LogoutButton />}</>}
    </nav>
  </header>;
}

export function SessionUnavailable() {
  const { state, revalidate } = useAuth();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const retry = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const result = await revalidate(true);
    if (result.status === 'authenticated' || result.status === 'guest') {
      // Refresh the server-rendered branch only after a conclusive fresh session read.
      window.location.reload();
      return;
    }
    pendingRef.current = false;
    setPending(false);
  };
  const message = state.status === 'temporarily-unavailable' && state.errorCode ?
    AUTH_ERROR_MESSAGES[state.errorCode] : AUTH_ERROR_MESSAGES.AUTH_UNAVAILABLE;
  return <main className="session-notice" aria-labelledby="session-unavailable-title">
    <p className="eyebrow">ارتباط موقتاً برقرار نیست</p>
    <h1 id="session-unavailable-title">وضعیت ورود روشن نیست</h1>
    <p role="status">{message}</p>
    <button className="button button-primary" type="button" onClick={() => void retry()} disabled={pending}>
      {pending ? 'در حال بررسی…' : 'بررسی دوباره'}
    </button>
  </main>;
}

/** Hides the private shell during fresh checks and uncertain failures, including BFCache restores. */
export function ProtectedSessionBoundary({ children }: Readonly<{ children: ReactNode }>) {
  const { state } = useAuth();
  if (state.status === 'authenticated') return children;
  if (state.status === 'temporarily-unavailable') return <div className="protected-session-notice">
    <SessionUnavailable /><LogoutButton />
  </div>;
  return <main className="session-notice"><p role="status" aria-live="polite">
    {state.status === 'signing-out' ? 'در حال خروج…' : state.status === 'guest' ? 'در حال بازگشت به ورود…' : 'در حال بررسی وضعیت ورود…'}
  </p></main>;
}
