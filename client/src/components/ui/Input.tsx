import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
  trailing?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, icon, trailing, invalid, ...props }, ref) {
  return (
    <div
      className={cn(
        'group relative flex h-10 items-center rounded-xl border bg-ink-800/80 transition-[border-color,box-shadow] duration-150 focus-within:border-accent/50 focus-within:shadow-[0_0_0_4px_rgba(0,250,154,0.08)]',
        invalid ? 'border-danger/60' : 'border-white/10 hover:border-white/15',
        className,
      )}
    >
      {icon && <span className="pointer-events-none pl-3 text-white/40 group-focus-within:text-accent/80">{icon}</span>}
      <input
        ref={ref}
        className="h-full w-full min-w-0 bg-transparent px-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        {...props}
      />
      {trailing && <span className="pr-2">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'w-full resize-none rounded-xl border border-white/10 bg-ink-800/80 px-3 py-2.5 text-sm text-white placeholder:text-white/30 transition-[border-color,box-shadow] hover:border-white/15 focus:border-accent/50 focus:shadow-[0_0_0_4px_rgba(0,250,154,0.08)] focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        className,
      )}
      {...props}
    />
  );
});

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[13px] font-medium text-white/75">{label}</span>
      {children}
      {error ? <span className="block text-xs text-danger">{error}</span> : hint ? <span className="block text-xs text-white/40">{hint}</span> : null}
    </label>
  );
}
