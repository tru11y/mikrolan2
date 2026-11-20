'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/types';

type NavItem = { href: string; label: string; roles?: UserRole[] };
type NavGroup = { title?: string; items: NavItem[] };

const NAV: NavGroup[] = [
  {
    items: [
      { href: '/', label: 'Accueil' },
      { href: '/routeurs', label: 'Routeurs' },
      { href: '/tickets', label: 'Tickets' },
      { href: '/forfaits', label: 'Forfaits' },
      { href: '/sessions', label: 'Sessions' },
      { href: '/rapport', label: 'Rapport' },
      { href: '/analytics', label: 'Analytics' },
      { href: '/notifications', label: 'Notifications' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    title: 'Abonnement',
    items: [
      { href: '/abonnement', label: 'Mon abonnement' },
      { href: '/paiements', label: 'Paiements' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/admin/tenants', label: 'Tenants', roles: ['SUPER_ADMIN'] },
      { href: '/admin/abonnements', label: 'Abonnements', roles: ['SUPER_ADMIN'] },
      { href: '/admin/factures', label: 'Factures', roles: ['SUPER_ADMIN'] },
      { href: '/admin/flotte', label: 'Flotte', roles: ['SUPER_ADMIN'] },
      { href: '/admin/utilisateurs', label: 'Utilisateurs', roles: ['SUPER_ADMIN'] },
      { href: '/admin/wireguard', label: 'WireGuard', roles: ['SUPER_ADMIN'] },
      { href: '/admin/verificateurs', label: 'Vérificateurs', roles: ['ADMIN', 'SUPER_ADMIN'] },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { me, logout } = useAuth();
  const role = me?.role;

  function visible(item: NavItem): boolean {
    return !item.roles || (role != null && item.roles.includes(role));
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/20 text-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12.5a9 9 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0M11 18.5a1.5 1.5 0 0 1 2 0" strokeLinecap="round" />
          </svg>
        </div>
        <span className="font-bold">MikroLan</span>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {NAV.map((group, gi) => {
          const items = group.items.filter(visible);
          if (items.length === 0) return null;
          return (
            <div key={gi}>
              {group.title && <div className="px-2 pb-1.5 text-xs uppercase tracking-wide text-muted">{group.title}</div>}
              <div className="space-y-0.5">
                {items.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block rounded-lg px-3 py-2 text-sm transition ${
                        active ? 'bg-primary/15 text-primary' : 'text-fg/80 hover:bg-surface2'
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <div className="mb-2 px-2 text-xs text-muted">{me?.email}</div>
        <button onClick={() => void logout()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-fg/80 hover:bg-surface2">
          Déconnexion
        </button>
      </div>
    </aside>
  );
}
