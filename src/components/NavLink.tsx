'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Props = { href: string; children: React.ReactNode };

function Current({ href, children }: Props) {
  const path = usePathname();
  const current = path === href || path.startsWith(href + '/');
  return (
    <Link className={`btn btn-ghost nav-link${current ? ' is-current' : ''}`} href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Header link that marks the current section (the pathname streams in; prerender shows a plain link). */
export function NavLink(props: Props) {
  return (
    <Suspense fallback={<Link className="btn btn-ghost nav-link" href={props.href}>{props.children}</Link>}>
      <Current {...props} />
    </Suspense>
  );
}
