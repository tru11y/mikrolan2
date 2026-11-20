'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-surface p-5 ${className}`}>{children}</div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-fg">{value}</div>
      {sub != null && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
};
export function Button({ variant = 'primary', loading, children, className = '', disabled, ...rest }: BtnProps) {
  const styles: Record<string, string> = {
    primary: 'bg-primary hover:bg-primary-dim text-white',
    ghost: 'bg-surface2 hover:bg-border text-fg border border-border',
    danger: 'bg-danger/90 hover:bg-danger text-white',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Spinner size={16} />}
      {children}
    </button>
  );
}

export function Input({ label, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm text-muted">{label}</span>}
      <input
        className={`w-full rounded-xl border border-border bg-surface2 px-3.5 py-2.5 text-fg outline-none placeholder:text-muted focus:border-primary ${className}`}
        {...rest}
      />
    </label>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'success' | 'warning' | 'danger' | 'muted' | 'primary'; children: ReactNode }) {
  const tones: Record<string, string> = {
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    danger: 'bg-danger/15 text-danger',
    primary: 'bg-primary/15 text-primary',
    muted: 'bg-border text-muted',
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Dot({ online }: { online: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${online ? 'bg-success' : 'bg-warning'}`} />;
}

export function Spinner({ size = 24 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-border border-t-primary"
      style={{ width: size, height: size }}
    />
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-2xl font-bold text-fg">{title}</h1>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted">{children}</div>;
}

export function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{message}</div>;
}
