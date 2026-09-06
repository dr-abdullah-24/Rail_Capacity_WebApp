import { Children, CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

type Side = 'left' | 'right';
const defaults = { left: 205, right: 286 };

export function ResizableWorkbench({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: Side; x: number; width: number } | null>(null);
  const [available, setAvailable] = useState(1200);
  const [compact, setCompact] = useState(false);
  const [sizes, setSizes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('rail-pane-widths') || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.right))
        return { left: Math.max(140, saved.left), right: Math.max(180, saved.right) };
    } catch {}
    return defaults;
  });
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      setAvailable(container.current?.clientWidth || 1200);
      setCompact(window.innerWidth <= 1000);
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    try { localStorage.setItem('rail-pane-widths', JSON.stringify(sizes)); } catch {}
  }, [sizes]);

  // Reserve room for the table even when the window becomes smaller.
  const right = compact ? 0 : Math.min(sizes.right, Math.max(180, available - 450));
  const left = Math.min(sizes.left, Math.max(140, available - right - 310));
  const limits = (side: Side) => side === 'left'
    ? { min: 140, max: Math.max(140, available - right - 310) }
    : { min: 180, max: Math.max(180, available - left - 310) };
  const resize = (side: Side, value: number) => {
    const { min, max } = limits(side);
    setSizes(previous => ({ ...previous, [side]: Math.round(Math.min(max, Math.max(min, value))) }));
  };
  const separator = (side: Side) => {
    const value = side === 'left' ? left : right;
    const { min, max } = limits(side);
    return <div className={`pane-divider pane-divider-${side}`} role="separator" tabIndex={0}
      aria-label={side === 'left' ? 'Resize project explorer' : 'Resize study properties'}
      aria-orientation="vertical" aria-valuenow={value} aria-valuemin={min} aria-valuemax={max}
      title="Drag to resize · Double-click to reset · Arrow keys to adjust"
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { side, x: event.clientX, width: value };
      }}
      onPointerMove={event => {
        if (drag.current?.side === side)
          resize(side, drag.current.width + (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1));
      }}
      onPointerUp={event => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => resize(side, defaults[side])}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1) * (event.shiftKey ? 40 : 10);
        resize(side, event.key === 'Home' ? min : event.key === 'End' ? max : value + delta);
      }}/>;
  };
  const panes = Children.toArray(children);
  return <div ref={container} className="planning-workbench resizable-workbench"
    style={{ '--explorer-width': `${left}px`, '--properties-width': `${right}px` } as CSSProperties}>
    {panes[0]}{separator('left')}{panes[1]}{separator('right')}{panes[2]}
  </div>;
}
