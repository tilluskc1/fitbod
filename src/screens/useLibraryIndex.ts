import { useEffect, useState } from 'react';
import { libraryLoaded, loadLibraryIndex } from '../data/library';

/** (#431, shared by #432) The library index's load state for a screen or sheet that lists its rows. */
export type IndexLoad = 'loading' | 'ready' | 'offline';

/** The index, loaded once per app; offline it says so, and `retry` fetches again. */
export function useLibraryIndex(): { load: IndexLoad; retry: () => void } {
  const [load, setLoad] = useState<IndexLoad>(libraryLoaded() ? 'ready' : 'loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void loadLibraryIndex().then((ok) => live && setLoad(ok ? 'ready' : 'offline'));
    return () => {
      live = false;
    };
  }, [attempt]);
  return {
    load,
    retry: () => {
      setLoad('loading');
      setAttempt((n) => n + 1);
    },
  };
}
