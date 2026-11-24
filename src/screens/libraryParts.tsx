import { useEffect, useState } from 'react';
import { loadLibraryText, type LibraryGroup } from '../data/library';
import './exercises.css';

/**
 * (#431, shared by #432) The library's states, one markup for every place that lists or reads library
 * rows: the Exercises screen, the Add exercise sheet and an added row's instructions.
 */

export function LibraryLoading() {
  return (
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
  );
}

export function LibraryOffline({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="empty-state ex-state">
      <p>
        <b>The exercise list needs a connection once.</b> Your plan and everything you've logged still work.
      </p>
      <button className="secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

export function LibraryEmpty({ query, group, onClear }: { query: string; group: LibraryGroup | 'All'; onClear: () => void }) {
  return (
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
          <button className="secondary" onClick={onClear}>
            Clear muscle filter
          </button>
        </>
      )}
    </div>
  );
}

type TextLoad = { state: 'loading' } | { state: 'ready'; steps: string[] } | { state: 'offline' };

/**
 * A row's written steps. A built-in passes its own text (`steps`), so it needs no download; a library row
 * loads them, with a loading state and an offline state that retries. Text only: no demo is announced.
 */
export function LibrarySteps({ id, steps }: { id: string; steps?: string[] }) {
  const own = steps !== undefined;
  const [text, setText] = useState<TextLoad>(own ? { state: 'ready', steps } : { state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (own) return;
    let live = true;
    void loadLibraryText(id).then((loaded) => live && setText(loaded ? { state: 'ready', steps: loaded } : { state: 'offline' }));
    return () => {
      live = false;
    };
  }, [own, id, attempt]);

  return (
    <>
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
    </>
  );
}
