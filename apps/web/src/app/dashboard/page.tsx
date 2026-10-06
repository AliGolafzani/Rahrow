import type { Metadata } from 'next';
import { AuthProvider, LogoutButton, ProtectedSessionBoundary, SessionUnavailable } from '../../components/auth';
import { requireSession } from '../../lib/auth/server';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'حساب راهرو', robots: { index: false, follow: false } };
export default async function DashboardPage() {
  const state = await requireSession('/dashboard');
  return <AuthProvider initialState={state}>{state.status === 'authenticated' ?
    <ProtectedSessionBoundary><main className="dashboard-shell"><p className="eyebrow">راهرو / حساب شما</p><h1>به راهرو خوش آمدید</h1>
      <p>با موفقیت وارد شدید. داشبورد راهرو در حال آماده‌سازی است.</p><LogoutButton /></main></ProtectedSessionBoundary> : <SessionUnavailable />}</AuthProvider>;
}
