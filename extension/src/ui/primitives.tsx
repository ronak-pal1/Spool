import { AnimatePresence, motion, type HTMLMotionProps } from 'framer-motion';
import { Check, ChevronDown, Loader2 } from 'lucide-react';
import { forwardRef, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export const spring = { type: 'spring', stiffness: 520, damping: 34, mass: 0.8 } as const;

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  children?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-foreground font-semibold shadow-[0_0_0_1px_rgba(0,250,154,0.5),0_8px_24px_-8px_rgba(0,250,154,0.6)] hover:bg-accent-300 hover:shadow-[0_0_0_1px_rgba(0,250,154,0.7),0_10px_32px_-6px_rgba(0,250,154,0.75)]',
  secondary: 'bg-white/[0.08] text-white hover:bg-white/[0.12] border border-white/10',
  ghost: 'text-white/70 hover:text-white hover:bg-white/[0.06]',
  subtle: 'bg-ink-700/80 text-white/80 hover:text-white hover:bg-ink-600 border border-white/[0.06]',
  danger: 'bg-danger/90 text-white hover:bg-danger font-semibold shadow-[0_8px_24px_-10px_rgba(255,92,108,0.7)]',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, leftIcon, className, children, disabled, type = 'button', ...props },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <motion.button
      ref={ref}
      type={type}
      whileTap={isDisabled ? undefined : { scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      disabled={isDisabled}
      className={cn(
        'relative inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,box-shadow,color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : leftIcon}
      {children}
    </motion.button>
  );
});

export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="relative flex h-7 w-7 items-center justify-center rounded-[9px] border border-white/10 bg-ink-800 shadow-[0_0_24px_-6px_rgba(0,250,154,0.6)]">
        <svg viewBox="0 0 32 32" className="h-[18px] w-[18px]" aria-hidden="true">
          <circle cx="16" cy="16" r="10" fill="none" stroke="#00FA9A" strokeWidth="3.2" />
          <circle cx="16" cy="16" r="3.6" fill="#00FA9A" />
        </svg>
      </span>
      {withWordmark && <span className="text-[15px] font-semibold tracking-tight text-white">Spool</span>}
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

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40',
        checked ? 'border-accent/60 bg-accent/90' : 'border-white/10 bg-white/[0.08]',
      )}
    >
      <motion.span
        layout
        transition={spring}
        className={cn('block h-4 w-4 rounded-full shadow-[0_2px_6px_rgba(0,0,0,0.4)]', checked ? 'ml-[18px] bg-accent-foreground' : 'ml-[3px] bg-white/80')}
      />
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
  size = 'md',
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  size?: 'md' | 'lg';
}) {
  const id = useId();
  return (
    <div role="radiogroup" className={cn('relative grid gap-1 rounded-xl border border-white/[0.07] bg-ink-950/60 p-1', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex items-center justify-center gap-1.5 rounded-[9px] font-medium transition-colors duration-150',
              size === 'lg' ? 'h-[58px] flex-col text-xs' : 'h-8 text-[13px]',
              selected ? 'text-white' : 'text-white/50 hover:text-white/80',
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${id}`}
                transition={spring}
                className="absolute inset-0 rounded-[9px] border border-white/10 bg-ink-700 shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_6px_16px_-8px_rgba(0,0,0,0.8)]"
              />
            )}
            <span className={cn('relative z-10 flex items-center', selected && option.icon ? 'text-accent' : undefined)}>{option.icon}</span>
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

/** Compact custom select that renders its menu inside the popup (native menus clip in extension popups). */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  icon,
  label,
}: {
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-white/[0.07] bg-ink-950/50 px-2.5 text-left text-[12.5px] text-white/80 transition-colors hover:border-white/15 hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40',
          open && 'border-white/15 bg-ink-800',
        )}
      >
        {icon && <span className="shrink-0 text-white/40">{icon}</span>}
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-52 origin-top overflow-y-auto rounded-xl border border-white/10 bg-ink-800/95 p-1 shadow-pop backdrop-blur-xl"
          >
            {options.length === 0 && <li className="px-2.5 py-2 text-xs text-white/40">No devices found</li>}
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-accent" />}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Field({
  label,
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | null }) {
  const id = useId();
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-xs font-medium text-white/55">{label}</span>
      <input
        id={id}
        {...props}
        className={cn(
          'h-10 w-full rounded-xl border bg-ink-950/60 px-3 text-sm text-white placeholder:text-white/25 transition-colors focus:border-accent/50 focus:outline-none focus:ring-2 focus:ring-accent/20',
          error ? 'border-danger/50' : 'border-white/[0.08] hover:border-white/15',
          props.className,
        )}
      />
    </label>
  );
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}` : (parts[0] ?? '?').slice(0, 2);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold uppercase text-ink-950"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}
    >
      {letters}
    </span>
  );
}
