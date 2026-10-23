import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
import { RecorderEngine } from './engine';
import { RecorderApp } from './RecorderApp';

// The engine is created outside React so StrictMode's double effects can never start two captures.
const engine = new RecorderEngine();
void engine.start();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <RecorderApp engine={engine} />
    </MotionConfig>
  </StrictMode>,
);
