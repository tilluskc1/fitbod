import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { CloseIcon } from './Icons';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: 'default' | 'adjust';
  headingId?: string;
}

/**
 * Bottom sheet scoped to the phone frame. Escape closes, focus starts on the
 * close control, and the page behind it is inert while open.
 */
export default function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  variant = 'default',
  headingId = 'sheet-title',
}: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className={`sheet sheet--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div>
            <h2 className="sheet-title" id={headingId}>
              {title}
            </h2>
            {subtitle && <p className="sheet-sub">{subtitle}</p>}
          </div>
          <button className="sheet-close" onClick={onClose} ref={closeRef} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </div>
  );
}
