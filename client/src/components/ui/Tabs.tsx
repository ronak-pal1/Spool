import { motion } from 'framer-motion';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** Underlined tab bar with a shared-layout indicator that springs between tabs. */
export function Tabs<T extends string>({ items, value, onChange, className }: TabsProps<T>) {
  const id = useId();
  return (
    <div role="tablist" className={cn('relative flex items-center gap-1 border-b border-white/[0.07] px-2', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative flex h-11 items-center gap-2 px-3 text-[13px] font-medium transition-colors',
              active ? 'text-white' : 'text-white/45 hover:text-white/75',
            )}
          >
            <span className={cn('transition-colors', active ? 'text-accent' : '')}>{item.icon}</span>
            {item.label}
            {item.badge}
            {active && (
              <motion.span
                layoutId={`tab-indicator-${id}`}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-accent shadow-[0_0_12px_rgba(0,250,154,0.8)]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
}

/** Pill segmented control with a sliding thumb. */
export function Segmented<T extends string>({ options, value, onChange, size = 'md', className }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className={cn('inline-flex rounded-xl border border-white/[0.07] bg-ink-800/80 p-1', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3.5 text-[13px]',
              active ? 'text-white' : 'text-white/45 hover:text-white/75',
            )}
          >
            {active && (
              <motion.span
                layoutId={`segment-${id}`}
                className="absolute inset-0 rounded-lg border border-white/10 bg-white/[0.09] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                transition={{ type: 'spring', stiffness: 500, damping: 36 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.icon}
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
