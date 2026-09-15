import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Si es false no se cierra con Escape ni clic fuera (p. ej. mientras se guarda). */
  dismissible?: boolean;
  /** Si se indica, el contenido se envuelve en un <form> y el pie queda dentro. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}

let openCount = 0;

export function Modal({ open, title, onClose, children, footer, size = 'md', dismissible = true, onSubmit }: ModalProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    openCount++;
    document.body.classList.add('modal-open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissRef.current) onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      openCount--;
      if (openCount <= 0) document.body.classList.remove('modal-open');
    };
  }, [open]);

  if (!open) return null;

  const inner = (
    <>
      <div className="modal-header">
        <h2 className="modal-title">{title}</h2>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar" disabled={!dismissible}>
          <X size={18} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </>
  );

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      {onSubmit ? (
        <form
          className={`modal modal-${size}`}
          role="dialog"
          aria-modal="true"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(e);
          }}
        >
          {inner}
        </form>
      ) : (
        <div className={`modal modal-${size}`} role="dialog" aria-modal="true">
          {inner}
        </div>
      )}
    </div>,
    document.body,
  );
}
