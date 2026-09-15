import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Panel flotante anclado a un botón (posición `fixed` en un portal para no quedar recortado por tablas con scroll).
 * Se cierra con clic fuera, Escape, scroll o cambio de tamaño.
 */
export function Popover({
  trigger,
  children,
  triggerClassName = '',
  triggerTitle,
  width = 300,
  closeOnSelect = false,
}: {
  trigger: ReactNode;
  children: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  width?: number;
  /** Cierra el panel al pulsar un botón dentro (menús). */
  closeOnSelect?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const h = panelRef.current?.offsetHeight ?? 160;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    let left = rect.left;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w;
    if (left < 8) left = 8;
    setPos({ top, left, width: w });
  }, [open, width]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node | null;
      if (t && (panelRef.current?.contains(t) || btnRef.current?.contains(t))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={triggerClassName}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={triggerTitle}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        {trigger}
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            className="popover"
            role="dialog"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onClick={(e) => {
              if (closeOnSelect && (e.target as HTMLElement).closest('button')) setOpen(false);
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
