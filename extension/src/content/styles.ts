export const overlayStyles = `
:host {
  all: initial;
  position: fixed !important;
  inset: 0 !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  display: block !important;
  font-family: "Inter Variable", Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: rgba(255, 255, 255, 0.92);
  -webkit-font-smoothing: antialiased;
  font-feature-settings: "cv11", "ss01";
  --accent: #00fa9a;
  --accent-ink: #00140b;
  --danger: #ff5c6c;
  --warn: #ffb547;
  --glass: rgba(12, 13, 16, 0.78);
  --line: rgba(255, 255, 255, 0.1);
  --spring: cubic-bezier(0.22, 1.3, 0.36, 1);
}

*, *::before, *::after { box-sizing: border-box; }

button {
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
}
button:focus-visible { outline: 2px solid rgba(0, 250, 154, 0.6); outline-offset: 2px; }

/* ---------- Control bar ---------- */
.bar {
  position: fixed;
  pointer-events: none;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 52px;
  padding: 0 6px 0 4px;
  border-radius: 18px;
  background: var(--glass);
  border: 1px solid var(--line);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  box-shadow: 0 1px 0 0 rgba(255, 255, 255, 0.05) inset, 0 24px 60px -18px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(0, 0, 0, 0.4);
  user-select: none;
  touch-action: none;
  opacity: 0;
  transform: translateY(14px) scale(0.96);
  transition: opacity 0.22s ease, transform 0.5s var(--spring);
}
.bar.visible { opacity: 1; transform: translateY(0) scale(1); pointer-events: auto; }
.bar.dragging { transition: none; cursor: grabbing; }

.grip {
  width: 22px;
  height: 36px;
  border-radius: 10px;
  color: rgba(255, 255, 255, 0.28);
  cursor: grab;
}
.grip:hover { color: rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.04); }
.grip svg { width: 14px; height: 14px; }

.clock {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 10px 0 6px;
  min-width: 112px;
}
.dot {
  position: relative;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #ff3b4e;
  box-shadow: 0 0 12px rgba(255, 59, 78, 0.8);
  flex: none;
}
.dot::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: #ff3b4e;
  animation: ping 1.6s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
}
.paused .dot { background: var(--warn); box-shadow: 0 0 12px rgba(255, 181, 71, 0.6); }
.paused .dot::after { animation: none; opacity: 0; }
.time {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
  color: #fff;
}
.paused .time { animation: blink 1.2s ease-in-out infinite; }
.limit { font-size: 11px; color: rgba(255, 255, 255, 0.38); font-variant-numeric: tabular-nums; }
.warn .time { color: var(--warn); }
.critical .time { color: var(--danger); }

.divider { width: 1px; height: 24px; background: var(--line); margin: 0 4px; flex: none; }

.icon-btn {
  position: relative;
  width: 36px;
  height: 36px;
  border-radius: 11px;
  color: rgba(255, 255, 255, 0.72);
  transition: background 0.15s ease, color 0.15s ease, transform 0.2s var(--spring);
}
.icon-btn:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
.icon-btn:active { transform: scale(0.9); }
.icon-btn.active { color: var(--accent); background: rgba(0, 250, 154, 0.12); }
.icon-btn.muted { color: var(--danger); background: rgba(255, 92, 108, 0.12); }
.icon-btn.danger:hover { color: var(--danger); background: rgba(255, 92, 108, 0.12); }
.icon-btn[disabled] { opacity: 0.35; pointer-events: none; }
.icon-btn svg { width: 17px; height: 17px; }

.icon-btn[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translate(-50%, 4px);
  padding: 5px 8px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  color: #fff;
  background: rgba(17, 19, 23, 0.96);
  border: 1px solid var(--line);
  box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.8);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease, transform 0.2s var(--spring);
}
.icon-btn[data-tip]:hover::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 0.35s; }
.bar.flip .icon-btn[data-tip]::after { bottom: auto; top: calc(100% + 10px); }

.stop-btn {
  height: 38px;
  padding: 0 14px 0 11px;
  margin-left: 4px;
  gap: 7px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 650;
  color: var(--accent-ink);
  background: var(--accent);
  box-shadow: 0 0 0 1px rgba(0, 250, 154, 0.5), 0 8px 24px -8px rgba(0, 250, 154, 0.7);
  transition: transform 0.2s var(--spring), box-shadow 0.2s ease, background 0.15s ease;
}
.stop-btn:hover { background: #33fbae; box-shadow: 0 0 0 1px rgba(0, 250, 154, 0.7), 0 10px 30px -6px rgba(0, 250, 154, 0.8); }
.stop-btn:active { transform: scale(0.95); }
.stop-btn svg { width: 13px; height: 13px; }

.progress {
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
}
.progress > i {
  display: block;
  height: 100%;
  width: 100%;
  transform-origin: left center;
  transform: scaleX(0);
  background: linear-gradient(90deg, rgba(0, 250, 154, 0.4), var(--accent));
  transition: transform 0.25s linear;
}
.warn .progress > i { background: linear-gradient(90deg, rgba(255, 181, 71, 0.4), var(--warn)); }
.critical .progress > i { background: linear-gradient(90deg, rgba(255, 92, 108, 0.4), var(--danger)); }

.status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px 0 8px;
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
}
.status .spin { width: 16px; height: 16px; color: var(--accent); animation: spin 0.9s linear infinite; }
.status .spin svg { width: 16px; height: 16px; }
.status .err { color: var(--danger); display: inline-flex; }
.status .err svg { width: 16px; height: 16px; }
.status .pct { font-variant-numeric: tabular-nums; color: rgba(255, 255, 255, 0.5); font-weight: 500; }
.link-btn {
  height: 32px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--line);
}
.link-btn:hover { background: rgba(255, 255, 255, 0.12); }

/* ---------- Popovers above the bar ---------- */
.popover {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 10px);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 14px;
  background: rgba(17, 19, 23, 0.94);
  border: 1px solid var(--line);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 20px 50px -16px rgba(0, 0, 0, 0.9);
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 8px) scale(0.96);
  transition: opacity 0.16s ease, transform 0.35s var(--spring);
}
.popover.open { opacity: 1; pointer-events: auto; transform: translate(-50%, 0) scale(1); }
.bar.flip .popover { bottom: auto; top: calc(100% + 10px); }
.popover .msg { font-size: 12.5px; color: rgba(255, 255, 255, 0.75); padding: 0 6px 0 4px; }
.popover .ghost {
  height: 30px;
  padding: 0 11px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 550;
  color: rgba(255, 255, 255, 0.75);
}
.popover .ghost:hover { background: rgba(255, 255, 255, 0.07); color: #fff; }
.popover .confirm {
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 650;
  color: #fff;
  background: rgba(255, 92, 108, 0.9);
}
.popover .confirm:hover { background: var(--danger); }
.popover .confirm.neutral { background: rgba(255, 255, 255, 0.14); }
.popover .confirm.neutral:hover { background: rgba(255, 255, 255, 0.2); }

.swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15) inset;
  transition: transform 0.2s var(--spring), border-color 0.15s ease;
}
.swatch:hover { transform: scale(1.12); }
.swatch.selected { border-color: #fff; transform: scale(1.12); }

/* ---------- Countdown ---------- */
.countdown {
  position: fixed;
  inset: 0;
  pointer-events: none;
  display: grid;
  place-items: center;
  background: radial-gradient(60% 60% at 50% 45%, rgba(0, 250, 154, 0.08), rgba(5, 6, 7, 0.55) 70%);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  opacity: 0;
  transition: opacity 0.25s ease;
}
.countdown.visible { opacity: 1; pointer-events: auto; }
.countdown .stack { display: flex; flex-direction: column; align-items: center; gap: 22px; }
.countdown .ring {
  position: relative;
  width: 168px;
  height: 168px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: rgba(12, 13, 16, 0.82);
  border: 1px solid var(--line);
  box-shadow: 0 0 0 10px rgba(0, 250, 154, 0.05), 0 30px 80px -20px rgba(0, 0, 0, 0.9), 0 0 80px -20px rgba(0, 250, 154, 0.5);
}
.countdown .ring svg { position: absolute; inset: -1px; width: 170px; height: 170px; transform: rotate(-90deg); }
.countdown .ring circle { fill: none; stroke-width: 3; }
.countdown .ring .track { stroke: rgba(255, 255, 255, 0.06); }
.countdown .ring .arc { stroke: var(--accent); stroke-linecap: round; filter: drop-shadow(0 0 6px rgba(0, 250, 154, 0.7)); }
.countdown .num {
  font-size: 76px;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: #fff;
  font-variant-numeric: tabular-nums;
  animation: pop 0.5s var(--spring);
}
.countdown .hint { font-size: 13px; color: rgba(255, 255, 255, 0.6); }
.countdown .hint kbd {
  font: inherit;
  font-size: 11px;
  padding: 2px 6px;
  margin: 0 2px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.06);
}
.countdown .cancel {
  height: 34px;
  padding: 0 16px;
  border-radius: 11px;
  font-size: 13px;
  font-weight: 550;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(12, 13, 16, 0.8);
  border: 1px solid var(--line);
}
.countdown .cancel:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }

/* ---------- Drawing layer ---------- */
.draw {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}
.draw.enabled { pointer-events: auto; cursor: crosshair; }

/* ---------- Camera bubble ---------- */
.bubble {
  position: fixed;
  pointer-events: none;
  touch-action: none;
  user-select: none;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.25s ease, transform 0.5s var(--spring), width 0.45s var(--spring), height 0.45s var(--spring);
}
.bubble.visible { opacity: 1; transform: scale(1); pointer-events: auto; }
.bubble.dragging { transition: width 0.45s var(--spring), height 0.45s var(--spring); cursor: grabbing; }
.bubble .lens {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  overflow: hidden;
  background: #0c0d10;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.12), 0 0 0 4px rgba(0, 0, 0, 0.35), 0 24px 60px -16px rgba(0, 0, 0, 0.9);
}
.bubble iframe { width: 100%; height: 100%; border: 0; display: block; pointer-events: none; background: transparent; }
.bubble .grab { position: absolute; inset: 0; border-radius: 50%; cursor: grab; }
.bubble .sizes {
  position: absolute;
  left: 50%;
  bottom: -16px;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(12, 13, 16, 0.9);
  border: 1px solid var(--line);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.8);
  opacity: 0;
  transform: translate(-50%, 6px);
  transition: opacity 0.15s ease, transform 0.3s var(--spring);
}
.bubble:hover .sizes, .bubble.dragging .sizes { opacity: 1; transform: translate(-50%, 0); }
.bubble .sizes button {
  width: 26px;
  height: 22px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  color: rgba(255, 255, 255, 0.6);
}
.bubble .sizes button:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }
.bubble .sizes button.selected { color: var(--accent-ink); background: var(--accent); }

@keyframes ping { 0% { transform: scale(1); opacity: 0.7; } 100% { transform: scale(2.6); opacity: 0; } }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pop { 0% { transform: scale(1.5); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  .bar, .bubble, .popover, .countdown { transition-duration: 0.01ms !important; }
  .dot::after, .countdown .num, .paused .time { animation: none !important; }
}
`;
