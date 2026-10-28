import { useMemo, useState } from 'react';
import { EXERCISES, MUSCLE_GROUPS } from '../data/exercises';
import type { MuscleGroup } from '../types';
import Photo from '../components/ui/Photo';
import Demo from '../components/ui/Demo';
import { BackIcon, ChevronIcon } from '../components/ui/Icons';

interface Props {
  exclusions: string[];
  onToggleExclusion: (exerciseId: string) => void;
  onBack: () => void;
}

export default function LibraryScreen({ exclusions, onToggleExclusion, onBack }: Props) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | 'All'>('All');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EXERCISES.filter((exercise) => {
      const matchesQuery =
        !q ||
        exercise.name.toLowerCase().includes(q) ||
        exercise.muscles.some((item) => item.toLowerCase().includes(q));
      const matchesMuscle = muscle === 'All' || exercise.muscles.includes(muscle);
      return matchesQuery && matchesMuscle;
    });
  }, [query, muscle]);

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
      </p>

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
          const open = openId === exercise.id;
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
                  <div style={{ marginTop: 14 }}>
                    <button
                      className={excluded ? 'primary' : 'secondary'}
                      onClick={() => onToggleExclusion(exercise.id)}
                    >
                      {excluded ? 'Allow in workouts' : 'Avoid this exercise'}
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
    </div>
  );
}
