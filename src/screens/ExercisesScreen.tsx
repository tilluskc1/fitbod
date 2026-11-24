import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { LIBRARY_GROUPS, libraryLoaded, loadLibraryIndex, loadLibraryText, type LibraryGroup } from '../data/library';
import { PAGE, libraryEntries, searchLibrary, youLog, type LibraryEntry } from '../lib/librarySearch';
import { BackIcon, ChevronIcon } from '../components/ui/Icons';
import './exercises.css';

/**
 * (#431) Exercises: browse, search and read every exercise, the 62 built-ins first and the
 * free-exercise-db library after them. Text only. Browse only: nothing here adds to a plan or a workout.
 */

interface Props {
  onBack: () => void;
}

type Load = 'loading' | 'ready' | 'offline';

const CHIPS = ['All', ...LIBRARY_GROUPS] as const;

export default function ExercisesScreen({ onBack }: Props) {
  const [load, setLoad] = useState<Load>(libraryLoaded() ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<LibraryGroup | 'All'>('All');
  const [shown, setShown] = useState(PAGE);
  const [openId, setOpenId] = useState<string | null>(null);
  // The list's scroll position, put back when a detail closes.
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);

  useEffect(() => {
    let live = true;
    void loadLibraryIndex().then((ok) => live && setLoad(ok ? 'ready' : 'offline'));
    return () => {
      live = false;
    };
  }, [attempt]);

  const entries = useMemo(() => (load === 'ready' ? libraryEntries() : []), [load]);
  // The whole ranked list once per query and chip; "Show more" only reveals more of it.
  const results = useMemo(() => searchLibrary(entries, query, group), [entries, query, group]);
  const open = openId ? entries.find((entry) => entry.id === openId) : undefined;

  const retry = () => {
    setLoad('loading');
    setAttempt((n) => n + 1);
  };
  const search = (value: string) => {
    setQuery(value);
    setShown(PAGE);
  };
  const pick = (value: LibraryGroup | 'All') => {
    setGroup(value);
    setShown(PAGE);
  };
  const openDetail = (id: string) => {
    scrollTop.current = listRef.current?.scrollTop ?? 0;
    setOpenId(id);
  };
  useLayoutEffect(() => {
    if (!openId && listRef.current) listRef.current.scrollTop = scrollTop.current;
  }, [openId]);

  if (open) return <Detail entry={open} onBack={() => setOpenId(null)} />;

  const more = Math.min(PAGE, results.length - shown);
  return (
    <div className="screen no-tabs ex-screen" ref={listRef}>
      <button className="ex-back" onClick={onBack}>
        <BackIcon />
        Plan
      </button>
      <h1 className="page-title">Exercises.</h1>

      <label className="sr-only" htmlFor="ex-search">
        Search exercises
      </label>
      <input
        id="ex-search"
        className="search"
        type="search"
        placeholder="Search exercises…"
        value={query}
        onChange={(event) => search(event.target.value)}
      />

      <div className="chip-row" role="group" aria-label="Filter by muscle">
        {CHIPS.map((item) => (
          <button key={item} className={`chip ${group === item ? 'on' : ''}`} aria-pressed={group === item} onClick={() => pick(item)}>
            {item}
          </button>
        ))}
      </div>

      {load === 'loading' && (
        <>
          <p role="status" className="ex-status">
            Loading exercises…
          </p>
          <div className="ex-list" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="ex-row ex-row--skeleton" key={index}>
                <span className="ex-skel ex-skel--name" />
                <span className="ex-skel ex-skel--meta" />
              </div>
            ))}
          </div>
        </>
      )}

      {load === 'offline' && (
        <div className="empty-state ex-state">
          <p>
            <b>The exercise list needs a connection once.</b> Your plan and everything you've logged still work.
          </p>
          <button className="secondary" onClick={retry}>
            Try again
          </button>
        </div>
      )}

      {load === 'ready' && results.length === 0 && (
        <div className="empty-state ex-state">
          {group === 'All' ? (
            <>
              <p>
                <b>No matches for "{query.trim()}"</b>
              </p>
              <p>Check the spelling.</p>
            </>
          ) : (
            <>
              <p>
                <b>
                  No matches for "{query.trim()}" with {group} selected
                </b>
              </p>
              <p>Check the spelling, or search all muscles.</p>
              <button className="secondary" onClick={() => pick('All')}>
                Clear muscle filter
              </button>
            </>
          )}
        </div>
      )}

      {load === 'ready' && results.length > 0 && (
        <>
          <ul className="ex-list" aria-label="Exercises">
            {results.slice(0, shown).map((entry) => (
              <li key={entry.id}>
                <button className="ex-row" onClick={() => openDetail(entry.id)}>
                  <span className="ex-row__body">
                    <strong className="ex-row__name">{entry.name}</strong>
                    <span className="ex-row__meta">
                      {entry.equipment} · {entry.muscle}
                    </span>
                  </span>
                  <span className="chev">
                    <ChevronIcon />
                  </span>
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
  );
}

type TextLoad = { state: 'loading' } | { state: 'ready'; steps: string[] } | { state: 'offline' };

function Detail({ entry, onBack }: { entry: LibraryEntry; onBack: () => void }) {
  const builtIn = entry.tier === 'program';
  const [text, setText] = useState<TextLoad>(
    builtIn ? { state: 'ready', steps: entry.instructions ? [entry.instructions] : [] } : { state: 'loading' },
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (builtIn) return;
    let live = true;
    void loadLibraryText(entry.id).then((steps) => live && setText(steps ? { state: 'ready', steps } : { state: 'offline' }));
    return () => {
      live = false;
    };
  }, [builtIn, entry.id, attempt]);

  const facts: [string, string][] = [
    ['Muscle', entry.muscle],
    ['Equipment', entry.equipment],
    ...(entry.level ? ([['Level', entry.level[0].toUpperCase() + entry.level.slice(1)]] as [string, string][]) : []),
    ['You log', youLog(entry)],
  ];

  return (
    <div className="screen no-tabs ex-screen">
      <button className="ex-back" onClick={onBack}>
        <BackIcon />
        Exercises
      </button>
      <h1 className="page-title ex-detail__title">{entry.name}</h1>

      <dl className="ex-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {text.state === 'loading' && (
        <div className="ex-steps">
          <div aria-hidden="true">
            <span className="ex-skel ex-skel--line" />
            <span className="ex-skel ex-skel--line" />
            <span className="ex-skel ex-skel--line ex-skel--short" />
          </div>
          <p role="status" className="ex-status">
            Loading instructions…
          </p>
        </div>
      )}

      {text.state === 'offline' && (
        <div className="empty-state ex-state">
          <p>
            <b>Instructions aren't saved on this phone yet.</b> Connect once and they stay for offline use.
          </p>
          <button
            className="secondary"
            onClick={() => {
              setText({ state: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}

      {text.state === 'ready' && text.steps.length > 0 && (
        <ol className="ex-steps">
          {text.steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      )}

      {!builtIn && <p className="data-note ex-footer">Browse only for now. Library exercises aren't used in generated plans.</p>}
    </div>
  );
}
