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
  const missing = missingFamilies(feasibility);
  const line = [
    status === 'infeasible' ? 'Not enough equipment' : 'Limited session',
    selectedCount > 0 && selectedCount < targetCount ? `${selectedCount} of ${targetCount} exercises` : '',
    missing ? `no ${missing}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className={`feasibility feasibility--${status}`} role="note" title={feasibility.reason}>
      <p className="feasibility__line">{line}</p>
      {alternatives.length > 0 && (
        <div className="feasibility__alts">
          {alternatives.map((alt) => {
            const exercise = alt.exerciseId ? exerciseById(alt.exerciseId) : undefined;
            const onClick = alt.kind === 'capability' ? onOpenSettings
              : exercise && onReviewChange ? () => onReviewChange(exclusionChange(profile, exercise, false)) : null;
            return onClick ? (
              <button key={alt.label} className="feasibility__alt" title={alt.detail} onClick={onClick}>{alt.label}</button>
            ) : (
              <span key={alt.label} className="feasibility__alt feasibility__alt--text" title={alt.detail}>{alt.label}</span>
            );
          })}
        </div>
      )}
    </div>
  );
}
