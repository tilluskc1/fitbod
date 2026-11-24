import { useMemo, useState } from 'react';
import Sheet from './ui/Sheet';
import { LIBRARY_GROUPS, type LibraryGroup } from '../data/library';
import { PAGE, libraryEntries, searchLibrary } from '../lib/librarySearch';
import { LibraryEmpty, LibraryLoading, LibraryOffline } from '../screens/libraryParts';
import { useLibraryIndex } from '../screens/useLibraryIndex';

/**
 * (#432) Add exercise: the #431 search and muscle chips over the library's catalog rows, each with an
 * inline Add. Adding puts the row in this workout only; the plan and every other session stay as they are.
 * Built-ins are not listed: they join a workout through the plan, Swap and Replace (default picked by
 * product, owner can override).
 */

const CHIPS: readonly (LibraryGroup | 'All')[] = ['All', ...LIBRARY_GROUPS];

interface Props {
  workoutName: string;
  onAdd: (id: string) => void;
  onClose: () => void;
}

export default function AddExerciseSheet({ workoutName, onAdd, onClose }: Props) {
  const { load, retry } = useLibraryIndex();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<LibraryGroup | 'All'>('All');
  const [shown, setShown] = useState(PAGE);

  const entries = useMemo(() => (load === 'ready' ? libraryEntries().filter((entry) => entry.tier !== 'program') : []), [load]);
  const results = useMemo(() => searchLibrary(entries, query, group), [entries, query, group]);
  const more = Math.min(PAGE, results.length - shown);

  const pick = (item: LibraryGroup | 'All') => {
    setGroup(item);
    setShown(PAGE);
  };

  return (
    <Sheet title="Add exercise" sub2={`Adds to this ${workoutName} only. Your plan stays.`} onClose={onClose} headingId="add-title">
      <div className="add-sheet">
        <label className="sr-only" htmlFor="add-search">
          Search exercises
        </label>
        <input
          id="add-search"
          className="search"
          type="search"
          placeholder="Search exercises…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setShown(PAGE);
          }}
        />

        <div className="chip-row" role="group" aria-label="Filter by muscle">
          {CHIPS.map((item) => (
            <button key={item} className={`chip ${group === item ? 'on' : ''}`} aria-pressed={group === item} onClick={() => pick(item)}>
              {item}
            </button>
          ))}
        </div>

        {load === 'loading' && <LibraryLoading />}

        {load === 'offline' && <LibraryOffline onRetry={retry} />}

        {load === 'ready' && results.length === 0 && <LibraryEmpty query={query} group={group} onClear={() => pick('All')} />}

        {load === 'ready' && results.length > 0 && (
          <>
            <p className="ex-status add-count" role="status">
              {results.length} {results.length === 1 ? 'result' : 'results'}
            </p>
            <ul className="ex-list" aria-label="Exercises to add">
              {results.slice(0, shown).map((entry) => (
                <li key={entry.id} className="ex-row ex-row--add">
                  <span className="ex-row__body">
                    <strong className="ex-row__name">{entry.name}</strong>
                    <span className="ex-row__meta">
                      {entry.muscle} · {entry.equipment}
                    </span>
                  </span>
                  <button className="pill-quiet ex-add" aria-label={`Add ${entry.name}`} onClick={() => onAdd(entry.id)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
            {more > 0 && (
              <button className="secondary ex-more" onClick={() => setShown((n) => n + PAGE)}>
                Show {more} more
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
