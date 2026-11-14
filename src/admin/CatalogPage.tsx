import { useEffect, useMemo, useState } from 'react';
import { MUSCLE_GROUPS } from '../data/exercises';
import { GYM_GROUPS, GYM_ITEMS } from '../data/gymItems';
import { BODYWEIGHT, BUCKET, mediaUrl, validRow, type Row } from '../lib/additions';
import {
  ADDITION_GROUPS,
  FAMILY_LIST,
  PATTERNS,
  LICENCE_LABELS,
  appearsIn,
  draftOf,
  emptyDraft,
  extensionOf,
  fieldsOf,
  fileProblem,
  idFor,
  publishProblems,
  rowOf,
  unpublishProblems,
  type Draft,
  type Entry,
  type Status,
} from '../lib/adminCatalog';
import { plain } from '../lib/catalogSync';
import type { FirestoreDoc } from '../lib/adminData';
import type { MuscleGroup, MovementPattern } from '../types';
import { AdminError, readCatalog, uploadMedia, writeCatalog } from './api';

/**
 * (#360) /admin Exercises and Equipment: add a draft, publish it, unpublish it. Additions only: the
 * built-in catalog is not editable here. Pick lists only, from the app's own vocabularies. The rules are
 * the lock; this page only explains why a draft can't publish yet.
 */

const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', published: 'Published', unpublished: 'Unpublished' };
const patternLabel = (pattern: string) => pattern[0].toUpperCase() + pattern.slice(1).replace(/_/g, ' ');

function entriesOf(docs: FirestoreDoc[]): Entry[] {
  return docs.flatMap((doc) => {
    const fields = plain(doc.fields as never);
    const row = validRow(fields);
    const status = fields.status as Status;
    return row && STATUS_LABEL[status] ? [{ row, status }] : [];
  });
}

/** The browser's reading of a video file's length, in seconds (NaN when it can't). */
function videoSeconds(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value: number) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => done(video.duration);
    video.onerror = () => done(Number.NaN);
    video.src = url;
  });
}

interface Props {
  kind: Row['kind'];
  token: string;
  onFail: (error: unknown) => void;
}

export default function CatalogPage({ kind, token, onFail }: Props) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean; said?: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    readCatalog(token).then(
      (docs) => live && setEntries(entriesOf(docs)),
      (error: unknown) => {
        if (!live) return;
        if (error instanceof AdminError && error.kind !== 'offline') onFail(error);
        else setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [token, onFail]);

  if (failed) return <p className="adm-error" role="alert">Couldn't load the catalog. Check the connection and reload.</p>;
  if (!entries) return <p className="adm-muted">Loading…</p>;

  const saved = (entry: Entry, said: string) => {
    setEntries((list) => [...(list ?? []).filter((item) => item.row.id !== entry.row.id), entry]);
    setEditing({ draft: draftOf(entry), isNew: false, said });
  };

  if (editing) {
    return (
      <Editor
        key={`${editing.draft.id || 'new'}-${editing.draft.status}-${editing.said ?? ''}`}
        start={editing.draft}
        said={editing.said}
        isNew={editing.isNew}
        entries={entries}
        token={token}
        onFail={onFail}
        onSaved={saved}
        onBack={() => setEditing(null)}
      />
    );
  }

  const mine = entries.filter((entry) => entry.row.kind === kind).sort((a, b) => a.row.name.localeCompare(b.row.name));
  const noun = kind === 'exercise' ? 'exercise' : 'equipment';
  return (
    <section aria-label={kind === 'exercise' ? 'Exercises' : 'Equipment'}>
      <p className="adm-muted adm-cat__intro">
        {kind === 'exercise'
          ? 'Exercises you add here join the built-in list on phones the next time the app opens online. Built-in exercises are not edited here.'
          : 'Equipment you add here shows in the My gym list and works like the family it belongs to. Built-in equipment is not edited here.'}
      </p>
      <button type="button" className="pill-primary adm-cat__add" onClick={() => setEditing({ draft: emptyDraft(kind), isNew: true })}>
        Add {noun}
      </button>
      {mine.length === 0 ? (
        <p className="adm-empty">No {noun} added yet.</p>
      ) : (
        <ul className="adm-list adm-cat__list">
          {mine.map((entry) => (
            <li key={entry.row.id} className="adm-card adm-cat__row">
              <div>
                <p className="adm-cat__name">{entry.row.name}</p>
                <p className="adm-muted">
                  {entry.row.kind === 'exercise'
                    ? `${entry.row.muscles.join(', ')} · ${patternLabel(entry.row.pattern)}`
                    : `${entry.row.family} · ${entry.row.group}`}
                </p>
              </div>
              <div className="adm-cat__end">
                <span className={`adm-chip${entry.status === 'published' ? '' : ' adm-chip--quiet'}`}>{STATUS_LABEL[entry.status]}</span>
                <button type="button" className="pill-quiet" aria-label={`Edit ${entry.row.name}`} onClick={() => setEditing({ draft: draftOf(entry), isNew: false })}>
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface EditorProps {
  start: Draft;
  isNew: boolean;
  entries: Entry[];
  token: string;
  onFail: (error: unknown) => void;
  said?: string;
  onSaved: (entry: Entry, said: string) => void;
  onBack: () => void;
}

type Files = { photo?: File; video?: File };

function Editor({ start, said, isNew, entries, token, onFail, onSaved, onBack }: EditorProps) {
  const [draft, setDraft] = useState(start);
  const [files, setFiles] = useState<Files>({});
  const [fileErrors, setFileErrors] = useState<{ photo?: string; video?: string }>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(said ? { ok: true, text: said } : null);
  const set = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  };

  const exercise = draft.kind === 'exercise';
  const muscles = draft.primary ? [draft.primary, ...draft.secondary.filter((m) => m !== draft.primary)] : [];
  const muscleKey = muscles.join();
  const days = useMemo(() => appearsIn(muscleKey ? (muscleKey.split(',') as MuscleGroup[]) : [], draft.pattern), [muscleKey, draft.pattern]);
  const id = isNew ? idFor(draft.name) : draft.id;
  // A chosen file counts as media (so its rights are required) before it is uploaded.
  const probe: Draft = {
    ...draft,
    id,
    photo: files.photo ? `catalog/${id}/photo-0.${extensionOf(files.photo.type)}` : draft.photo,
    video: files.video ? `catalog/${id}/video-0.mp4` : draft.video,
  };
  const problems = [...publishProblems(probe, entries, isNew), ...Object.values(fileErrors).filter((text): text is string => Boolean(text))];
  const gearOptions = entries.filter((entry) => entry.row.kind === 'equipment');
  const unpublishBlock = isNew ? [] : unpublishProblems(rowOf(start) as unknown as Row, entries);

  const choose = async (kind: 'photo' | 'video', file: File | undefined) => {
    setMessage(null);
    // Nothing chosen (the picker was cleared): the earlier file and its problem go with it.
    const problem = file ? fileProblem(kind, file, kind === 'video' ? await videoSeconds(file) : undefined) : null;
    setFileErrors((current) => ({ ...current, [kind]: problem ?? undefined }));
    setFiles((current) => ({ ...current, [kind]: problem ? undefined : file }));
  };

  /** Draft, Publish and Save write the edited form; Unpublish writes the saved row with a new status. */
  const save = async (status: Status) => {
    if (busy) return;
    const unpublish = status === 'unpublished' && start.status === 'published';
    if (!unpublish && problems.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const next: Draft = unpublish ? { ...start, status } : { ...draft, id, status };
      if (!unpublish) {
        for (const kind of ['photo', 'video'] as const) {
          const file = files[kind];
          if (!file) continue;
          const path = `catalog/${id}/${kind}-${Date.now()}.${extensionOf(file.type)}`;
          await uploadMedia(token, BUCKET, path, file);
          next[kind] = path;
        }
      }
      const row = validRow(rowOf(next));
      if (!row) {
        setMessage({ ok: false, text: 'Something in this entry is not valid. Check each field.' });
        return;
      }
      await writeCatalog(token, row.id, fieldsOf(row, status, new Date()), isNew);
      onSaved({ row, status }, status === 'published' ? 'Published. Phones get it the next time the app opens online.'
        : status === 'unpublished' ? 'Unpublished. Phones stop planning it; past workouts keep it.' : 'Draft saved.');
    } catch (error) {
      if (error instanceof AdminError && error.kind !== 'offline') onFail(error);
      else setMessage({ ok: false, text: 'Not saved. Check the connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  const toggleSecondary = (muscle: MuscleGroup) =>
    set({ secondary: draft.secondary.includes(muscle) ? draft.secondary.filter((m) => m !== muscle) : [...draft.secondary, muscle] });

  const live = draft.status === 'published';
  return (
    <section aria-label={isNew ? `Add ${draft.kind}` : `Edit ${draft.name}`} className="adm-cat__editor">
      <button type="button" className="pill-quiet" onClick={onBack}>‹ Back to the list</button>
      <h2 className="adm-card__title adm-cat__heading">
        {isNew ? (exercise ? 'New exercise' : 'New equipment') : draft.name}
        {!isNew && <span className={`adm-chip${live ? '' : ' adm-chip--quiet'}`}>{STATUS_LABEL[draft.status]}</span>}
      </h2>

      <div className="adm-card adm-form">
        <label className="adm-field">
          <span>Name</span>
          <input className="search" value={draft.name} maxLength={60} onChange={(event) => set({ name: event.target.value })} />
          {isNew && draft.name.trim() && <span className="adm-muted">ID: {idFor(draft.name) || 'none'}</span>}
        </label>

        {exercise ? (
          <>
            <label className="adm-field">
              <span>Primary muscle</span>
              <select className="search" value={draft.primary} onChange={(event) => set({ primary: event.target.value as MuscleGroup })}>
                <option value="">Pick one</option>
                {MUSCLE_GROUPS.map((muscle) => <option key={muscle} value={muscle}>{muscle}</option>)}
              </select>
            </label>
            <fieldset className="adm-field">
              <legend>Other muscles (up to 3)</legend>
              <div className="adm-checks">
                {MUSCLE_GROUPS.filter((muscle) => muscle !== draft.primary).map((muscle) => (
                  <label key={muscle} className="adm-check">
                    <input
                      type="checkbox"
                      checked={draft.secondary.includes(muscle)}
                      disabled={!draft.secondary.includes(muscle) && draft.secondary.filter((m) => m !== draft.primary).length >= 3}
                      onChange={() => toggleSecondary(muscle)}
                    />
                    {muscle}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="adm-field">
              <span>Movement pattern</span>
              <select className="search" value={draft.pattern} onChange={(event) => set({ pattern: event.target.value as MovementPattern })}>
                <option value="">Pick one</option>
                {PATTERNS.map((pattern) => <option key={pattern} value={pattern}>{patternLabel(pattern)}</option>)}
              </select>
            </label>
            <label className="adm-field">
              <span>Equipment</span>
              <select className="search" value={draft.item} onChange={(event) => set({ item: event.target.value })}>
                <option value={BODYWEIGHT}>Bodyweight (none)</option>
                {GYM_GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {GYM_ITEMS.filter((item) => item.group === group).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    {gearOptions.filter((entry) => entry.row.kind === 'equipment' && entry.row.group === group).map((entry) => (
                      <option key={entry.row.id} value={entry.row.id}>{entry.row.name}{entry.status === 'published' ? '' : ` (${STATUS_LABEL[entry.status].toLowerCase()})`}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="adm-coach" role="status">
              <strong>Coach check</strong>
              <p>
                {!draft.primary || !draft.pattern
                  ? 'Pick the primary muscle and the movement pattern to see where the planner puts it.'
                  : days.length
                    ? `This exercise would appear in: ${days.join(', ')}.`
                    : 'The planner would not put this exercise on any day. Check the primary muscle and pattern.'}
              </p>
            </div>
            <label className="adm-field">
              <span>Instructions</span>
              <textarea className="adm-text" value={draft.instructions} maxLength={600} onChange={(event) => set({ instructions: event.target.value })} />
            </label>
            <label className="adm-field">
              <span>Cues (one per line, up to 5)</span>
              <textarea className="adm-text adm-text--short" value={draft.cues} onChange={(event) => set({ cues: event.target.value })} />
            </label>

            <fieldset className="adm-field adm-media">
              <legend>Photo and video</legend>
              <p className="adm-muted">Photo: JPG, PNG or WebP, up to 1 MB. Video: MP4, up to 10 MB and 15 seconds.</p>
              {draft.photo && !files.photo && (
                <div className="adm-media__now">
                  <img src={mediaUrl(draft.photo)} alt={`${draft.name} photo`} />
                  <button type="button" className="pill-quiet" onClick={() => set({ photo: undefined })}>Remove photo</button>
                </div>
              )}
              <label className="adm-file">
                <span>{draft.photo ? 'Replace photo' : 'Add a photo'}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choose('photo', event.target.files?.[0])} />
              </label>
              {fileErrors.photo && <p className="adm-error" role="alert">{fileErrors.photo}</p>}
              {draft.video && !files.video && (
                <div className="adm-media__now">
                  <span className="adm-muted">Video added.</span>
                  <button type="button" className="pill-quiet" onClick={() => set({ video: undefined })}>Remove video</button>
                </div>
              )}
              <label className="adm-file">
                <span>{draft.video ? 'Replace video' : 'Add a video'}</span>
                <input type="file" accept="video/mp4" onChange={(event) => void choose('video', event.target.files?.[0])} />
              </label>
              {fileErrors.video && <p className="adm-error" role="alert">{fileErrors.video}</p>}
              <label className="adm-field">
                <span>Source (link or where it came from)</span>
                <input className="search" value={draft.source} maxLength={300} onChange={(event) => set({ source: event.target.value })} />
              </label>
              <label className="adm-field">
                <span>Licence</span>
                <select className="search" value={draft.licence} onChange={(event) => set({ licence: event.target.value as Draft['licence'] })}>
                  <option value="">Pick one</option>
                  {LICENCE_LABELS.map((licence) => <option key={licence.value} value={licence.value}>{licence.label}</option>)}
                </select>
              </label>
              <label className="adm-field">
                <span>Credit (shown in the app's About)</span>
                <input className="search" value={draft.credit} maxLength={120} onChange={(event) => set({ credit: event.target.value })} />
              </label>
            </fieldset>
          </>
        ) : (
          <>
            <label className="adm-field">
              <span>Family (it works like this in plans)</span>
              <select className="search" value={draft.family} onChange={(event) => set({ family: event.target.value as Draft['family'] })}>
                <option value="">Pick one</option>
                {FAMILY_LIST.map((family) => <option key={family} value={family}>{family}</option>)}
              </select>
            </label>
            <label className="adm-field">
              <span>My gym group</span>
              <select className="search" value={draft.group} onChange={(event) => set({ group: event.target.value as Draft['group'] })}>
                <option value="">Pick one</option>
                {ADDITION_GROUPS.map((group) => <option key={group} value={group}>{group}</option>)}
              </select>
            </label>
          </>
        )}
      </div>

      {problems.length > 0 && (
        <div className="adm-card adm-problems" role="status">
          <strong>Can't publish yet</strong>
          <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
      )}
      {live && unpublishBlock.length > 0 && <p className="adm-muted">{unpublishBlock[0]}</p>}
      {message && <p className={message.ok ? 'adm-ok' : 'adm-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}

      <div className="adm-cat__actions">
        {live ? (
          <>
            <button type="button" className="pill-primary" disabled={busy || problems.length > 0} onClick={() => void save('published')}>
              {busy ? 'Saving…' : 'Save and keep published'}
            </button>
            <button type="button" className="pill-quiet" disabled={busy || unpublishBlock.length > 0} onClick={() => void save('unpublished')}>Unpublish</button>
          </>
        ) : (
          <>
            <button type="button" className="pill-primary" disabled={busy || problems.length > 0} onClick={() => void save('published')}>
              {busy ? 'Saving…' : 'Publish'}
            </button>
            <button type="button" className="pill-quiet" disabled={busy || problems.length > 0} onClick={() => void save(draft.status === 'unpublished' ? 'unpublished' : 'draft')}>
              {draft.status === 'unpublished' ? 'Save, keep unpublished' : 'Save draft'}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
