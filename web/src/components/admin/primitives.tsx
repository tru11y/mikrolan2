'use client';

import type {
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useAuth } from '@/lib/auth';
import type { UserRole } from '@/lib/types';
import { Loading } from '@/components/ui';
import type { StatusTone } from './types';

/** Garde de rôle : affiche un message « Accès refusé » si le rôle ne convient pas. */
export function AdminGuard({
  roles,
  children,
}: {
  roles: UserRole[];
  children: ReactNode;
}) {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me || !roles.includes(me.role)) {
    return (
      <div className="rounded-2xl border border-danger/40 bg-danger/10 p-10 text-center">
        <div className="text-lg font-semibold text-danger">Accès refusé</div>
        <div className="mt-1 text-sm text-muted">
          Cette section est réservée aux administrateurs de la plateforme.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[640px] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={`border-b border-border px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-border/60 px-4 py-3 align-middle text-fg ${className}`}>{children}</td>;
}

export function Tr({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <tr
      onClick={onClick}
      className={onClick ? 'cursor-pointer transition hover:bg-surface2' : ''}
    >
      {children}
    </tr>
  );
}

export function Select({
  label,
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm text-muted">{label}</span>}
      <select
        className={`w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none focus:border-primary ${className}`}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

export function Textarea({
  label,
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm text-muted">{label}</span>}
      <textarea
        className={`w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none placeholder:text-muted focus:border-primary ${className}`}
        {...rest}
      />
    </label>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-muted hover:bg-surface2 hover:text-fg"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'ACTIVE':
    case 'PAID':
    case 'ONLINE':
    case 'RESOLVED':
      return 'success';
    case 'SUSPENDED':
    case 'PAST_DUE':
    case 'PENDING':
    case 'DEGRADED':
    case 'STALE_24H':
      return 'warning';
    case 'DELETED':
    case 'CANCELED':
    case 'FAILED':
    case 'REVOKED':
    case 'ERROR':
    case 'OFFLINE':
    case 'NEVER_CONNECTED':
      return 'danger';
    case 'PRO':
      return 'primary';
    default:
      return 'muted';
  }
}
