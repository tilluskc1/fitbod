import type { Feasibility } from '../../types';

interface Props {
  feasibility?: Feasibility;
  onOpenSettings: () => void;
  /** Absent: allow-exercise alternatives are shown as plain text. */
  onAllowExercise?: (exerciseId: string) => void;
}

/** Ready shows nothing; Limited / Not enough says what is missing and offers the explicit alternatives. */
export default function FeasibilityNote({ feasibility, onOpenSettings, onAllowExercise }: Props) {
  if (!feasibility || feasibility.status === 'ok') return null;
  const { status, selectedCount, targetCount, coverage, alternatives } = feasibility;
  const missing = coverage.filter((item) => !item.satisfied).map((item) => item.label.toLowerCase());
  const line = [
    status === 'infeasible' ? 'Not enough equipment' : 'Limited session',
    selectedCount > 0 && selectedCount < targetCount ? `${selectedCount} of ${targetCount} exercises` : '',
    missing.length > 0 ? `no ${missing.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className={`feasibility feasibility--${status}`} role="note" title={feasibility.reason}>
      <p className="feasibility__line">{line}</p>
      {alternatives.length > 0 && (
        <div className="feasibility__alts">
          {alternatives.map((alt) => {
            const onClick = alt.kind === 'capability' ? onOpenSettings
              : alt.exerciseId && onAllowExercise ? () => onAllowExercise(alt.exerciseId!) : null;
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
