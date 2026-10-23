import type { BlurRegion } from '@spool/shared';
import { AnimatePresence, motion } from 'framer-motion';

/** Privacy blur boxes, rendered inside the zoom stage so they track the content under the camera. */
export function BlurOverlays({ blurs }: { blurs: BlurRegion[] }) {
  return (
    <AnimatePresence>
      {blurs.map((blur) => {
        const radius = 4 + blur.intensity * 2.6;
        return (
          <motion.div
            key={blur.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="pointer-events-none absolute overflow-hidden rounded-[3px]"
            style={{
              left: `${blur.rect.x * 100}%`,
              top: `${blur.rect.y * 100}%`,
              width: `${blur.rect.width * 100}%`,
              height: `${blur.rect.height * 100}%`,
              backdropFilter: `blur(${radius}px) saturate(0.9)`,
              WebkitBackdropFilter: `blur(${radius}px) saturate(0.9)`,
              backgroundColor: `rgba(12,13,16,${Math.min(0.35, blur.intensity * 0.03)})`,
            }}
          />
        );
      })}
    </AnimatePresence>
  );
}
