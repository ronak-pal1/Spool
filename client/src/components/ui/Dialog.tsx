import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  hideClose?: boolean;
}

const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Dialog({ open, onClose, title, description, children, footer, className, size = 'md', hideClose }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const timer = window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not([data-close])');
      focusable?.focus();
    }, 50);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cn(
              'relative w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-850/95 shadow-pop backdrop-blur-xl',
              widths[size],
              className,
            )}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            {(title || !hideClose) && (
              <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
                <div className="space-y-1">
                  {title && <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>}
                  {description && <p className="text-sm text-white/50">{description}</p>}
                </div>
                {!hideClose && (
                  <button
                    data-close
                    onClick={onClose}
                    className="-mr-2 rounded-lg p-1.5 text-white/40 transition hover:bg-white/5 hover:text-white"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            <div className="px-6 pb-6 pt-2">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] bg-ink-900/40 px-6 py-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
