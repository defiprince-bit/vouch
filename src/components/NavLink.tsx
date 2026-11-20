'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Props = { href: string; children: React.ReactNode; className?: string };

function linkClass(href: string, path: string | null, extra?: string) {
  // Exact match for "/", otherwise this section or a nested path (e.g. /pledges/abc).
  const current = !!path && (path === href || (href !== '/' && path.startsWith(href + '/')));
  return {
    className: `btn btn-ghost nav-link${current ? ' is-current' : ''}${extra ? ` ${extra}` : ''}`,
    current,
  };
}

function Current({ href, children, className }: Props) {
  const path = usePathname();
  const { className: cls, current } = linkClass(href, path, className);
  return (
    <Link className={cls} href={href} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}

/** Header link that marks the current section (the pathname streams in; prerender shows a plain link). */
export function NavLink(props: Props) {
  return (
    <Suspense fallback={<Link className={`btn btn-ghost nav-link${props.className ? ` ${props.className}` : ''}`} href={props.href}>{props.children}</Link>}>
      <Current {...props} />
    </Suspense>
  );
}
