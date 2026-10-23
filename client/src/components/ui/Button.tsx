import { motion, type HTMLMotionProps } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-foreground font-semibold shadow-[0_0_0_1px_rgba(0,250,154,0.5),0_8px_24px_-8px_rgba(0,250,154,0.6)] hover:bg-accent-300 hover:shadow-[0_0_0_1px_rgba(0,250,154,0.7),0_10px_32px_-6px_rgba(0,250,154,0.75)]',
  secondary: 'bg-white/[0.08] text-white hover:bg-white/[0.12] border border-white/10',
  outline: 'border border-white/15 text-white/90 hover:border-white/25 hover:bg-white/[0.04]',
  ghost: 'text-white/70 hover:text-white hover:bg-white/[0.06]',
  subtle: 'bg-ink-700/80 text-white/80 hover:text-white hover:bg-ink-600 border border-white/[0.06]',
  danger: 'bg-danger/90 text-white hover:bg-danger font-semibold shadow-[0_8px_24px_-10px_rgba(255,92,108,0.7)]',
};

const sizes: Record<Size, string> = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-lg',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-10 w-10 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, leftIcon, rightIcon, className, children, disabled, type = 'button', ...props },
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
      {!loading && rightIcon}
    </motion.button>
  );
});
