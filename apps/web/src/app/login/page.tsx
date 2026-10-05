import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm, AuthProvider, AuthShell, SessionUnavailable } from '../../components/auth';
import { resolveServerSession } from '../../lib/auth/server';
import { safeReturnTarget } from '../../lib/auth/return-target';
import { permittedReturnTarget } from '../../lib/auth/route-policy';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'ورود به راهرو', robots: { index: false, follow: false } };
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const returnTo = safeReturnTarget((await searchParams).returnTo);
  const state = await resolveServerSession();
  if (state.status === 'authenticated') redirect(await permittedReturnTarget(returnTo, { authenticated: true }));
  return <AuthProvider initialState={state}>{state.status === 'guest' ? <AuthShell><AuthForm returnTo={returnTo} /></AuthShell> : <SessionUnavailable />}</AuthProvider>;
}
