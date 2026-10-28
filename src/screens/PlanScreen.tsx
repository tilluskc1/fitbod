import { useMemo, useState } from 'react';
import { EQUIPMENT_OPTIONS, EXERCISES, SUPPORT_OPTIONS } from '../data/exercises';
import { FULL_BODY_A, programExercise, programSetCount, repsTarget, setText } from '../data/flagship';
import { capabilitiesFor, provides } from '../lib/capabilities';
import { prescribeExercise } from '../lib/progression';
import { formatWeight } from '../lib/units';
import type { Profile, Unit, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
import { ArrowIcon, ChevronIcon, SettingsIcon } from '../components/ui/Icons';

interface Props {
  profile: Profile;
  history: WorkoutRecord[];
  unit: Unit;
  now: Date;
  onOpenSettings: () => void;
  onViewDay: (dayIndex: number) => void;
  onOpenLibrary: () => void;
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function PlanScreen({
  profile,
  history,
  unit,
  now,
  onOpenSettings,
  onViewDay,
  onOpenLibrary,
}: Props) {
  const [tab, setTab] = useState<'week' | 'equipment'>('week');
  const minutes = profile.sessionMinutes ?? 35;
  const sessionSets = programSetCount(FULL_BODY_A);

  const week = useMemo(() => {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }).map((_, offset) => {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);
      const logged = history.some(
        (workout) =>
          new Date(workout.date).toDateString() === date.toDateString(),
      );
      return {
        key: date.toISOString(),
        dow: DOW[date.getDay()],
        num: date.getDate(),
        today: date.toDateString() === now.toDateString(),
        logged,
      };
    });
  }, [history, now]);

  const available = useMemo(() => {
    const caps = capabilitiesFor(profile);
    const excluded = new Set(profile.exclusions);
    return EXERCISES.filter((exercise) => provides(caps, exercise.needs) && !excluded.has(exercise.id));
  }, [profile]);

  return (
    <div className="screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">Your plan.</h1>
        </div>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="Training settings">
          <SettingsIcon />
        </button>
      </header>
      <p className="page-sub">
        {FULL_BODY_A.exercises.length} exercises · {sessionSets} sets · {minutes} minutes ·{' '}
        {profile.equipment.length === 0 ? 'Bodyweight' : profile.equipment.length >= 3 ? 'Full gym' : 'Home'}
      </p>

      <div className="segmented" role="tablist" aria-label="Plan views">
        <button role="tab" aria-selected={tab === 'week'} className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>
          Your week
        </button>
        <button
          role="tab"
          aria-selected={tab === 'equipment'}
          className={tab === 'equipment' ? 'on' : ''}
          onClick={() => setTab('equipment')}
        >
          Equipment
        </button>
      </div>

      {tab === 'week' ? (
        <>
          <div className="date-strip">
            {week.map((day) => (
              <div key={day.key} className={`date-cell ${day.today ? 'active' : ''}`}>
                <span className="date-dow">{day.dow}</span>
                <span className="date-num">{day.num}</span>
                <span className="date-dot" style={day.logged ? { background: day.today ? '#35461f' : 'var(--lime)' } : undefined} />
              </div>
            ))}
          </div>

          <div>
            <div className="plan-item">
              <span className="plan-index">01</span>
              <div>
                <span className="plan-kicker">UP NEXT</span>
                <strong className="plan-name">{FULL_BODY_A.name}</strong>
                <span className="plan-meta">
                  {minutes} min · {FULL_BODY_A.exercises.length} exercises · {sessionSets} sets
                </span>
                <span className="plan-foot">
                  Your selected equipment
                  <button className="text-link" onClick={() => onViewDay(0)}>
                    View session
                    <ArrowIcon size={17} />
                  </button>
                </span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="equipment-card">
            <div className="between">
              <span className="equipment-name">Home</span>
              <button className="text-link" onClick={onOpenSettings}>
                Edit
              </button>
            </div>
            <span className="equipment-list">
              {profile.equipment.length === 0 ? 'Bodyweight only' : profile.equipment.join(' · ')}
              {profile.support.length > 0 ? ` · ${profile.support.join(' · ')}` : ''}
            </span>
          </div>

          <p className="note-card">
            Only supported exercises appear in your workout. Equipment changes are previewed before
            applying.
          </p>

          <div className="section-head" style={{ margin: '0 0 6px' }}>
            <h2 className="section-title">Available exercises</h2>
            <button className="text-link" onClick={onOpenLibrary}>
              Library
            </button>
          </div>

          <div className="exercise-list">
            {available.slice(0, 6).map((exercise) => {
              const program = programExercise(exercise.id);
              const prescription = prescribeExercise(exercise, profile, history);
              // A program movement keeps the program's own numbers: the generic
              // engine has no notion of a hold and would print "12 reps" for the plank.
              const sets = program?.sets ?? prescription.sets;
              const weight = program?.weight ?? prescription.weight;
              const reps = (program ? repsTarget(exercise.id, sets) : null) ?? setText(exercise.id, prescription.reps);
              return (
                <button className="exercise-row" key={exercise.id} onClick={onOpenLibrary}>
                  <Demo exerciseId={exercise.id} name={exercise.name} className="row-photo" />
                  <span className="row-body">
                    <strong className="row-name">{exercise.name}</strong>
                    <span className="row-meta">
                      {sets} {sets === 1 ? 'set' : 'sets'} · {reps}
                      {weight > 0
                        ? ` · ${formatWeight(weight, unit, { perSide: exercise.equipment === 'Dumbbell' })}`
                        : ''}
                    </span>
                  </span>
                  <span className="chev">
                    <ChevronIcon />
                  </span>
                </button>
              );
            })}
          </div>
          <button className="secondary" style={{ marginTop: 14 }} onClick={onOpenLibrary}>
            Browse all {EXERCISES.length} exercises
          </button>
          <p className="data-note">
            {EQUIPMENT_OPTIONS.filter((item) => profile.equipment.includes(item)).length} primary and{' '}
            {SUPPORT_OPTIONS.filter((item) => profile.support.includes(item)).length} support items
            selected.
          </p>
        </>
      )}
    </div>
  );
}
