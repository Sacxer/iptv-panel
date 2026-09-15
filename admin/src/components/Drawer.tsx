import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** Panel lateral deslizante (derecha). */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 640,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    document.body.classList.add('modal-open');
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <header className="drawer-header">
          <div className="grow">
            <h2 className="modal-title">{title}</h2>
            {subtitle && <div className="muted text-sm">{subtitle}</div>}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
