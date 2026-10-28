import { useState } from 'react';
import type { AppState } from '../types';
import type { ImportSummary } from '../lib/storage';
import { EMPTY_STATE, mergeImport } from '../lib/storage';
import { parseState } from '../lib/validate';

interface Props {
  error: string;
  raw: string;
  onDownload: () => void;
  onRestore: (state: AppState, summary: ImportSummary) => void;
  onStartFresh: () => void;
}

export default function Recovery({ error, raw, onDownload, onRestore, onStartFresh }: Props) {
  const [pending, setPending] = useState<{ filename: string; state: AppState } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setPending(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError('The file could not be read. Nothing was changed.');
      return;
    }
    const parsed = parseState(text);
    if (!parsed.ok) {
      setFileError(parsed.error);
      return;
    }
    setFileError(null);
    setPending({ filename: file.name, state: mergeImport(EMPTY_STATE, parsed.state).state });
  };

  return (
    <div className="recovery">
      <div className="onboarding-top">
        <div className="logo">
          YOUR STRENGTH <b>·</b> COACH
        </div>
      </div>

      <h1 className="greeting">Saved data could not be loaded</h1>
      <p className="muted">{error}</p>
      <p className="muted">
        Nothing has been overwritten. Download the original data first if you want to inspect it, or
        restore a JSON backup you exported earlier.
      </p>

      <div className="card recovery-card">
        <div className="card-eyebrow">ORIGINAL DATA</div>
        <p className="muted">
          {raw.length.toLocaleString()} characters are stored under the app&apos;s storage key.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="secondary" onClick={onDownload}>
            Download original
          </button>
          <label className="secondary" style={{ position: 'relative', cursor: 'pointer' }}>
            Restore backup
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                void chooseFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
        </div>

        {fileError && (
          <p className="error-text" role="alert">
            {fileError}
          </p>
        )}

        {pending && (
          <div className="note-card" style={{ marginTop: 14 }}>
            <p style={{ fontWeight: 500 }}>Restore “{pending.filename}”?</p>
            <p className="muted" style={{ marginTop: 6 }}>
              This replaces the unreadable data with the contents of the backup. The original is kept
              under a separate browser-storage key as a safety copy.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="primary"
                style={{ minHeight: 46, fontSize: 14 }}
                onClick={() => onRestore(pending.state, {
                  newWorkouts: pending.state.history.length,
                  duplicateWorkouts: 0,
                  localOnlyWorkouts: 0,
                  profileReplaced: pending.state.profile !== null,
                  planReplaced: pending.state.plan.length > 0,
                  activeSessionKept: false,
                })}
              >
                Confirm restore
              </button>
              <button className="secondary" style={{ minHeight: 46, fontSize: 14 }} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <button
        className="danger"
        onClick={() => {
          if (window.confirm('Start with empty data? The unreadable data is backed up first, but your app will look new.')) {
            onStartFresh();
          }
        }}
      >
        Start fresh
      </button>
    </div>
  );
}
