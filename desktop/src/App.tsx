import { useEffect } from 'react';

import { useWindowLabel } from './lib/bridge';
import { AreaWindow } from './windows/AreaWindow';
import { BarWindow } from './windows/BarWindow';
import { CameraWindow } from './windows/CameraWindow';
import { DrawWindow } from './windows/DrawWindow';
import { MainWindow } from './windows/MainWindow';

export function App() {
  const label = useWindowLabel();
  useEffect(() => {
    if (label) document.body.dataset.window = label;
  }, [label]);
  if (!label) return null;
  if (label === 'bar') return <BarWindow />;
  if (label === 'camera') return <CameraWindow />;
  if (label === 'area') return <AreaWindow />;
  if (label === 'draw') return <DrawWindow />;
  return <MainWindow />;
}
