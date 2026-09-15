import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical } from 'lucide-react';

export interface ActionMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
  /** Texto de ayuda (p. ej. por qué está deshabilitado). */
  title?: string;
  disabled?: boolean;
  divider?: boolean;
}

/** Menú desplegable de acciones por fila (posicionado con `fixed` para no quedar recortado). */
export function ActionMenu({ items, label = 'Más acciones' }: { items: ActionMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuW = 230;
    const menuH = menuRef.current?.offsetHeight ?? visible.length * 38 + 12;
    let top = rect.bottom + 4;
    if (top + menuH > window.innerHeight - 8) top = Math.max(8, rect.top - menuH - 4);
    let left = rect.right - menuW;
    if (left < 8) left = 8;
    setPos({ top, left });
  }, [open, visible.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node | null;
      if (target && (menuRef.current?.contains(target) || btnRef.current?.contains(target))) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <EllipsisVertical size={16} />
      </button>
      {open &&
        createPortal(
          <div ref={menuRef} className="menu" role="menu" style={{ top: pos.top, left: pos.left }}>
            {visible.map((item, i) => (
              <div key={`${item.label}-${i}`}>
                {item.divider && <div className="menu-divider" />}
                <button
                  type="button"
                  role="menuitem"
                  className={`menu-item ${item.danger ? 'menu-danger' : ''}`}
                  disabled={item.disabled && !item.title}
                  aria-disabled={item.disabled || undefined}
                  title={item.title}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    item.onClick();
                  }}
                >
                  {item.icon}
                  <span className="menu-item-text">
                    <span>{item.label}</span>
                    {item.disabled && item.title && <span className="menu-item-hint">{item.title}</span>}
                  </span>
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
