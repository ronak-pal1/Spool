import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/ui/misc';
import { useDocumentTitle } from '@/lib/hooks';

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-ink-950 px-6 text-center">
      <div className="pointer-events-none absolute inset-0 bg-accent-radial" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 240, damping: 26 }} className="relative">
        <Logo className="justify-center" />
        <p className="mt-10 bg-gradient-to-b from-white to-white/20 bg-clip-text font-mono text-[120px] font-semibold leading-none tracking-tighter text-transparent">404</p>
        <h1 className="mt-4 text-xl font-semibold text-white">This page drifted off the reel</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-white/45">The link might be broken, or the page may have moved.</p>
        <Link to="/" className="mt-8 inline-block">
          <Button variant="secondary" leftIcon={<ArrowLeft className="h-4 w-4" />}>
            Back to Spool
          </Button>
        </Link>
      </motion.div>
    </div>
  );
}
