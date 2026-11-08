import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile, Unit, WorkoutRecord } from '../types';
import { lastPerformance, workoutsThisWeek } from '../lib/plan';
import type { LastPerformance } from '../lib/plan';
import { toDisplay, unitLabel, unitOf } from '../lib/units';
import { exerciseMeta, lastSummary, setText, targetSummary } from '../data/flagship';
import type { Program, ProgramExercise } from '../data/flagship';
import type { AdaptedWorkout, EquipmentChoice } from '../lib/adapt';
import { currentWorkout, setupFor, todayGlance } from '../lib/adapt';
import { plannedLoad, targetCoachLine } from '../lib/liveProgression';
import { leadCompoundId } from '../lib/progression';
import { isDescribedSession } from '../lib/sequence';
import Demo from '../components/ui/Demo';
import FeasibilityNote, { DescribedNote } from '../components/ui/FeasibilityNote';
import { missingFamilies } from '../lib/feasibility';
import type { ProfileChange } from '../lib/preferences';
import type { DayStatus } from '../lib/todayTalk';
import { listAreas } from '../lib/recovery';
import type { FresherDay } from '../lib/recovery';
import type { SwitchOption } from '../lib/switchDay';
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
  /** Opens the session's exercise list; Start/Resume lives in the tab bar. */
  onPreview: () => void;
  onAdjust: () => void;
  onWhy: () => void;
  onRestore: () => void;
  onOpenSettings: () => void;
  onOpenExercise: (exerciseId: string, exerciseIndex: number) => void;
  /** "Slot 2 of 3" when the program has more than one day. */
  slotLabel?: string;
  /** Explicit skip of the slot on offer. Absent means the plan has no sequence. */
  onSkipSlot?: () => void;
  /** Previews a feasibility alternative (allow an excluded exercise) before anything is saved. */
  onReviewChange?: (change: ProfileChange) => void;
  /** (#148) Opens the duration sheet. Absent in contexts that cannot change today's length. */
  onOpenLength?: () => void;
  /** (#149) Opens the gym sheet. */
  onOpenGym?: () => void;
  /** (#150) Opens the Switch sheet. */
  onOpenSwitch?: () => void;
  /** (#149) On a day nothing fits, another day in the split that does, in one sentence. */
  alternativeDay?: string;
  /** (#193) "Tell me about today", shown above the workout card while no session is open. */
  composer?: ReactNode;
  /** (#193) The composer is open or previewing: its button is the screen's one primary, so the dock steps aside. */
  composing?: boolean;
  /** (#193) False while a described session runs: it has no planned work to restore into. */
  canRestore?: boolean;
  /**
   * (#219) A described day's status and reasons, the composer preview's own; absent on a planned day.
   * (#220) While a described session runs, the session's own; absent once its day has passed.
   */
  described?: DayStatus | null;
  /** (#225) The backup reminder line (`backupReminder`), or null when no backup is due. */
  backup?: string | null;
  /** (#225) Back up now: the same action as Settings. */
  onBackup?: () => void;
  /** (#134) The day up next repeats muscles trained in the last 48 h: a fresher day to switch to. */
  fresher?: FresherDay | null;
  /** (#134) Switch to the fresher day: the Switch sheet's own pick. */
  onPickFresher?: (option: SwitchOption) => void;
  /** (#134) Keep the day up next; the offer is dismissed for today. */
  onKeepNext?: () => void;
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

function coachInsight(
  last: LastPerformance | null,
  first: ProgramExercise,
  unit: Unit,
  line: string | null,
  format: (kg: number) => string,
): string {
  // Built from the same prescription as the target, so it cannot contradict it.
  if (line) return line;
  if (!last) {
    return first.holdSeconds
      ? `First session on the ${first.name.toLowerCase()}. Hold it only as long as the set still looks strong.`
      : `First session on the ${first.name.toLowerCase()}. Start light enough that every rep looks the same.`;
  }
  const reps = setText(first.exerciseId, last.reps);
  // The load is what was actually logged, never the prescribed one.
  const load =
    last.weight > 0
      ? ` at ${format(last.weight)} ${unitLabel(unit)}${first.load === 'each' ? ' each' : ''}`
      : '';
  const target = first.targetReps?.[0];
  if (target !== undefined && target > Math.min(...last.reps)) {
    return `You finished ${reps} last time${load}. Aim for one more rep at the same load.`;
  }
  return `You finished ${reps} last time${load}. Repeat that, and stop the set when form goes.`;
}

/** Today v7 hero photo (owner-supplied), the same on every day. */
const HERO_PHOTO = '/hero/today.webp';

/** Top completed load per session for one exercise, oldest first, at most `limit` sessions. */
function topLoads(history: WorkoutRecord[], exerciseId: string, limit = 8): number[] {
  const loads: number[] = [];
  for (const workout of history) {
    const entry = workout.exercises.find((exercise) => exercise.exerciseId === exerciseId);
    const done = entry?.performed.filter((set) => set.done) ?? [];
    if (done.length === 0) continue;
    loads.push(Math.max(...done.map((set) => set.weight)));
    if (loads.length === limit) break;
  }
  return loads.reverse();
}

function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** Blue week card: today's sets as blocks, or this week's sessions. Holds its own toggle state. */
function WeekCard({ progress, total, week, targetDays }: { progress: number; total: number; week: number; targetDays: number }) {
  const [range, setRange] = useState<'today' | 'week'>('today');
  const blocks = range === 'today' ? total : targetDays;
  const filled = range === 'today' ? progress : week;
  return (
    <section className="t7-card t7-week" aria-label="This week">
      <div className="t7-week__copy">
        <h2>This week</h2>
        <p>Weekly goal: {week} of {targetDays} this week</p>
        {range === 'today' && <p>Each block is one set planned for today. Logged sets fill in.</p>}
      </div>
      <div
        className={`t7-blocks ${range === 'week' ? 't7-blocks--big' : ''}`}
        role="img"
        aria-label={range === 'today' ? `${filled} of ${blocks} sets logged today` : `${filled} sessions completed of the weekly goal`}
      >
        {Array.from({ length: blocks }).map((_, index) => (
          <i key={index} className={index < filled ? 'on' : ''} />
        ))}
      </div>
      <div className="t7-week__toggle" role="group" aria-label="Range">
        <button type="button" aria-pressed={range === 'today'} onClick={() => setRange('today')}>Today</button>
        <button type="button" aria-pressed={range === 'week'} onClick={() => setRange('week')}>Week</button>
      </div>
      <p className="t7-week__big">
        <b>{filled}/{blocks}</b>
        <span>{range === 'today' ? 'sets today' : 'sessions'}</span>
      </p>
    </section>
  );
}

export default function TodayScreen({
  profile,
  program,
  adapted: proposedWorkout,
  equipment,
  adjusted,
  history,
  current,
  now,
  onPreview,
  onAdjust,
  onWhy,
  onRestore,
  onOpenSettings,
  onOpenExercise,
  slotLabel,
  onSkipSlot,
  onReviewChange,
  onOpenLength,
  onOpenGym,
  onOpenSwitch,
  alternativeDay,
  composer,
  canRestore = true,
  composing = false,
  described,
  backup,
  onBackup,
  fresher,
  onPickFresher,
  onKeepNext,
}: Props) {
  const adapted = current ? currentWorkout(proposedWorkout, current) : proposedWorkout;
  const unit = unitOf(profile);
  const name = profile.name?.trim() || 'Athlete';
  const week = workoutsThisWeek(history, now);
  const targetDays = profile.daysPerWeek;
  const setup = setupFor(equipment, profile);
  // Equipment or exclusions can leave far less work than the requested time.
  const { minutes, approx } = todayGlance(proposedWorkout, current, false, profile.goal);
  // A day with nothing to do has no duration to promise.
  const timed = Boolean(current) || adapted.exercises.length > 0;
  const first = adapted.exercises[0];
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

  // Every day states its feasibility (story contract). The detail and alternatives stay in FeasibilityNote.
  const feasibility = program.feasibility;
  // A described day reads as its preview did (#219): Limited only for a gap it names.
  const chip: { tone: 'ready' | 'limited' | 'none'; label: string; icon: string } = described
    ? described.status === 'none' ? { tone: 'none', label: 'Not enough equipment', icon: 'remove' }
      : described.status === 'limited' ? { tone: 'limited', label: 'Limited', icon: 'info' }
      : { tone: 'ready', label: 'Ready', icon: 'check' }
    : adapted.exercises.length === 0 || feasibility?.status === 'infeasible'
      ? { tone: 'none', label: 'Not enough equipment', icon: 'remove' }
      : feasibility?.status === 'limited'
        ? {
            tone: 'limited',
            label:
              feasibility.selectedCount < feasibility.targetCount
                ? `Limited · ${feasibility.selectedCount} of ${feasibility.targetCount}`
                : 'Limited',
            icon: 'info',
          }
        : { tone: 'ready', label: 'Ready', icon: 'check' };
  // (#220) A running described session is today's own: its name, "Today only", never a plan slot,
  // and no chip once its ask has expired (App passes no status then).
  const todayOnly = current ? isDescribedSession(current) : false;
  const heroName = todayOnly && current ? current.name : program.name;
  const heroSlot = todayOnly ? 'Today only' : slotLabel;
  const leadId = leadCompoundId(adapted.exercises.map((exercise) => exercise.exerciseId));
  const leadName = adapted.exercises.find((exercise) => exercise.exerciseId === leadId)?.name;
  const loads = leadId ? topLoads(history, leadId).map((kg) => toDisplay(kg, unit)) : [];

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

        {onOpenLength && (
          <div className="t7-controls">
            <button
              type="button"
              className="t7-pill"
              onClick={onOpenLength}
              disabled={Boolean(current)}
              aria-label={`Workout length, ${adapted.minutes} minutes`}
            >
              <Icon name="schedule" size={16} />
              <span className="t7-pill__l">{adapted.minutes} min</span>
              <Icon name="expand_more" size={18} />
            </button>
            {onOpenGym && (
              <button
                type="button"
                className="t7-pill t7-pill--gym"
                onClick={onOpenGym}
                disabled={Boolean(current)}
                aria-label={`Equipment today, ${setup.chip}`}
              >
                <Icon name="fitness_center" size={16} />
                <span className="t7-pill__l">{setup.short}</span>
                <Icon name="expand_more" size={18} />
              </button>
            )}
            {onOpenSwitch && (
              <button type="button" className="t7-pill" onClick={onOpenSwitch} disabled={Boolean(current)} aria-label="Switch workout">
                <Icon name="arrow_forward" size={16} />
                <span className="t7-pill__l">Switch</span>
              </button>
            )}
          </div>
        )}

        <section
          className="t7-hero"
          aria-label={timed ? `${heroName}, ${minutes} minutes` : heroName}
        >
          <img className="t7-hero__photo" src={HERO_PHOTO} alt="" />
          <span className="t7-hero__top">
            <span className="t7-hero__eyebrow">{current ? 'In progress' : 'Your next workout'}</span>
            {adjusted && !current && <span className="aw-badge">Adjusted for today</span>}
          </span>
          <h2 className="t7-hero__title">
            {current
              ? `${current.name} in progress`
              : adapted.exercises.length === 0
                ? `Nothing in ${program.name} fits today`
                : `Your ${program.name} Day Starts Here!`}
          </h2>
          <span className="t7-hero__meta">
            {timed && (
              <>
                <Icon name="timer" size={16} />
                {approx ? '≈' : ''}
                {minutes} min <span aria-hidden="true">·</span>{' '}
              </>
            )}
            {setup.short}
            {heroSlot && (
              <>
                {' '}
                <span aria-hidden="true">·</span> {heroSlot}
              </>
            )}
          </span>
          {(!todayOnly || described) && (
            <span className={`t7-state t7-state--${chip.tone}`}>
              <Icon name={chip.icon} size={16} />
              {chip.label}
            </span>
          )}
        </section>

        {/* A described day names its gaps, open or not (#219); otherwise the status describes the saved setup. */}
        {described && <DescribedNote day={described} />}
        {!described && !current && !adjusted && (
          <FeasibilityNote feasibility={program.feasibility} profile={profile} onOpenSettings={onOpenSettings} onReviewChange={onReviewChange} />
        )}

        {fresher && onPickFresher && onKeepNext && !current && (
          <div className="feasibility" role="note">
            <p className="feasibility__line">{listAreas(fresher.areas)} trained {fresher.when}. {fresher.option.name} is fresher.</p>
            <p className="feasibility__reason">Switching skips {listAreas(fresher.option.skips)}.</p>
            <div className="feasibility__alts">
              <button className="feasibility__alt" onClick={() => onPickFresher(fresher.option)}>Switch to {fresher.option.name}</button>
              <button className="feasibility__alt feasibility__alt--text" onClick={onKeepNext}>Keep {fresher.nextName}</button>
            </div>
          </div>
        )}

        {/* (#225) Not mid-session: a backup taken now would miss the open session. */}
        {backup && onBackup && !current && (
          <div className="feasibility backup-note" role="note">
            <p className="feasibility__line">{backup}</p>
            <button className="feasibility__alt" onClick={onBackup}>Back up now</button>
          </div>
        )}

        {!current && composer}

        <section className="t7-card t7-workout" aria-label="The workout">
          <div className="list-head">
            <h2>The workout</h2>
            <span>
              {timed && `${approx ? '≈' : ''}${minutes} min · `}
              {adapted.totalSets} {adapted.totalSets === 1 ? 'set' : 'sets'}
            </span>
          </div>

          <div className="workout-list">
            {adapted.exercises.length === 0 && !adjusted && program.feasibility?.status === 'infeasible' && (
              <div className="empty-state">
                <p>Your equipment can’t cover {missingFamilies(program.feasibility)} yet. Add gear to fill this day.</p>
                <button className="text-action text-action--lime" onClick={onOpenSettings}>Edit equipment</button>
              </div>
            )}
            {adapted.exercises.length === 0 && (adjusted || program.feasibility?.status !== 'infeasible') && (
              <p className="empty-state">
                No movement in this program can be done with {setup.chip.toLowerCase()}. Choose
                another setup in Adjust today.
              </p>
            )}

            {adapted.exercises.map((exercise, index) => (
              <button
                className="workout-row"
                key={`${exercise.exerciseId}-${index}`}
                onClick={() => onOpenExercise(exercise.exerciseId, index)}
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
                      {exerciseMeta(exercise, exercise.sets, true, unit, plannedLoad(profile.loads, history, exercise.exerciseId, unit))}
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
                        {last && first ? lastSummary(first, last.sets, unit, plannedLoad(profile.loads, history, first.exerciseId, unit)) : '—'}
                      </span>
                    </span>
                    <span className="compare-line">
                      <span className="compare-line__label">Today’s target</span>
                      <span className="compare-line__value compare-line__value--target">
                        {targetSummary(exercise, exercise.sets, unit, plannedLoad(profile.loads, history, exercise.exerciseId, unit))}
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
                          {item.reason === 'time'
                            ? 'Skipped today'
                            : item.reason === 'excluded'
                              ? 'Excluded'
                              : 'No equipment'}
                        </span>
                      </span>
                      <span className="workout-row__meta">
                        {source ? exerciseMeta(source, source.sets, true, unit, plannedLoad(profile.loads, history, source.exerciseId, unit)) : `${item.sets} sets`}
                      </span>
                    </span>
                    <span className="workout-row__chev" aria-hidden="true" />
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="coach-card t7-card" aria-label={adjusted ? 'Coach note' : 'Coach insight'}>
          <div className="coach-card__head">
            <span className="t7-chip" aria-hidden="true"><Icon name="chat_bubble" size={12} />Coach</span>
            <div>
              <p className="coach-card__label">{adjusted ? 'Coach note' : 'Coach insight'}</p>
              <p className="coach-card__text">
                {adjusted
                  ? adapted.note
                  : current
                    ? `Session open. ${progress} of ${total} sets logged so far.`
                    : first
                      ? coachInsight(last, first, unit, targetCoachLine(first.exerciseId, profile, history, unit, first.exerciseId === leadCompoundId(adapted.exercises.map((exercise) => exercise.exerciseId)), adapted.setup), plannedLoad(profile.loads, history, first.exerciseId, unit))
                      : 'Pick a workout you can keep. The program follows from that.'}
              </p>
              {adapted.exercises.length === 0 && alternativeDay && <p className="coach-card__text">{alternativeDay}</p>}
            </div>
          </div>
          <div className="coach-card__actions">
            {adjusted && canRestore && (
              <button className="text-action text-action--lime" onClick={onRestore}>
                <Icon name="undo" size={16} />
                Restore original
              </button>
            )}
            <button className="text-action" onClick={onWhy} disabled={!first}>
              <Icon name="info" size={16} />
              Why this target
            </button>
            {onSkipSlot && !current && (
              <button className="text-action" onClick={onSkipSlot}>
                <Icon name="arrow_forward" size={16} />
                Skip this session
              </button>
            )}
          </div>
        </section>

        <WeekCard progress={progress} total={total} week={week} targetDays={targetDays} />

        {timed && (
          <section className="t7-card t7-session" aria-label="Session">
            <div className="t7-head">
              <span className="t7-head__l"><span className="t7-ico"><Icon name="timer" size={18} /></span><h2>Session</h2></span>
              <span className="t7-head__r">{minutes}<small>min</small></span>
            </div>
            <p className="t7-lead">{progress}<small>/{total} sets logged</small></p>
            <div className="t7-ticks" role="img" aria-label={`${progress} of ${total} sets logged`}>
              {Array.from({ length: total }).map((_, index) => (
                <i key={index} className={index < progress ? 'on' : ''} />
              ))}
            </div>
            <div className="t7-stats">
              <div><b>{adapted.exercises.length}</b><span>Exercises</span></div>
              <div><b>{total}</b><span>Sets</span></div>
            </div>
          </section>
        )}

        {leadId && leadName && (
          <section className="t7-card t7-lift" aria-label={`${leadName} top set`}>
            <div className="t7-head">
              <span className="t7-head__l"><span className="t7-ico"><Icon name="monitoring" size={18} /></span><h2>{leadName}</h2></span>
              <span className="t7-head__r t7-head__r--small">Top set</span>
            </div>
            <svg className="t7-chart" viewBox="0 0 280 90" preserveAspectRatio="none" aria-hidden="true">
              {loads.length > 1 ? (
                <polyline
                  fill="none"
                  stroke="#5c9ab5"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  points={loads
                    .map((value, index) => {
                      const lo = Math.min(...loads);
                      const hi = Math.max(...loads);
                      const y = hi === lo ? 45 : 80 - ((value - lo) / (hi - lo)) * 70;
                      return `${10 + (index * 260) / (loads.length - 1)},${y}`;
                    })
                    .join(' ')}
                />
              ) : (
                <line x1="10" y1="60" x2="270" y2="60" stroke="#cfe6ee" strokeWidth="4" strokeDasharray="2 10" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              )}
            </svg>
            <div className="t7-lift__foot">
              <b>{loads.length ? oneDecimal(loads[loads.length - 1]) : '—'}{loads.length > 0 && <small>{unitLabel(unit)}</small>}</b>
              <p>{loads.length ? `From your logged sets, last ${loads.length} ${loads.length === 1 ? 'session' : 'sessions'}.` : 'Log your first set to start this chart. No estimates.'}</p>
            </div>
          </section>
        )}
      </div>

      <div className="flow-dock" hidden={composing && !current}>
        <button className="text-action" onClick={onAdjust}>
          <Icon name="tune" size={16} />
          Short on time or gear?
        </button>
        {!current && (
          <button className="pill-primary" onClick={onPreview} disabled={adapted.exercises.length === 0}>
            Preview workout
            <Icon name="arrow_forward" size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
