import type { TodayOnly } from '../../lib/todayOnly';
import Icon from './Icon';

/**
 * (#298) Today differs from the saved setup: say what, and undo it in one tap. Today and Plan's
 * Today row show this one bar (#297). Nothing when today is the usual; no Undo without a handler.
 */
export default function TodayOnlyBar({ bar, onUndo }: { bar: TodayOnly | null | undefined; onUndo?: () => void }) {
  if (!bar) return null;
  return (
    <div className="t7-today-only" role="status">
      <Icon name="calendar_month" size={18} />
      <span className="t7-today-only__l">{bar.label}</span>
      {onUndo && (
        <button type="button" className="t7-today-only__undo" onClick={onUndo}>Undo</button>
      )}
    </div>
  );
}
