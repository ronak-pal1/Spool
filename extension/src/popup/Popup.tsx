import { motion } from 'framer-motion';
import { useRecordingState, useSettings } from '@/lib/hooks';
import { isActive } from '@/lib/state';
import { HomeView } from './HomeView';
import { LiveView } from './LiveView';
import { LoginView } from './LoginView';

export function Popup() {
  const { settings, loaded: settingsLoaded } = useSettings();
  const { state, loaded: stateLoaded } = useRecordingState();

  if (!settingsLoaded || !stateLoaded) return <div className="h-[420px] bg-ink-900" />;

  const view = isActive(state) || state.phase === 'error' ? 'live' : settings.token ? 'home' : 'login';

  return (
    <div className="relative min-h-[420px] overflow-hidden bg-ink-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-accent-radial opacity-70" />
      {/* Views swap with an enter-only transition; exit animations would hold shared-layout elements hostage. */}
      <motion.div key={view} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} className="relative">
        {view === 'login' && <LoginView settings={settings} />}
        {view === 'home' && <HomeView settings={settings} />}
        {view === 'live' && <LiveView state={state} />}
      </motion.div>
    </div>
  );
}
