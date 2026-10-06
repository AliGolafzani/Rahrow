'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/** Auth boundaries use a new document, so App Router history cannot restore a cached private shell. */
export function DocumentLink({ href, children, className, 'aria-label': ariaLabel }:
  Readonly<{ href: '/' | '/login' | '/dashboard'; children: ReactNode; className?: string; 'aria-label'?: string }>) {
  return <Link href={href} prefetch={false} className={className} aria-label={ariaLabel}
    onNavigate={event => { event.preventDefault(); window.location.assign(href); }}>{children}</Link>;
}
