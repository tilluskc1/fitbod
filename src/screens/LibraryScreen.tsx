import { useMemo, useState } from 'react';
import { EXERCISES, MUSCLE_GROUPS } from '../data/exercises';
import type { ExercisePreference, MuscleGroup, Profile } from '../types';
import { conflicts, resetPreferences, withExclusion, withPreference } from '../lib/preferences';
import Photo from '../components/ui/Photo';
import Sheet from '../components/ui/Sheet';
import Demo from '../components/ui/Demo';
import { BackIcon, ChevronIcon } from '../components/ui/Icons';

interface Props {
  profile: Profile;
  onSave: (patch: Partial<Profile>) => void;
  onBack: () => void;
}

interface PendingChange {
  title: string;
  detail: string;
  patch: Partial<Profile>;
}

const NONE: Record<string, ExercisePreference> = {};
const PREF_LABEL: Record<ExercisePreference, string> = { more: 'More often', less: 'Less often' };
const FUTURE = 'Applies to future workouts only. Logged workouts stay exactly as they are.';

export default function LibraryScreen({ profile, onSave, onBack }: Props) {
  const { exclusions } = profile;
  const preferences = profile.preferences ?? NONE;
  const prefCount = Object.keys(preferences).length;
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'All' | 'Saved'>('All');
  const [openId, setOpenId] = useState<string | null>(null);
  // Every change is previewed here first; cancelling discards it untouched.
  const [pending, setPending] = useState<PendingChange | null>(null);
  const conflicted = conflicts(profile);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXERCISES.filter((exercise) => {
      const matchesQuery =
        !q ||
        exercise.name.toLowerCase().includes(q) ||
        exercise.muscles.some((item) => item.toLowerCase().includes(q));
      const matchesMuscle =
        muscle === 'All' ||
        (muscle === 'Saved'
          ? exclusions.includes(exercise.id) || preferences[exercise.id] !== undefined
          : exercise.muscles.includes(muscle));
      return matchesQuery && matchesMuscle;
    });
  }, [query, muscle, exclusions, preferences]);

  return (
    <div className="screen no-tabs">
      <div className="train-bar" style={{ gridTemplateColumns: '44px 1fr 44px' }}>
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <h1>Exercise library</h1>
        <span />
      </div>

      <p className="page-sub" style={{ margin: '4px 4px 0' }}>
        {EXERCISES.length} exercises{exclusions.length > 0 ? ` · ${exclusions.length} excluded` : ''}
        {prefCount > 0 ? ` · ${prefCount} with a preference` : ''}
        {conflicted.length > 0 ? ` · ${conflicted.length} to review` : ''}
      </p>

      {prefCount > 0 && (
        <button
          className="secondary"
          style={{ marginTop: 10 }}
          onClick={() =>
            setPending({
              title: 'Reset preferences?',
              detail: `Clears ${prefCount} more/less often ${prefCount === 1 ? 'choice' : 'choices'}. Exclusions and workout records are not touched. ${FUTURE}`,
              patch: resetPreferences(),
            })
          }
        >
          Reset preferences
        </button>
      )}

      <label className="sr-only" htmlFor="exercise-search">
        Search exercises
      </label>
      <input
        id="exercise-search"
        className="search"
        type="search"
        placeholder="Search exercises…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="chip-row" role="group" aria-label="Filter by muscle group">
        <button className={`chip ${muscle === 'All' ? 'on' : ''}`} aria-pressed={muscle === 'All'} onClick={() => setMuscle('All')}>
          All
        </button>
        {/* minHeight stretches the whole row to 44px targets. */}
        <button
          className={`chip ${muscle === 'Saved' ? 'on' : ''}`}
          aria-pressed={muscle === 'Saved'}
          onClick={() => setMuscle('Saved')}
          style={{ minHeight: 44 }}
        >
          Your choices
        </button>
        {MUSCLE_GROUPS.map((item) => (
          <button
            key={item}
            className={`chip ${muscle === item ? 'on' : ''}`}
            aria-pressed={muscle === item}
            onClick={() => setMuscle(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {filtered.length === 0 && <p className="note-card">No exercises match those filters.</p>}

      <div>
        {filtered.map((exercise) => {
          const excluded = exclusions.includes(exercise.id);
          const pref = preferences[exercise.id];
          const open = openId === exercise.id;
          const ask = (value: ExercisePreference | null) =>
            setPending({
              title: value ? `${PREF_LABEL[value]}: ${exercise.name}?` : `Neutral: ${exercise.name}?`,
              detail:
                (value === 'more'
                  ? 'Picked ahead of similar exercises when a workout is generated. '
                  : value === 'less'
                    ? 'Picked after similar exercises, but still used when nothing else fits. '
                    : 'Back to the default order. ') +
                (excluded && value ? 'It stays excluded until you choose which to keep. ' : '') +
                FUTURE,
              patch: withPreference(profile, exercise.id, value),
            });
          return (
            <div key={exercise.id}>
              <button
                className="lib-row"
                onClick={() => setOpenId(open ? null : exercise.id)}
                aria-expanded={open}
              >
                <Photo exerciseId={exercise.id} name={exercise.name} className="row-photo" />
                <span className="row-body">
                  <strong className="row-name" style={{ opacity: excluded ? 0.55 : 1 }}>
                    {exercise.name}
                  </strong>
                  <span className="row-meta">
                    {exercise.equipment} · {exercise.muscles.join(', ')}
                    {excluded ? ' · excluded' : ''}
                    {pref ? ` · ${PREF_LABEL[pref].toLowerCase()}` : ''}
                  </span>
                </span>
                <span className="chev" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>
                  <ChevronIcon />
                </span>
              </button>

              {open && (
                <div className="lib-detail">
                  <Demo exerciseId={exercise.id} name={exercise.name} className="lib-photo" />
                  <p className="lib-instructions">{exercise.instructions}</p>
                  {excluded && pref && (
                    <div className="note-card" role="status" style={{ marginTop: 14 }}>
                      Excluded and marked {PREF_LABEL[pref].toLowerCase()}. The exclusion wins until you pick one.
                      <div className="sheet-actions" style={{ marginTop: 12 }}>
                        <button
                          className="secondary"
                          onClick={() =>
                            setPending({
                              title: `Keep ${exercise.name} excluded?`,
                              detail: `Removes the ${PREF_LABEL[pref].toLowerCase()} preference. ${FUTURE}`,
                              patch: withPreference(profile, exercise.id, null),
                            })
                          }
                        >
                          Keep exclusion
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            setPending({
                              title: `Keep ${exercise.name} ${PREF_LABEL[pref].toLowerCase()}?`,
                              detail: `Allows it in workouts again. ${FUTURE}`,
                              patch: withExclusion(profile, exercise.id, false),
                            })
                          }
                        >
                          Keep {PREF_LABEL[pref].toLowerCase()}
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="segmented" role="group" aria-label={`How often to recommend ${exercise.name}`}>
                    {(['more', null, 'less'] as const).map((value) => (
                      <button
                        key={value ?? 'neutral'}
                        className={(pref ?? null) === value ? 'on' : ''}
                        aria-pressed={(pref ?? null) === value}
                        onClick={() => (pref ?? null) !== value && ask(value)}
                      >
                        {value ? PREF_LABEL[value] : 'Neutral'}
                      </button>
                    ))}
                  </div>
                  <div>
                    <button
                      className={excluded ? 'primary' : 'secondary'}
                      onClick={() =>
                        setPending({
                          title: excluded ? `Allow ${exercise.name} again?` : `Don't recommend ${exercise.name} again?`,
                          detail: `${excluded ? 'It can be programmed again.' : 'It is never programmed; the generator reports a coverage gap instead of substituting silently.'} ${FUTURE}`,
                          patch: withExclusion(profile, exercise.id, !excluded),
                        })
                      }
                    >
                      {excluded ? 'Allow in workouts' : "Don't recommend again"}
                    </button>
                    <p className="data-note">
                      {excluded
                        ? 'Excluded exercises are never programmed. The generator reports a coverage gap instead of substituting silently.'
                        : 'Excluding removes this exercise from future sessions. Nothing changes retroactively.'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pending && (
        <Sheet title={pending.title} onClose={() => setPending(null)}>
          <p className="sheet-copy">{pending.detail}</p>
          <div className="sheet-actions">
            <button
              className="primary"
              onClick={() => {
                onSave(pending.patch);
                setPending(null);
              }}
            >
              Confirm
            </button>
            <button className="secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
