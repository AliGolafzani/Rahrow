'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getSession, logout, rotateSession } from '../../lib/auth/client';
import { isGuestFailure, type AuthFailure } from '../../lib/auth/errors';
import type { AuthState } from '../../lib/auth/state';

interface AuthContextValue {
  state: AuthState;
  logoutFailed: boolean;
  revalidate: (fresh?: boolean) => Promise<AuthState>;
  signOut: () => Promise<boolean>;
  rotate: () => Promise<AuthState>;
  announceAuthentication: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function unavailableState(error: AuthFailure): AuthState {
  return { status: 'temporarily-unavailable', errorCode: error.code,
    ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }) };
}

export function AuthProvider({ children, initialState = { status: 'unknown' } }:
  Readonly<{ children: ReactNode; initialState?: AuthState }>) {
  const [state, setState] = useState<AuthState>(initialState);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const stateRef = useRef(state);
  const generation = useRef(0);
  const mounted = useRef(false);
  const readPending = useRef<Promise<AuthState> | null>(null);
  const mutationPending = useRef(false);
  const signingOutRedirect = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const apply = useCallback((next: AuthState) => {
    stateRef.current = next;
    if (mounted.current) setState(next);
    return next;
  }, []);

  const revalidate = useCallback((fresh = false): Promise<AuthState> => {
    if (mutationPending.current) return Promise.resolve(stateRef.current);
    if (readPending.current && !fresh) return readPending.current;
    const requestGeneration = ++generation.current;
    apply({ status: 'unknown' });
    const task = (async () => {
      const result = await getSession();
      if (!mounted.current || generation.current !== requestGeneration) return stateRef.current;
      const next: AuthState = result.ok ? { status: 'authenticated', expiresAt: result.value.session.expiresAt } :
        isGuestFailure(result.error) ? { status: 'guest' } : unavailableState(result.error);
      apply(next);
      return next;
    })();
    readPending.current = task;
    void task.finally(() => { if (readPending.current === task) readPending.current = null; });
    return task;
  }, [apply]);

  const announceAuthentication = useCallback(() => {
    // No account, challenge, code, cookie, or expiry is broadcast or put in browser storage.
    channel.current?.postMessage('session-changed');
  }, []);

  const signOut = useCallback(async (): Promise<boolean> => {
    if (mutationPending.current) return false;
    mutationPending.current = true;
    const requestGeneration = ++generation.current;
    readPending.current = null;
    setLogoutFailed(false);
    apply({ status: 'signing-out' });
    const result = await logout();
    if (!mounted.current || generation.current !== requestGeneration) return false;
    mutationPending.current = false;
    if (!result.ok) {
      // The original button is hidden during sign-out. Keep the failure above that remount boundary.
      setLogoutFailed(true);
      apply(unavailableState(result.error));
      return false;
    }
    // Only a validated 204 is logout success. Ambiguous failures retain an unavailable state.
    signingOutRedirect.current = true;
    apply({ status: 'guest' });
    setLogoutFailed(false);
    announceAuthentication();
    window.location.replace('/login?reason=signed-out');
    return true;
  }, [announceAuthentication, apply]);

  const rotate = useCallback(async (): Promise<AuthState> => {
    if (mutationPending.current) return stateRef.current;
    mutationPending.current = true;
    const requestGeneration = ++generation.current;
    readPending.current = null;
    const result = await rotateSession();
    if (!mounted.current || generation.current !== requestGeneration) return stateRef.current;
    mutationPending.current = false;
    if (result.ok) {
      announceAuthentication();
      return apply({ status: 'authenticated', expiresAt: result.value.session.expiresAt });
    }
    // Never replay a possibly committed rotation. A read resolves its outcome instead.
    if (result.error.interrupted) return revalidate();
    return apply(isGuestFailure(result.error) ? { status: 'guest' } : unavailableState(result.error));
  }, [announceAuthentication, apply, revalidate]);

  useEffect(() => {
    // Only a fresh server answer can put state into guest. Messages and clocks cannot.
    if (state.status === 'guest' && !signingOutRedirect.current && window.location.pathname === '/dashboard') {
      window.location.replace('/login?returnTo=%2Fdashboard');
    }
  }, [state.status]);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => { if (document.visibilityState === 'visible') void revalidate(); };
    const pageShown = (event: PageTransitionEvent) => { if (event.persisted) void revalidate(); };
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('rahrow-session');
      channel.current.onmessage = event => { if (event.data === 'session-changed') void revalidate(); };
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', pageShown);
    if (stateRef.current.status === 'unknown') void revalidate();
    return () => {
      mounted.current = false;
      generation.current += 1;
      readPending.current = null;
      channel.current?.close();
      channel.current = null;
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', pageShown);
    };
  }, [revalidate]);

  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const delay = Date.parse(state.expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) return;
    // Expiry is only a cue to ask the server; it never authenticates or locally revokes a session.
    const timer = setTimeout(() => void revalidate(), Math.min(delay + 100, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [state, revalidate]);

  return <AuthContext.Provider value={{ state, logoutFailed, revalidate, signOut, rotate, announceAuthentication }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required.');
  return context;
}
