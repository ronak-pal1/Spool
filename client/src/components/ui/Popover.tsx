import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

interface PopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
  offset?: number;
}

interface Position {
  top: number;
  left: number;
  originY: 'top' | 'bottom';
}

/** Portal-mounted floating panel anchored to an element; escapes overflow-hidden ancestors. */
export function Popover({ anchorRef, open, onClose, children, align = 'end', side = 'bottom', className, offset = 8 }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = panel?.width ?? 220;
      const height = panel?.height ?? 200;
      let left = align === 'end' ? anchor.right - width : anchor.left;
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
      let top = side === 'bottom' ? anchor.bottom + offset : anchor.top - height - offset;
      let originY: Position['originY'] = side === 'bottom' ? 'top' : 'bottom';
      if (side === 'bottom' && top + height > window.innerHeight - 8 && anchor.top - height - offset > 8) {
        top = anchor.top - height - offset;
        originY = 'bottom';
      }
      if (side === 'top' && top < 8) {
        top = anchor.bottom + offset;
        originY = 'top';
      }
      setPosition({ top, left, originY });
    };
    update();
    const frame = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, align, side, offset]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, anchorRef]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.96, y: side === 'bottom' ? -4 : 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          style={{
            position: 'fixed',
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            transformOrigin: `${align === 'end' ? 'right' : 'left'} ${position?.originY ?? 'top'}`,
          }}
          className={cn('z-[90] rounded-xl border border-white/10 bg-ink-800/95 p-1 shadow-pop backdrop-blur-xl', className)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
