import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { noticeRole, type Notice } from '../../lib/notices';

/** Each raised message gets its own id, so the same words raised again restart the toast's fade. */
const ids = new WeakMap<Notice, number>();
let nextId = 0;
function idOf(notice: Notice): number {
  let id = ids.get(notice);
  if (id === undefined) {
    id = (nextId += 1);
    ids.set(notice, id);
  }
  return id;
}

/**
 * (#295) The three kinds of message. Done is a dark toast that passes on its own; Heads-up and
 * Problem are cards that wait for the user. Colours come from DESIGN.md tokens only.
 */

function CheckGlyph() {
  return (
    <svg className="notice-glyph" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertGlyph({ kind }: { kind: 'headsUp' | 'problem' }) {
  return (
    <svg className="notice-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="2" />
      {kind === 'problem' ? (
        <>
          <path d="M12 7v6.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="12" cy="16.6" r="1.3" fill="currentColor" />
        </>
      ) : (
        <>
          <circle cx="12" cy="7.6" r="1.3" fill="currentColor" />
          <path d="M12 11v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

/**
 * What a toast keeps clear of: the tab bar and its raised Start, a docked primary button (Preview,
 * Finish), the logger's dock and the recap's buttons. A secondary link in a dock may sit under it.
 */
const FLOORS = '.tabbar, .tab-action, .flow-dock .pill-primary, .flow-dock .primary, .save-bar, .lg-dock, .recap-actions';
const GAP = 12;

/** Where the toast sits: 12px above the highest bottom control in the lower half of the frame. */
function toastBottom(host: HTMLElement): number {
  const frame = host.getBoundingClientRect();
  const tops = [...host.querySelectorAll<HTMLElement>(FLOORS)]
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.height > 0 && rect.top > frame.top + frame.height / 2 && rect.top < frame.bottom)
    .map((rect) => rect.top);
  const floor = tops.length > 0 ? Math.min(...tops) : frame.bottom;
  return Math.max(GAP, frame.bottom - floor + GAP);
}

/** A Done toast: one at a time, 4 s (App's timer), no Dismiss link; taps pass through it except its action. */
export function DoneToast({ notice, screen, action }: { notice: Notice; screen: string; action?: { label: string; onClick: () => void } }) {
  const text = notice.text;
  const ref = useRef<HTMLDivElement>(null);
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const host = ref.current?.offsetParent;
      if (host instanceof HTMLElement) setBottom(toastBottom(host));
    };
    place();
    // Controls settle a frame after a screen change (a sheet closing, the dock lifting for a keyboard).
    const frame = window.requestAnimationFrame(place);
    window.addEventListener('resize', place);
    // A scrolled screen brings in-flow controls (the recap's buttons) up under the toast.
    document.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
    // A toast carried to the next screen (recap to Today) is placed again against that screen's controls.
  }, [notice, screen]);
  return (
    <div ref={ref} className="done-toast" role="status" style={bottom === null ? { visibility: 'hidden' } : { bottom }}>
      <div className="done-toast__pill" key={idOf(notice)}>
        <CheckGlyph />
        <span className="done-toast__text">{text}</span>
        {action && (
          <button type="button" className="done-toast__action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A Heads-up or Problem card. The title carries the kind's colour and icon; the action is the one
 * thing to do about it; × (44px) dismisses a card the user may set aside.
 */
export function NoticeCard({
  kind,
  title,
  children,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss message',
  className = '',
}: {
  kind: 'headsUp' | 'problem';
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  return (
    <div className={`notice-card notice-card--${kind} ${className}`.trim()} role={noticeRole(kind)}>
      <div className="notice-card__head">
        <AlertGlyph kind={kind} />
        <p className="notice-card__title">{title}</p>
        {onDismiss && (
          <button type="button" className="notice-card__x" onClick={onDismiss} aria-label={dismissLabel}>
            ×
          </button>
        )}
      </div>
      {children}
      {actions && <div className="notice-card__actions">{actions}</div>}
    </div>
  );
}

/** A passing Heads-up or Problem message raised by App, as a card at the top of the screen. */
export function MessageCard({ notice, onDismiss, actions }: { notice: Notice; onDismiss: () => void; actions?: ReactNode }) {
  if (notice.kind === 'done') return null;
  return <NoticeCard kind={notice.kind} title={notice.text} onDismiss={onDismiss} actions={actions} />;
}
