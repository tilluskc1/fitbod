import { useMemo, useState } from 'react';
import { EQUIPMENT_OPTIONS, EXERCISES, SUPPORT_OPTIONS } from '../data/exercises';
import { isGymKit, type DayGlance } from '../lib/adapt';
import type { Program } from '../data/flagship';
import { capabilitiesFor, provides } from '../lib/capabilities';
import { catalogRowMeta } from '../lib/liveProgression';
import { describedChip, feasibilityChip, plainFocus, usualLine } from '../lib/planPage';
import { sessionProgress } from '../lib/session';
import type { MuscleGroup, Profile, Unit, WorkoutRecord } from '../types';
import Demo from '../components/ui/Demo';
import TodayOnlyBar from '../components/ui/TodayOnlyBar';
import type { DayStatus } from '../lib/todayTalk';
import type { TodayOnly } from '../lib/todayOnly';
import type { UpcomingDay } from '../lib/switchDay';
import { ChevronIcon, CloseIcon } from '../components/ui/Icons';

interface Props {
  profile: Profile;
  /** The rest of the week after the day up next, in order. */
  upcoming?: UpcomingDay[];
  /** Muscles the day up next trains. */
  focus?: MuscleGroup[];
  /** The slot the sequence is up to: the day this week actually runs. */
  program: Program;
  /** That day as View session shows it: the running session, else today's adjusted day (#189). */
  today: DayGlance;
  /** (#297) Today's exercises as View session lists them: core is named only when one trains it. */
  todayIds?: string[];
  history: WorkoutRecord[];
  unit: Unit;
  /** Settings > Training: the header's Edit and the Equipment tab's Edit. */
  onOpenSettings: () => void;
  onViewDay: (dayIndex: number) => void;
  onOpenLibrary: () => void;
  /** (#219) Today's described day: its own status and reasons, as Today shows them. */
  described?: DayStatus | null;
  /** (#297) The #298 today-only bar, on Today's row only. */
  todayBar?: TodayOnly | null;
  onUndo?: () => void;
  /** (#297) A running session: Today's row shows its progress and Resume (#260). */
  current?: WorkoutRecord | null;
  onResume?: () => void;
  /** (#297) Slots skipped today, marked where the sequence moved them. */
  skipped?: ReadonlySet<string>;
  /** (#297) Why days differ in exercises: shown until tapped away, for this app session only. */
  explainer?: boolean;
  onDismissExplainer?: () => void;
}

const stats = (day: { exercises: number; sets: number; minutes: number; approx: boolean }) =>
  [`${day.exercises} ${day.exercises === 1 ? 'exercise' : 'exercises'}`, `${day.sets} ${day.sets === 1 ? 'set' : 'sets'}`,
    day.exercises > 0 ? `${day.approx ? '≈' : ''}${day.minutes} min` : ''].filter(Boolean).join(' · ');

function Chip({ chip }: { chip: { tone: string; label: string } | null }) {
  return chip ? <span className={`plan-chip plan-chip--${chip.tone}`}>{chip.label}</span> : null;
}

export default function PlanScreen({
  profile,
  upcoming = [],
  focus = [],
  program,
  today,
  todayIds = [],
  history,
  unit,
  onOpenSettings,
  onViewDay,
  onOpenLibrary,
  described,
  todayBar,
  onUndo,
  current,
  onResume,
  skipped,
  explainer,
  onDismissExplainer,
}: Props) {
  const [tab, setTab] = useState<'week' | 'equipment'>('week');
  const dayIds = program.exercises.map((exercise) => exercise.exerciseId);
  const daySets = Object.fromEntries(program.exercises.map((exercise) => [exercise.exerciseId, exercise.sets]));

  const available = useMemo(() => {
    const caps = capabilitiesFor(profile);
    const excluded = new Set(profile.exclusions);
    return EXERCISES.filter((exercise) => provides(caps, exercise.needs) && !excluded.has(exercise.id));
  }, [profile]);

  // A described day is named after what it trains, so it needs no focus words (#193).
  const todayFocus = described ? '' : plainFocus(focus, todayIds);
  const progress = current ? sessionProgress(current) : null;
  const todayChip = progress
    ? { tone: 'progress', label: `In progress · ${progress.done} of ${progress.total} sets` }
    : described ? describedChip(described) : feasibilityChip(program.feasibility);

  return (
    <div className="screen plan-screen">
      <header className="screen-header">
        <div>
          <h1 className="page-title">Your plan.</h1>
        </div>
      </header>
      <p className="plan-usual">
        <span>{usualLine(profile)}</span>
        <button type="button" className="plan-usual__edit" onClick={onOpenSettings}>Edit</button>
      </p>
      {explainer && upcoming.length > 0 && (
        <p className="plan-explainer">
          <span>Days differ in exercises because heavy presses rest longer than curls. Time and effort stay even.</span>
          <button type="button" className="plan-explainer__close" onClick={onDismissExplainer} aria-label="Dismiss">
            <CloseIcon size={18} />
          </button>
        </p>
      )}

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
          <div className="plan-rows">
            <section className="plan-row plan-row--today" aria-label="Today">
              <span className="plan-row__top">
                <span className="plan-row__label">Today</span>
                <Chip chip={todayChip} />
              </span>
              <span className="plan-row__title">
                <strong className="plan-row__name">{today.name}</strong>
                {todayFocus && <span className="plan-row__focus">{todayFocus}</span>}
              </span>
              <span className="plan-row__stats">
                <span>{stats(today)}</span>
                {current && onResume ? (
                  <button type="button" className="plan-row__view" onClick={onResume}>Resume</button>
                ) : (
                  <button type="button" className="plan-row__view" onClick={() => onViewDay(0)}>View</button>
                )}
              </span>
              {!current && <TodayOnlyBar bar={todayBar} onUndo={onUndo} />}
            </section>
            {upcoming.map((day, index) => (
              <section className="plan-row" key={day.id} aria-label={index === 0 ? 'Next' : 'Then'}>
                <span className="plan-row__top">
                  <span className="plan-row__label">
                    {index === 0 ? 'Next' : 'Then'}{skipped?.has(day.id) ? ' · skipped today' : ''}
                  </span>
                  <Chip chip={day.feasibility ? feasibilityChip(day.feasibility)
                    : day.status === 'infeasible' ? { tone: 'none', label: 'Not enough equipment' }
                    : day.status === 'limited' ? { tone: 'limited', label: 'Limited' } : null} />
                </span>
                <span className="plan-row__title">
                  <strong className="plan-row__name">{day.name}</strong>
                  <span className="plan-row__focus">{plainFocus(day.focus, day.exerciseIds ?? [])}</span>
                </span>
                <span className="plan-row__stats"><span>{stats(day)}</span></span>
              </section>
            ))}
            {upcoming.length > 0 && (
              <p className="data-note plan-loop">Then the plan starts again from {program.name}. Days move only when you finish or skip one.</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="equipment-card">
            <div className="between">
              <span className="equipment-name">{profile.equipment.length === 0 ? 'Bodyweight' : isGymKit(profile) ? 'Your gym' : 'Home'}</span>
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
              return (
                <button className="exercise-row" key={exercise.id} onClick={onOpenLibrary}>
                  <Demo exerciseId={exercise.id} name={exercise.name} className="row-photo" />
                  <span className="row-body">
                    <strong className="row-name">{exercise.name}</strong>
                    <span className="row-meta">{catalogRowMeta(exercise, profile, history, unit, dayIds, daySets)}</span>
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
