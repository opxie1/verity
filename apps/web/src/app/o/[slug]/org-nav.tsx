'use client';

import type { OrgRoleValue } from '@verity/schemas';
import { cn } from '@verity/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  roles?: OrgRoleValue[];
}

export function OrgNav({ slug, role }: { slug: string; role: OrgRoleValue }) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: `/o/${slug}`, label: 'Dashboard' },
    { href: `/o/${slug}/audit`, label: 'Audit log', roles: ['ORG_ADMIN', 'AUDITOR'] },
    { href: `/o/${slug}/members`, label: 'Members', roles: ['ORG_ADMIN'] },
    { href: `/o/${slug}/settings`, label: 'Settings', roles: ['ORG_ADMIN'] },
    { href: '/security', label: 'Passkeys' },
  ];

  // Hiding a link is a convenience, not a control: the server rejects the
  // request regardless of what the interface chose to render.
  const visible = items.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <nav aria-label="Organization" className="mx-auto max-w-6xl px-4">
      <ul className="flex gap-1 text-sm">
        {visible.map((item) => {
          const active = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-block border-b-2 px-3 py-2 font-medium',
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
