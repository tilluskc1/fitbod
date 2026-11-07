import { exerciseById } from '../../data/exercises';
import { missingFamilies } from '../../lib/feasibility';
import { exclusionChange, type ProfileChange } from '../../lib/preferences';
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
  const { status, selectedCount, targetCount, alternatives } = feasibility;
  // The line already names the status; the reason adds why, visibly (phones show no tooltips).
  const reason = feasibility.reason.replace(/^Limited session: (\w)/, (_, first: string) => first.toUpperCase());
  const MAX_CHIPS = 3;
  const missing = missingFamilies(feasibility);
  const countGap = selectedCount > 0 && selectedCount < targetCount;
  // A full day whose gear cannot train a focus muscle at all names that muscle (#67, #174).
  const open = !countGap && !missing ? feasibility.reason.match(/ No (.+) exercise is possible/)?.[1] : undefined;
  const line = [
    status === 'infeasible' ? 'Not enough equipment' : 'Limited session',
    countGap ? `${selectedCount} of ${targetCount} exercises` : '',
    missing ? `no ${missing}` : '',
    open ? `no ${open} work` : '',
  ].filter(Boolean).join(' · ');
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
