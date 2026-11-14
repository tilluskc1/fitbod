import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FIREBASE } from '../lib/firebase';
import {
  DAY_LABELS,
  TAPS,
  eventOf,
  feedbackInbox,
  readSince,
  testerCounts,
  weekUsage,
  weeksTo,
  type FeedbackItem,
} from '../lib/adminData';
import { DAY_TYPES, type UsageEvent } from '../lib/events';
import { AdminError, readEvents, readFeedback, setDone, signInWithGoogle, type Failure } from './api';

/**
 * (#359) /admin: owner-only feedback inbox, tester counts and feature usage. Google sign-in (Identity
 * Services script, loaded here only) gives a token; Firestore's rules decide what it may read. This page
 * never checks the email and never stores the token: a reload signs in again.
 */

interface GoogleId {
  initialize(options: { client_id: string; callback: (response: { credential?: string }) => void; auto_select?: boolean }): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';
let gis: Promise<GoogleId> | null = null;

function loadGoogle(): Promise<GoogleId> {
  gis ??= new Promise<GoogleId>((resolve, reject) => {
    const ready = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('no gis')));
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error('gis failed'));
    setTimeout(() => reject(new Error('gis timeout')), 15000);
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    gis = null;
    throw error;
  });
  return gis;
}

type Phase = 'starting' | 'signed-out' | 'signing-in' | 'loading' | 'ready' | 'google-failed' | Failure;
type Tab = 'feedback' | 'testers' | 'usage';

const SCREENS: Record<string, string> = { settings: 'Settings', recap: 'Workout recap' };

const when = (iso: string) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No date';

const weekLabel = (monday: string, current: boolean) => {
  const [y, m, d] = monday.split('-').map(Number);
  const day = new Date(y, m - 1, d, 12).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return current ? `This week, from ${day}` : `Week from ${day}`;
};

const MESSAGES: Record<Exclude<Phase, 'ready' | 'loading' | 'signing-in' | 'starting'>, { title: string; body: string }> = {
  'signed-out': { title: 'Sign in', body: 'Sign in with Google to see feedback and usage.' },
  'not-allowed': { title: 'Not allowed', body: "This Google account can't open admin. Sign in with another account." },
  expired: { title: 'Signed out', body: 'Your sign-in ran out. Sign in again.' },
  offline: { title: 'No connection', body: "Couldn't reach the data. Check the connection and sign in again." },
  'google-failed': { title: 'No connection', body: "Couldn't reach Google sign-in. Check the connection and reload." },
};

export default function AdminApp() {
  const [phase, setPhase] = useState<Phase>('starting');
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('feedback');
  const [notes, setNotes] = useState<FeedbackItem[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [weekIndex, setWeekIndex] = useState(7);
  const [busy, setBusy] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState<string | null>(null);
  const buttonRef = useRef<HTMLDivElement>(null);
  const googleRef = useRef<GoogleId | null>(null);

  const fail = useCallback((error: unknown) => {
    setToken(null);
    setPhase(error instanceof AdminError ? error.kind : 'offline');
  }, []);

  const load = useCallback(async (idToken: string) => {
    setPhase('loading');
    const at = new Date();
    try {
      const [feedbackDocs, eventDocs] = await Promise.all([readFeedback(idToken), readEvents(idToken, readSince(at))]);
      setNotes(feedbackInbox(feedbackDocs));
      setEvents(eventDocs.flatMap((doc) => eventOf(doc) ?? []));
      setNow(at);
      setWeekIndex(7);
      setPhase('ready');
    } catch (error) {
      fail(error);
    }
  }, [fail]);

  useEffect(() => {
    let live = true;
    loadGoogle().then(
      (google) => {
        if (!live) return;
        google.initialize({
          client_id: FIREBASE.googleClientId,
          auto_select: false,
          callback: ({ credential }) => {
            if (!credential) return;
            setPhase('signing-in');
            signInWithGoogle(credential).then(
              (idToken) => {
                setToken(idToken);
                void load(idToken);
              },
              fail,
            );
          },
        });
        googleRef.current = google;
        setPhase('signed-out');
      },
      () => live && setPhase('google-failed'),
    );
    return () => {
      live = false;
    };
  }, [load, fail]);

  const showButton = phase === 'signed-out' || phase === 'not-allowed' || phase === 'expired' || phase === 'offline';
  useEffect(() => {
    if (showButton && buttonRef.current && googleRef.current) {
      buttonRef.current.replaceChildren();
      googleRef.current.renderButton(buttonRef.current, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
    }
  }, [showButton, phase]);

  const signOut = () => {
    googleRef.current?.disableAutoSelect();
    setToken(null);
    setNotes([]);
    setEvents([]);
    setPhase('signed-out');
  };

  const toggleDone = async (note: FeedbackItem) => {
    if (!token || busy) return;
    setBusy(note.name);
    setNotSaved(null);
    try {
      await setDone(token, note.name, !note.done);
      setNotes((list) => list.map((item) => (item.name === note.name ? { ...item, done: !note.done } : item)));
    } catch (error) {
      if (error instanceof AdminError && error.kind !== 'offline') fail(error);
      else setNotSaved(note.name);
    } finally {
      setBusy(null);
    }
  };

  const weeks = useMemo(() => weeksTo(now), [now]);
  const usage = useMemo(() => weekUsage(events, weeks[weekIndex]), [events, weeks, weekIndex]);
  const testers = useMemo(() => testerCounts(events, notes, now), [events, notes, now]);
  const open = notes.filter((note) => !note.done).length;

  if (phase !== 'ready') {
    const message = phase in MESSAGES ? MESSAGES[phase as keyof typeof MESSAGES] : null;
    return (
      <main className="adm">
        <h1 className="adm__title">Home Strength admin</h1>
        <section className="adm-card adm-gate" aria-live="polite">
          {message ? (
            <>
              <h2 className="adm-card__title">{message.title}</h2>
              <p className="adm-muted">{message.body}</p>
            </>
          ) : (
            <p className="adm-muted">{phase === 'loading' ? 'Loading…' : phase === 'signing-in' ? 'Signing in…' : 'Starting…'}</p>
          )}
          {showButton && <div className="adm-gate__button" ref={buttonRef} />}
        </section>
      </main>
    );
  }

  return (
    <main className="adm">
      <header className="adm__head">
        <h1 className="adm__title">Home Strength admin</h1>
        <button type="button" className="pill-quiet" onClick={signOut}>Sign out</button>
      </header>
      <div className="segmented adm__tabs" role="tablist">
        {([
          ['feedback', `Feedback${open ? ` (${open})` : ''}`],
          ['testers', 'Testers'],
          ['usage', "What's used"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'feedback' && (
        <section aria-label="Feedback">
          {notes.length === 0 ? (
            <p className="adm-empty">No feedback yet.</p>
          ) : (
            <ul className="adm-list">
              {notes.map((note) => (
                <li key={note.name} className={`adm-card adm-note${note.done ? ' adm-note--done' : ''}`}>
                  <p className="adm-note__msg">{note.message}</p>
                  <p className="adm-muted adm-note__meta">
                    {when(note.createdAt)} · {SCREENS[note.screen] ?? note.screen} · {note.device || 'other'}
                    <br />
                    Tester {note.testerId.slice(0, 8) || 'none'} · version {note.appVersion || 'unknown'}
                    {note.from ? ` · from ${note.from}` : ''}
                  </p>
                  <div className="adm-note__foot">
                    {note.done && <span className="adm-chip">Done</span>}
                    <button type="button" className="pill-quiet" disabled={busy !== null} onClick={() => void toggleDone(note)}>
                      {busy === note.name ? 'Saving…' : note.done ? 'Mark not done' : 'Mark done'}
                    </button>
                  </div>
                  {notSaved === note.name && <p className="adm-error" role="alert">Not saved. Check the connection and try again.</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'testers' && (
        <section aria-label="Testers">
          <div className="adm-tiles">
            {([
              ['Tester IDs', testers.total],
              ['New this week', testers.newThisWeek],
              ['Active this week', testers.activeThisWeek],
              ['Active, last 4 weeks', testers.activeFourWeeks],
            ] as const).map(([label, value]) => (
              <div key={label} className="adm-card adm-tile">
                <span className="adm-tile__value">{value}</span>
                <span className="adm-muted">{label}</span>
              </div>
            ))}
          </div>
          <p className="adm-muted adm-foot">
            {testers.total === 0 ? 'No testers seen yet. ' : ''}From the last 8 weeks of usage and every feedback note. Weeks run Monday to Sunday.
          </p>
        </section>
      )}

      {tab === 'usage' && (
        <section aria-label="What's used">
          <div className="adm-week">
            <button type="button" className="pill-quiet" aria-label="Earlier week" disabled={weekIndex === 0} onClick={() => setWeekIndex(weekIndex - 1)}>‹</button>
            <span className="adm-week__label">{weekLabel(weeks[weekIndex], weekIndex === weeks.length - 1)}</span>
            <button type="button" className="pill-quiet" aria-label="Later week" disabled={weekIndex === weeks.length - 1} onClick={() => setWeekIndex(weekIndex + 1)}>›</button>
          </div>
          <CountCard title="Workouts" rows={[['Started', usage.started], ['Finished', usage.finished], ['Cut short', usage.cutShort]]} />
          <CountCard title="Finished by day type" rows={DAY_TYPES.map((type) => [DAY_LABELS[type], usage.byDay[type]])} />
          <CountCard title="Taps" rows={TAPS.map((tap, index) => [tap.label, usage.taps[index]])} />
          {events.length === 0 && <p className="adm-empty">No usage yet in the last 8 weeks.</p>}
        </section>
      )}
    </main>
  );
}

function CountCard({ title, rows }: { title: string; rows: Array<readonly [string, number]> }) {
  return (
    <div className="adm-card adm-counts">
      <h2 className="adm-card__title">{title}</h2>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="adm-counts__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
