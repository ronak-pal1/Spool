import { initials } from '@spool/shared';
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-40',
        checked ? 'border-accent/60 bg-accent/90 shadow-[0_0_16px_-4px_rgba(0,250,154,0.8)]' : 'border-white/10 bg-white/10',
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 700, damping: 35 }}
        className={cn('h-4 w-4 rounded-full shadow', checked ? 'ml-[20px] bg-accent-foreground' : 'ml-[3px] bg-white')}
      />
    </button>
  );
}

export function Avatar({ name, color, size = 28, className }: { name: string; color: string; size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-ink-900', className)}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: `linear-gradient(135deg, ${color}, ${color}B3)`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.08), 0 4px 14px -4px ${color}80`,
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

type BadgeTone = 'neutral' | 'accent' | 'warn' | 'danger' | 'info';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.06] text-white/65 border-white/10',
  accent: 'bg-accent/10 text-accent border-accent/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  info: 'bg-sky-400/10 text-sky-300 border-sky-400/25',
};

export function Badge({ tone = 'neutral', children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-white/[0.04]', className)}>
      <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.05] px-1.5 font-mono text-2xs text-white/55', className)}>
      {children}
    </kbd>
  );
}

export function EmptyState({ icon, title, description, action, className }: { icon: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-2xl bg-accent/20 blur-2xl" />
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-ink-800 text-accent shadow-card">{icon}</div>
      </div>
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-white/50">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span className="relative flex h-8 w-8 items-center justify-center rounded-[10px] border border-white/10 bg-ink-800 shadow-[0_0_24px_-6px_rgba(0,250,154,0.6)]">
        <svg viewBox="0 0 32 32" className="h-5 w-5">
          <circle cx="16" cy="16" r="10" fill="none" stroke="#00FA9A" strokeWidth="3.2" />
          <circle cx="16" cy="16" r="3.6" fill="#00FA9A" />
        </svg>
      </span>
      {withWordmark && <span className="text-[17px] font-semibold tracking-tight text-white">Spool</span>}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex h-5 w-5', className)}>
      <span className="absolute inset-0 rounded-full border-2 border-white/10" />
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-accent" />
    </span>
  );
}
