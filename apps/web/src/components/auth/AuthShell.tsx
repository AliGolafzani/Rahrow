import type { ReactNode } from 'react';
import { DocumentLink } from './DocumentLink';

export function AuthShell({ children }: Readonly<{ children: ReactNode }>) {
  return <main className="auth-layout" dir="rtl">
    <aside className="auth-editorial" aria-label="ورود به راهرو">
      <DocumentLink href="/" className="brand-placement brand-placement-light" aria-label="راهرو، صفحه نخست">راهرو</DocumentLink>
      <div className="editorial-copy">
        <p className="eyebrow">ادامهٔ مسیر</p>
        <h2>قدم بعدی،<br /><span>از اینجا.</span></h2>
        <p>با شماره همراه وارد شوید<br className="desktop-break" /> و مسیرتان را ادامه دهید.</p>
      </div>
      <div className="editorial-wayfinding" aria-hidden="true"><span>راهرو</span><span className="wayfinding-line" /><span>۰۱</span></div>
    </aside>
    <section className="auth-content" aria-label="ورود و ثبت‌نام">
      <div className="auth-content-top"><span className="mobile-brand brand-placement">راهرو</span>
        <DocumentLink href="/" className="back-link">بازگشت به صفحه نخست <span aria-hidden="true">↖</span></DocumentLink>
      </div>
      <div className="auth-form-frame">{children}</div>
      <p className="auth-footer">راهرو <span aria-hidden="true">/</span> ورود امن با کد یک‌بارمصرف</p>
    </section>
  </main>;
}
