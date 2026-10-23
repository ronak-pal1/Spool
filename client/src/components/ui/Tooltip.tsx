import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  shortcut?: string;
  delay?: number;
}

export function Tooltip({ content, children, side = 'top', shortcut, delay = 350 }: TooltipProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>();
  const [rect, setRect] = useState<DOMRect | null>(null);

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (ref.current) setRect(ref.current.getBoundingClientRect());
    }, delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setRect(null);
  };

  return (
    <span ref={ref} className="inline-flex" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} onFocus={show} onBlur={hide}>
      {children}
      {createPortal(
        <AnimatePresence>
          {rect && (
            <motion.div
              key="tooltip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
              className="pointer-events-none fixed z-[100]"
              style={{
                left: rect.left + rect.width / 2,
                top: side === 'top' ? rect.top - 8 : rect.bottom + 8,
                transform: `translate(-50%, ${side === 'top' ? '-100%' : '0'})`,
              }}
            >
              <motion.div
                initial={{ y: side === 'top' ? 4 : -4, scale: 0.96 }}
                animate={{ y: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 600, damping: 36 }}
                className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-white/10 bg-ink-700/95 px-2.5 py-1.5 text-xs font-medium text-white/90 shadow-pop backdrop-blur-md"
              >
                {content}
                {shortcut && <kbd className="rounded bg-white/10 px-1.5 py-px font-mono text-2xs text-white/60">{shortcut}</kbd>}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
