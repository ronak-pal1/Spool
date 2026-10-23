import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from './lib/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-ink-800 shadow-glow', className)}>
      <span className="absolute inset-1.5 rounded-full border border-accent/80" />
      <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_rgba(0,250,154,0.8)]" />
    </span>
  );
}

export function Button({
  children,
  className,
  variant = 'ghost',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-accent text-accent-foreground hover:bg-accent/90',
        variant === 'ghost' && 'bg-white/5 text-white/80 hover:bg-white/10',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[11px] text-white/50">
      <span className="font-medium uppercase tracking-wider">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-accent/50',
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-accent/50',
        props.className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex rounded-xl bg-black/30 p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={clsx(
            'flex-1 rounded-lg px-3 py-1.5 text-sm transition',
            value === option.id ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(0,250,154,0.35)]' : 'text-white/50 hover:text-white/80',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-6 w-11 rounded-full transition', checked ? 'bg-accent' : 'bg-white/15')}
    >
      <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition', checked ? 'left-5' : 'left-0.5')} />
    </button>
  );
}
