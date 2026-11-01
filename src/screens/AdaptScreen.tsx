import type { AdaptedWorkout } from '../lib/adapt';
import { EQUIPMENT_OPTIONS } from '../lib/adapt';
import type { Constraints } from '../lib/adapt';
import { noticeText, type ConstraintNotice } from '../lib/constraints';
import type { Unit } from '../types.ts';
import { targetSummary } from '../data/flagship';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';

interface Props {
  originalSets: number;
  adapted: AdaptedWorkout;
  constraints: Constraints;
  notices: ConstraintNotice[];
  unit?: Unit;
  onStart: () => void;
  onKeep: () => void;
  onEdit: () => void;
}

/** A plain description of what changed, derived from the two workouts. */
function summaryLine(adapted: AdaptedWorkout, originalSets: number): string {
  const trimmed = adapted.exercises.filter((exercise) => exercise.sets < exercise.originalSets);
  const parts: string[] = [];
  if (adapted.exercises.length > 0) parts.push('Same exercises and weights.');
  if (trimmed.length > 0) {
    const drops = new Set(trimmed.map((exercise) => exercise.originalSets - exercise.sets));
    if (drops.size === 1) {
      const drop = [...drops][0];
      parts.push(
        `${drop} fewer ${drop === 1 ? 'set' : 'sets'} ${
          trimmed.length === adapted.exercises.length ? 'on each lift' : `on the ${trimmed.map((exercise) => exercise.name.toLowerCase()).join(' and ')}`
        }.`,
      );
    } else {
      parts.push(`Fewer sets on the ${trimmed.map((exercise) => exercise.name.toLowerCase()).join(' and ')}.`);
    }
  }
  if (adapted.totalSets < originalSets && trimmed.length === 0) {
    parts.push(`${originalSets - adapted.totalSets} fewer sets.`);
  }
  if (adapted.skipped.length > 0) {
    parts.push(`${adapted.skipped.map((item) => item.name).join(' and ')} skipped today.`);
  }
  if (parts.length === 0) return 'The same workout as your program.';
  return parts.join(' ');
}

export default function AdaptScreen({
  originalSets,
  adapted,
  constraints,
  notices,
  unit = 'kg',
  onStart,
  onKeep,
  onEdit,
}: Props) {
  const setup = EQUIPMENT_OPTIONS[constraints.equipment];
  const kept = adapted.exercises.length;
  const setDelta = adapted.totalSets - originalSets;
  const minDelta = adapted.minutes - adapted.originalMinutes;
  const title =
    adapted.minutes === adapted.originalMinutes
      ? `${adapted.name} today`
      : `${adapted.name}, ${adapted.minutes}-minute version`;

  return (
    <div className="screen flow-screen">
      <header className="flow-header">
        <div className="flow-header__inner">
          <button className="flow-back" onClick={onKeep} aria-label="Keep the original workout">
            <Icon name="arrow_back_ios_new" size={22} />
          </button>
          <h1 className="flow-title">Review changes</h1>
          <span className="flow-header__right">
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: '999px',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--surface-container-high)',
                border: '1px solid rgba(50,59,48,.6)',
                color: 'var(--on-surface)',
              }}
              aria-hidden="true"
            >
              <Icon name="person" size={18} />
            </span>
          </span>
        </div>
      </header>

      <div className="flow-body">
        <div>
          <h2 className="review__title">{title}</h2>
          <div className="review__chips">
            <button className="flow-chip" onClick={onEdit}>
              <Icon name="schedule" size={14} />
              {constraints.minutes} min
              <Icon name="expand_more" size={14} />
            </button>
            <button className="flow-chip" onClick={onEdit}>
              <Icon name="fitness_center" size={14} />
              {setup.chip}
              <Icon name="expand_more" size={14} />
            </button>
          </div>
          <p className="review__lede">{summaryLine(adapted, originalSets)}</p>
          {notices.map((notice) => (
            <p key={notice.kind} className="constraint-notice" role="status">
              {noticeText(notice)}
            </p>
          ))}
        </div>

        <section className="diff-card" aria-label="What changes today">
          <div className="diff-grid">
            <div className="diff-cell">
              <div className="diff-cell__head">
                <span>Time</span>
                <span className="diff-cell__delta">
                  {minDelta === 0 ? 'Same' : `${minDelta > 0 ? '+' : ''}${minDelta} min`}
                </span>
              </div>
              <div className="diff-cell__values">
                {minDelta !== 0 && (
                  <>
                    <span className="diff-cell__before">{adapted.originalMinutes} min</span>
                    <span className="diff-cell__arrow" aria-hidden="true">
                      →
                    </span>
                  </>
                )}
                <span className="diff-cell__after">
                  {adapted.minutes} <span className="diff-cell__unit">min</span>
                </span>
              </div>
            </div>
            <div className="diff-cell">
              <div className="diff-cell__head">
                <span>Sets</span>
                <span className="diff-cell__delta">
                  {setDelta === 0 ? 'Same' : `${setDelta > 0 ? '+' : ''}${setDelta} sets`}
                </span>
              </div>
              <div className="diff-cell__values">
                {setDelta !== 0 && (
                  <>
                    <span className="diff-cell__before">{originalSets} sets</span>
                    <span className="diff-cell__arrow" aria-hidden="true">
                      →
                    </span>
                  </>
                )}
                <span className="diff-cell__after">
                  {adapted.totalSets} <span className="diff-cell__unit">working</span>
                </span>
              </div>
            </div>
          </div>
        </section>

        <div>
          <div className="list-head">
            <h2>Today’s exercises</h2>
            <span>
              {kept} active
            </span>
          </div>

          <div className="workout-list">
            {adapted.exercises.map((exercise) => (
              <div className="review-row" key={exercise.exerciseId}>
                <span className="review-row__tag">
                  {exercise.sets === exercise.originalSets
                    ? `${exercise.sets} ${exercise.sets === 1 ? 'set' : 'sets'}`
                    : `${exercise.sets} ${exercise.sets === 1 ? 'set' : 'sets'} (was ${exercise.originalSets})`}
                </span>
                <div className="review-row__main">
                  <Demo
                    exerciseId={exercise.exerciseId}
                    name={exercise.name}
                    className="review-row__photo"
                  />
                  <div>
                    <div className="review-row__name">{exercise.name}</div>
                    <div className="review-row__load">{targetSummary(exercise, exercise.sets, unit)}</div>
                  </div>
                </div>
              </div>
            ))}

            {adapted.skipped.map((item) => (
              <div className="review-row review-row--skipped" key={`skipped-${item.exerciseId}`}>
                <span className="review-row__tag">
                  {item.reason === 'time'
                    ? 'Skipped today'
                    : item.reason === 'excluded'
                      ? 'Excluded'
                      : 'Needs equipment'}
                </span>
                <div className="review-row__main">
                  <div className="review-row__photo review-row__strike-photo" aria-hidden="true">
                    <Icon name={item.reason === 'time' ? 'timer_off' : 'info'} size={24} />
                  </div>
                  <div>
                    <div className="review-row__name">{item.name}</div>
                    <div className="review-row__load">
                      {item.sets} {item.sets === 1 ? 'set' : 'sets'}{' '}
                      {item.reason === 'time'
                        ? `skipped to fit ${adapted.minutes} min`
                        : item.reason === 'excluded'
                          ? 'excluded in your library'
                          : 'not available with this setup'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flow-dock flow-dock--edge">
        <div className="review-footer">
          <p className="review-footer__note">Today only. Your program is unchanged.</p>
          <button className="pill-primary" onClick={onStart}>
            {adapted.minutes === adapted.originalMinutes
              ? 'Start workout'
              : `Start ${adapted.minutes}-min workout`}
            <Icon name="arrow_forward" size={20} />
          </button>
          <div className="review-footer__row">
            <button className="pill-quiet" onClick={onKeep}>
              Keep original
            </button>
            <button className="pill-quiet" onClick={onEdit}>
              Edit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
