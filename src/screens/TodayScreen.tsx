import type { Profile, WorkoutRecord } from '../types';
import { lastPerformance, workoutsThisWeek } from '../lib/plan';
import type { LastPerformance } from '../lib/plan';
import { exerciseMeta, loadLabel, setText, targetSummary } from '../data/flagship';
import type { Program, ProgramExercise } from '../data/flagship';
import type { AdaptedWorkout, EquipmentChoice } from '../lib/adapt';
import { EQUIPMENT_OPTIONS } from '../lib/adapt';
import { exercisePhoto } from '../lib/media';
import Demo from '../components/ui/Demo';
import Icon from '../components/ui/Icon';

interface Props {
  profile: Profile;
  program: Program;
  adapted: AdaptedWorkout;
  equipment: EquipmentChoice;
  adjusted: boolean;
  history: WorkoutRecord[];
  current: WorkoutRecord | null;
  now: Date;
  onStart: () => void;
  onResume: () => void;
  onAdjust: () => void;
  onWhy: () => void;
  onRestore: () => void;
  onOpenSettings: () => void;
  onOpenExercise: (exerciseId: string) => void;
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 18) return 'Good afternoon,';
  return 'Good evening,';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'A';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function coachInsight(last: LastPerformance | null, first: ProgramExercise): string {
  if (!last) {
    return `First session on the ${first.name.toLowerCase()}. Start light enough that every rep looks the same.`;
  }
  const reps = setText(first.exerciseId, last.reps);
  const target = first.targetReps?.[0];
  if (target !== undefined && target > Math.min(...last.reps)) {
    return `You finished ${reps} last time. Keep ${loadLabel(first)} and aim for one more rep.`;
  }
  return `You finished ${reps} last time at ${loadLabel(first)}. Repeat that, and stop the set when form goes.`;
}

export default function TodayScreen({
  profile,
  program,
  adapted,
  equipment,
  adjusted,
  history,
  current,
  now,
  onStart,
  onResume,
  onAdjust,
  onWhy,
  onRestore,
  onOpenSettings,
  onOpenExercise,
}: Props) {
  const name = profile.name?.trim() || 'Athlete';
  const week = workoutsThisWeek(history, now);
  const targetDays = profile.daysPerWeek;
  const setup = EQUIPMENT_OPTIONS[equipment];
  const minutes = current ? (current.durationMin ?? adapted.minutes) : adapted.minutes;
  const first = adapted.exercises[0];
  const heroId = first?.exerciseId ?? 'dumbbell-floor-press';
  const photo = exercisePhoto(heroId);
  const last = first ? lastPerformance(history, first.exerciseId) : null;
  const progress = current
    ? current.exercises.reduce(
        (sum, exercise) => sum + exercise.performed.filter((set) => set.done).length,
        0,
      )
    : 0;
  const total = current
    ? current.exercises.reduce((sum, exercise) => sum + exercise.performed.length, 0)
    : adapted.totalSets;

  return (
    <div className="screen flow-screen">
      <div className="today">
        <header className="today__greeting">
          <div>
            <p className="today__hello">{greeting(now)}</p>
            <h1 className="today__name">{name}.</h1>
          </div>
          <button className="avatar-btn" onClick={onOpenSettings} aria-label="Open profile and settings">
            {initials(name)}
          </button>
        </header>

        <div className="today__week">
          <span>
            {week} of {targetDays} sessions this week
          </span>
          <span
            className="today__dots"
            aria-label={`${week} of ${targetDays} sessions completed this week`}
          >
            {Array.from({ length: targetDays }).map((_, index) => (
              <span key={index} className={`today__dot ${index < week ? 'today__dot--on' : ''}`} />
            ))}
          </span>
        </div>

        <section className="hero-card" aria-label={`${program.name}, ${minutes} minutes`}>
          {photo && <img className="hero-card__photo" src={photo} alt="" />}
          <span className="hero-card__shade" aria-hidden="true" />
          <span className="hero-card__top">
            <span className="eyebrow-lite">{current ? 'In progress' : 'Your next workout'}</span>
            {adjusted && !current && <span className="aw-badge">Adjusted for today</span>}
          </span>
          <span className="hero-card__bottom">
            <span className={`hero-card__title ${adjusted ? 'hero-card__title--lg' : ''}`}>
              {current ? current.name : program.name}
            </span>
            <span className="hero-card__meta">
              <Icon name="timer" size={17} />
              {minutes} min <span aria-hidden="true">·</span> {setup.short}
            </span>
          </span>
        </section>

        <section className="coach-card" aria-label={adjusted ? 'Coach note' : 'Coach insight'}>
          <div className="coach-card__head">
            <span className="coach-card__dot" aria-hidden="true" />
            <div>
              <p className="coach-card__label">{adjusted ? 'Coach note' : 'Coach insight'}</p>
              <p className="coach-card__text">
                {adjusted
                  ? adapted.note
                  : current
                    ? `Session open. ${progress} of ${total} sets logged so far.`
                    : first
                      ? coachInsight(last, first)
                      : 'Pick a workout you can keep. The program follows from that.'}
              </p>
            </div>
          </div>
          <div className="coach-card__actions">
            {adjusted && (
              <button className="text-action text-action--lime" onClick={onRestore}>
                <Icon name="undo" size={16} />
                Restore original
              </button>
            )}
            <button className="text-action" onClick={onWhy} disabled={!first}>
              <Icon name="info" size={16} />
              Why this target
            </button>
          </div>
        </section>

        <div>
          <div className="list-head">
            <h2>The workout</h2>
            <span>
              {minutes} min · {adapted.totalSets} {adapted.totalSets === 1 ? 'set' : 'sets'}
            </span>
          </div>

          <div className="workout-list">
            {adapted.exercises.length === 0 && (
              <p className="empty-state">
                No movement in this program can be done with {setup.chip.toLowerCase()}. Choose
                another setup in Adjust today.
              </p>
            )}

            {adapted.exercises.map((exercise, index) => (
              <button
                className="workout-row"
                key={exercise.exerciseId}
                onClick={() => onOpenExercise(exercise.exerciseId)}
              >
                <span className="workout-row__main">
                  <Demo
                    exerciseId={exercise.exerciseId}
                    name={exercise.name}
                    className="workout-row__photo"
                  />
                  <span className="workout-row__text">
                    <span className="workout-row__name">{exercise.name}</span>
                    <span className="workout-row__meta">
                      {exerciseMeta(exercise)}
                    </span>
                  </span>
                  <span className="workout-row__chev">
                    <Icon name="chevron_right" size={20} />
                  </span>
                </span>

                {index === 0 && (
                  <span className="compare-block">
                    <span className="compare-line">
                      <span className="compare-line__label">
                        {last ? 'Last session' : 'No history yet'}
                      </span>
                      <span className="compare-line__value">
                        {last && first ? setText(first.exerciseId, last.reps) : '—'}
                      </span>
                    </span>
                    <span className="compare-line">
                      <span className="compare-line__label">Today’s target</span>
                      <span className="compare-line__value compare-line__value--target">
                        {targetSummary(exercise, exercise.sets)}
                      </span>
                    </span>
                  </span>
                )}
              </button>
            ))}

            {adapted.skipped.map((item) => {
              const source = program.exercises.find((exercise) => exercise.exerciseId === item.exerciseId);
              return (
                <div className="workout-row workout-row--skipped" key={`skipped-${item.exerciseId}`}>
                  <span className="workout-row__main">
                    <span className="workout-row__photo" aria-hidden="true">
                      <Icon name={item.reason === 'time' ? 'timer_off' : 'info'} size={22} />
                    </span>
                    <span className="workout-row__text">
                      <span className="workout-row__name">
                        {item.name}
                        <span className="skipped-badge">
                          {item.reason === 'time' ? 'Skipped today' : 'No equipment'}
                        </span>
                      </span>
                      <span className="workout-row__meta">
                        {source ? exerciseMeta(source) : `${item.sets} sets`}
                      </span>
                    </span>
                    <span className="workout-row__chev" aria-hidden="true" />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flow-dock">
        <button className="text-action" onClick={onAdjust}>
          <Icon name="tune" size={16} />
          Short on time or gear?
        </button>
        {current ? (
          <button className="pill-primary" onClick={onResume}>
            Resume workout
            <Icon name="arrow_forward" size={20} />
          </button>
        ) : (
          <button className="pill-primary" onClick={onStart} disabled={adapted.exercises.length === 0}>
            Start workout
            <Icon name="arrow_forward" size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
