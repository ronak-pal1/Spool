import { Check } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Popover } from './Popover';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  shortcut?: string;
}

export type MenuEntry = MenuItem | 'separator' | { heading: string };

interface MenuProps {
  trigger: (props: { onClick: (event: React.MouseEvent) => void; 'aria-expanded': boolean }) => ReactNode;
  items: MenuEntry[];
  align?: 'start' | 'end';
  className?: string;
}

export function Menu({ trigger, items, align = 'end', className }: MenuProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <span ref={anchorRef} className="inline-flex">
        {trigger({
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((o) => !o);
          },
          'aria-expanded': open,
        })}
      </span>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} align={align} className={cn('min-w-[200px]', className)}>
        <div role="menu" className="flex flex-col">
          {items.map((entry, index) => {
            if (entry === 'separator') return <div key={`sep-${index}`} className="my-1 h-px bg-white/[0.06]" />;
            if ('heading' in entry) {
              return (
                <div key={`h-${entry.heading}`} className="label px-2.5 pb-1 pt-2">
                  {entry.heading}
                </div>
              );
            }
            return (
              <button
                key={entry.label}
                role="menuitem"
                disabled={entry.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  entry.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40',
                  entry.danger ? 'text-danger hover:bg-danger/10' : 'text-white/80 hover:bg-white/[0.06] hover:text-white',
                )}
              >
                <span className={cn('flex h-4 w-4 items-center justify-center', entry.danger ? 'text-danger' : 'text-white/45')}>
                  {entry.checked ? <Check className="h-3.5 w-3.5 text-accent" /> : entry.icon}
                </span>
                <span className="flex-1">{entry.label}</span>
                {entry.shortcut && <span className="font-mono text-2xs text-white/30">{entry.shortcut}</span>}
              </button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
