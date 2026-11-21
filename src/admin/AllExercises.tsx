import { useMemo, useState } from 'react';
import type { Entry } from '../lib/adminCatalog';
import type { MovementPattern, MuscleGroup } from '../types';
import { NO_FILTER, allExercises, countOf, daysFor, filterOptions, filterRows, patternLabel, type Filter, type ListRow } from './allExercisesData';

/**
 * (#377) /admin Exercises > All exercises: every built-in exercise and every addition, one row each.
 * Read-only: no row here writes anything; additions are edited in the Added list (#360).
 */

const tagClass = (row: ListRow) => `adm-chip${row.tag === 'Built-in' || row.tag === 'Added' ? '' : ' adm-chip--quiet'}`;

const STATUS_NOTE: Partial<Record<ListRow['tag'], string>> = {
  Draft: 'Draft: phones do not have it yet.',
  Unpublished: 'Unpublished: phones no longer plan it; past workouts keep it.',
};

export default function AllExercises({ entries, raw }: { entries: Entry[]; raw: Array<Record<string, unknown>> }) {
  const rows = useMemo(() => allExercises(entries, raw), [entries, raw]);
  const [filter, setFilter] = useState<Filter>(NO_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const count = countOf(rows);
  const options = useMemo(() => filterOptions(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const open = openId ? rows.find((row) => row.id === openId) : undefined;
  const set = (patch: Partial<Filter>) => setFilter((current) => ({ ...current, ...patch }));
  const filtered = filter.query.trim() || filter.muscle || filter.pattern || filter.equipment;

  if (open) return <Detail row={open} onBack={() => setOpenId(null)} />;

  return (
    <section aria-label="All exercises" className="adm-all">
      <p className="adm-muted adm-all__count" role="status">
        {count.total} exercises: {count.builtIn} built-in, {count.added} added, {count.draft} draft
        {count.unpublished ? `. Also ${count.unpublished} unpublished, not counted.` : '.'}
      </p>
      <div className="adm-all__filters">
        <label className="adm-field adm-all__search">
          <span>Search</span>
          <input className="search" type="search" value={filter.query} placeholder="Exercise name" onChange={(event) => set({ query: event.target.value })} />
        </label>
        <label className="adm-field">
          <span>Primary muscle</span>
          <select className="search" value={filter.muscle} onChange={(event) => set({ muscle: event.target.value as MuscleGroup | '' })}>
            <option value="">Any muscle</option>
            {options.muscles.map((muscle) => <option key={muscle} value={muscle}>{muscle}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Pattern</span>
          <select className="search" value={filter.pattern} onChange={(event) => set({ pattern: event.target.value as MovementPattern | '' })}>
            <option value="">Any pattern</option>
            {options.patterns.map((pattern) => <option key={pattern} value={pattern}>{patternLabel(pattern)}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Equipment</span>
          <select className="search" value={filter.equipment} onChange={(event) => set({ equipment: event.target.value as Filter['equipment'] })}>
            <option value="">Any equipment</option>
            {options.equipment.map((family) => <option key={family} value={family}>{family}</option>)}
          </select>
        </label>
      </div>
      {filtered && (
        <div className="adm-all__showing">
          <span className="adm-muted">Showing {shown.length} of {rows.length}</span>
          <button type="button" className="pill-quiet" onClick={() => setFilter(NO_FILTER)}>Clear filters</button>
        </div>
      )}
      {shown.length === 0 ? (
        <p className="adm-empty">No exercise matches this search and these filters.</p>
      ) : (
        <ul className="adm-list adm-all__list">
          {shown.map((row) => (
            <li key={row.id}>
              <button type="button" className="adm-card adm-all__row" onClick={() => setOpenId(row.id)}>
                <Thumb row={row} />
                <span className="adm-all__main">
                  <span className="adm-all__name">{row.name}</span>
                  <span className="adm-muted adm-all__meta">
                    {row.pattern ? patternLabel(row.pattern) : 'No pattern'} · {row.muscles.join(', ') || 'No muscles'} · {row.equipment}
                  </span>
                </span>
                <span className={tagClass(row)}>{row.tag}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Thumb({ row, large = false }: { row: ListRow; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const className = large ? 'adm-all__photo' : 'adm-all__thumb';
  if (!row.photo || broken) return <span className={`${className} adm-all__nophoto`} aria-hidden="true">No photo</span>;
  return <img className={className} src={row.photo} alt="" loading="lazy" onError={() => setBroken(true)} />;
}

function Detail({ row, onBack }: { row: ListRow; onBack: () => void }) {
  const days = daysFor(row);
  return (
    <section aria-label={row.name} className="adm-all__detail">
      <button type="button" className="pill-quiet" onClick={onBack}>‹ Back to all exercises</button>
      <h2 className="adm-card__title adm-cat__heading">
        {row.name}
        <span className={tagClass(row)}>{row.tag}</span>
      </h2>
      <div className="adm-card adm-all__card">
        <Thumb row={row} large />
        {row.partial && (
          <p className="adm-error" role="status">Some saved data is missing or not valid. Phones skip this entry until it is saved again in full.</p>
        )}
        <dl className="adm-all__facts">
          <div><dt>Muscles</dt><dd>{row.muscles.join(', ') || 'None'}</dd></div>
          <div><dt>Pattern</dt><dd>{row.pattern ? patternLabel(row.pattern) : 'None'}</dd></div>
          <div><dt>Equipment</dt><dd>{row.equipment}{row.needs !== 'nothing' && row.needs.toLowerCase() !== row.equipment.toLowerCase() ? ` (needs ${row.needs})` : ''}</dd></div>
          <div><dt>ID</dt><dd>{row.id}</dd></div>
        </dl>
        <div className="adm-coach" role="status">
          <strong>Coach check</strong>
          <p>{days.length ? `Would appear in: ${days.join(', ')}.` : 'The planner would not put this exercise on any day.'}</p>
          {STATUS_NOTE[row.tag] && <p className="adm-muted">{STATUS_NOTE[row.tag]}</p>}
        </div>
        <h3 className="adm-all__label">Instructions</h3>
        <p className="adm-all__text">{row.instructions || 'None saved.'}</p>
        <h3 className="adm-all__label">Cues</h3>
        {row.cues.length ? (
          <ul className="adm-all__cues">{row.cues.map((cue) => <li key={cue}>{cue}</li>)}</ul>
        ) : (
          <p className="adm-muted">{row.tag === 'Built-in' ? 'None. The how-to shows the first sentences of the instructions.' : 'None saved.'}</p>
        )}
        <h3 className="adm-all__label">Media credit</h3>
        <p className="adm-all__text">
          {row.credit ?? 'No photo or video.'}
          {row.source && <span className="adm-muted adm-all__source"> Source: {row.source}</span>}
        </p>
      </div>
    </section>
  );
}
