import { MotionConfig } from 'framer-motion';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/index.css';
import { Popup } from './Popup';

document.body.classList.add('w-[360px]', 'overflow-hidden');

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Popup />
    </MotionConfig>
  </StrictMode>,
);
