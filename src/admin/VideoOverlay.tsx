import { useState } from 'react';
import { BUCKET, mediaUrl } from '../lib/additions';
import { LICENCE_LABELS, fieldsOf, fileProblem, overlayPath, overlayProblems, overlayRow, type Overlay, type OverlayDraft, type Status } from '../lib/adminCatalog';
import { AdminError, uploadMedia, writeCatalog } from './api';
import { videoSeconds } from './videoSeconds';

/**
 * (#387) "Add video" on a built-in exercise's detail: attach one clip with its rights, publish it, unpublish
 * it. Writes a `media-<exercise id>` row in `catalog`; the built-in exercise itself is never edited. The
 * rules are the lock; this only explains what is missing.
 */

const NOTE: Record<Status, string> = {
  draft: 'No video yet.',
  published: 'Video published. Phones get it the next time the app opens online.',
  unpublished: 'Unpublished. Phones show "No video yet" for this exercise.',
};

interface Props {
  exerciseId: string;
  name: string;
  overlay?: Overlay;
  token: string;
  onFail: (error: unknown) => void;
  onSaved: (overlay: Overlay) => void;
}

export default function VideoOverlay({ exerciseId, name, overlay, token, onFail, onSaved }: Props) {
  const saved = overlay?.row;
  const [draft, setDraft] = useState<OverlayDraft>({ source: saved?.source ?? '', licence: saved?.licence ?? '', credit: saved?.credit ?? '' });
  const [file, setFile] = useState<File | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const status: Status = overlay?.status ?? 'draft';
  const set = (patch: Partial<OverlayDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  };
  const problems = [...overlayProblems(draft, Boolean(file || saved)), ...(fileError ? [fileError] : [])];

  const choose = async (chosen: File | undefined) => {
    setMessage(null);
    const problem = chosen ? fileProblem('video', chosen, await videoSeconds(chosen)) : null;
    setFileError(problem ?? undefined);
    setFile(problem ? undefined : chosen);
  };

  const save = async (next: Status) => {
    if (busy || (next === 'published' && problems.length) || (next === 'unpublished' && !saved)) return;
    setBusy(true);
    setMessage(null);
    try {
      let video = saved?.video;
      if (next === 'published' && file) {
        video = overlayPath(exerciseId, Date.now());
        await uploadMedia(token, BUCKET, video, file);
      }
      // Unpublish writes the saved row again, rights and clip as they were, with a new status.
      const row = video ? overlayRow(exerciseId, video, next === 'published' ? draft : { source: saved!.source, licence: saved!.licence, credit: saved!.credit }) : null;
      if (!row) {
        setMessage({ ok: false, text: 'Something in this entry is not valid. Check each field.' });
        return;
      }
      await writeCatalog(token, row.id, fieldsOf(row, next, new Date()), false);
      onSaved({ row, status: next });
      setFile(undefined);
      setMessage({ ok: true, text: next === 'published' ? 'Published. Phones get it the next time the app opens online.' : 'Unpublished. Phones show "No video yet" again.' });
    } catch (error) {
      if (error instanceof AdminError && error.kind !== 'offline') onFail(error);
      else setMessage({ ok: false, text: 'Not saved. Check the connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="adm-field adm-media" aria-label={`Video for ${name}`}>
      <legend>Video</legend>
      <p className="adm-muted" role="status">{NOTE[status]}</p>
      <p className="adm-muted">MP4, up to 10 MB and 15 seconds. Your own work, CC0, CC BY or public domain.</p>
      {saved && !file && (
        <video className="adm-media__video" src={mediaUrl(saved.video)} controls muted playsInline preload="metadata" aria-label={`${name} video`} />
      )}
      <label className="adm-file">
        <span>{saved ? 'Replace video' : 'Add video'}</span>
        <input type="file" accept="video/mp4" onChange={(event) => void choose(event.target.files?.[0])} />
      </label>
      {fileError && <p className="adm-error" role="alert">{fileError}</p>}
      <label className="adm-field">
        <span>Source (link or where it came from)</span>
        <input className="search" value={draft.source} maxLength={300} onChange={(event) => set({ source: event.target.value })} />
      </label>
      <label className="adm-field">
        <span>Licence</span>
        <select className="search" value={draft.licence} onChange={(event) => set({ licence: event.target.value as OverlayDraft['licence'] })}>
          <option value="">Pick one</option>
          {LICENCE_LABELS.map((licence) => <option key={licence.value} value={licence.value}>{licence.label}</option>)}
        </select>
      </label>
      <label className="adm-field">
        <span>Credit (shown in the app's About)</span>
        <input className="search" value={draft.credit} maxLength={120} onChange={(event) => set({ credit: event.target.value })} />
      </label>
      {problems.length > 0 && status !== 'published' && <p className="adm-muted" role="status">Can't publish yet: {problems.join(' ')}</p>}
      {message && <p className={message.ok ? 'adm-ok' : 'adm-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
      <div className="adm-cat__actions">
        <button type="button" className="pill-primary" disabled={busy || problems.length > 0} onClick={() => void save('published')}>
          {busy ? 'Saving…' : status === 'published' ? 'Save and keep published' : 'Publish video'}
        </button>
        {status === 'published' && (
          <button type="button" className="pill-quiet" disabled={busy} onClick={() => void save('unpublished')}>Unpublish video</button>
        )}
      </div>
    </fieldset>
  );
}
