import { exerciseById } from '../../data/exercises';
import { feasibilityParts } from '../../lib/planPage';
import { exclusionChange, type ProfileChange } from '../../lib/preferences';
import type { DayStatus } from '../../lib/todayTalk';
import type { Feasibility, Profile } from '../../types';

interface Props {
  feasibility?: Feasibility;
  profile: Profile;
  onOpenSettings: () => void;
  /** Opens the shared preview-and-confirm; absent means Allow is shown as plain text. */
  onReviewChange?: (change: ProfileChange) => void;
}

/** Ready shows nothing; Limited / Not enough says what is missing and offers the explicit alternatives. */
export default function FeasibilityNote({ feasibility, profile, onOpenSettings, onReviewChange }: Props) {
  if (!feasibility || feasibility.status === 'ok') return null;
  const { status, alternatives } = feasibility;
  // The line already names the status; the reason adds why, visibly (phones show no tooltips).
  const reason = feasibility.reason.replace(/^Limited session: (\w)/, (_, first: string) => first.toUpperCase());
  const MAX_CHIPS = 3;
  // (#297) The same reason parts as Plan's chip.
  const line = [status === 'infeasible' ? 'Not enough equipment' : 'Limited session', ...feasibilityParts(feasibility)].join(' · ');
  return (
    <div className={`feasibility feasibility--${status}`} role="note">
      <p className="feasibility__line">{line}</p>
      {reason && <p className="feasibility__reason">{reason}</p>}
      {alternatives.length > 0 && (
        <div className="feasibility__alts">
          {alternatives.slice(0, MAX_CHIPS).map((alt) => {
            const exercise = alt.exerciseId ? exerciseById(alt.exerciseId) : undefined;
            const onClick = alt.kind === 'capability' ? onOpenSettings
              : exercise && onReviewChange ? () => onReviewChange(exclusionChange(profile, exercise, false)) : null;
            return onClick ? (
              <button key={alt.label} className="feasibility__alt" title={alt.detail} onClick={onClick}>{alt.label}</button>
            ) : (
              <span key={alt.label} className="feasibility__alt feasibility__alt--text" title={alt.detail}>{alt.label}</span>
            );
          })}
          {alternatives.length > MAX_CHIPS && (
            <button className="text-action text-action--lime" onClick={onOpenSettings}>More in Equipment</button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A described day's note (#219): the same reason lines as the composer's preview, never the
 * generator's planned-day requirements. Ready shows nothing.
 */
export function DescribedNote({ day }: { day: DayStatus }) {
  if (day.status === 'ready' || day.reasons.length === 0) return null;
  return (
    <div className={`feasibility feasibility--${day.status === 'none' ? 'infeasible' : 'limited'}`} role="note">
      <p className="feasibility__line">{day.status === 'none' ? 'Not enough equipment' : 'Limited'}</p>
      {day.reasons.map((line) => (
        <p className="feasibility__reason" key={line.label}><b>{line.label}</b> {line.text}</p>
      ))}
    </div>
  );
}
