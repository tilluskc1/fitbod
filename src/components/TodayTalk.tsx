import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../types';
import type { EquipmentChoice } from '../lib/adapt';
import { AREAS } from '../lib/areas';
import type { Area } from '../lib/areas';
import { noticeText } from '../lib/constraints';
import { restLabel } from '../lib/sessionTime';
import { NO_TAPS, composeTalk, gearLabel, tapSkip, tapTrain, tapsAfterEdit } from '../lib/todayTalk';
import type { CustomDayPreview, TalkState, Taps } from '../lib/todayTalk';
import Icon from './ui/Icon';

interface Props {
  profile: Profile;
  /** The planned day's name, for the badge and the week line. */
  plannedName: string;
  /** Today's gear and time and the planned day's areas: what the chips show before anything is said. */
  base: TalkState;
  /** The day these chips build, from the same engine Start runs. */
  preview: (talk: TalkState) => CustomDayPreview | null;
  onStart: (talk: TalkState) => void;
  /** Open or previewing: the screen's other primary steps aside. */
  onActive?: (active: boolean) => void;
}

const EXAMPLES: { label: string; say: string }[] = [
  { label: 'Hotel gym, 30 min', say: 'Hotel gym, 30 min, upper body please.' },
  { label: 'Home, back and arms', say: 'Home today, back and arms, an hour.' },
  { label: 'Shoulders tired', say: 'Shoulders are tired, legs and abs, 60 min at the gym.' },
  { label: 'Knee pain', say: 'My knee hurts, gym, legs.' },
];
const GEAR: EquipmentChoice[] = ['home', 'hotel', 'bodyweight'];
const TIMES = [30, 45, 60];

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const minutesLabel = (minutes: number) => (minutes === 60 ? '1 hr' : `${minutes} min`);
const words = (areas: Area[]) => {
  const list = areas.map((area) => area.toLowerCase());
  return list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

/**
 * "Tell me about today" (#193). Collapsed until tapped so the workout card keeps its place on
 * Today. Text fills four rows of chips; the chips stay editable; Build shows the day the
 * generator makes from them, and Start runs exactly that day. Voice is the keyboard's own
 * dictation into the text box: nothing here listens.
 */
export default function TodayTalk({ profile, plannedName, base, preview, onStart, onActive }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  // Chip taps sit on top of the text, so typing more never undoes them (see `tapsAfterEdit`).
  const [taps, setTaps] = useState<Taps>(NO_TAPS);
  // "It's only soreness": the lifter's answer to the pain stop, kept while the note still says pain.
  const [soreOnly, setSoreOnly] = useState(false);
  const [built, setBuilt] = useState<{ talk: TalkState; day: CustomDayPreview } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const said = composeTalk(base, text, taps);
  const talk = soreOnly ? { ...said, pain: false } : said;

  useEffect(() => {
    onActive?.(open || built !== null);
    return () => onActive?.(false);
  }, [open, built, onActive]);
  // Gear or time changed in another sheet: that newer choice shows through the chips.
  const baseKey = `${base.equipment}:${base.minutes}`;
  const [seenBase, setSeenBase] = useState(baseKey);
  if (seenBase !== baseKey) {
    setSeenBase(baseKey);
    setTaps({ areas: taps.areas });
  }

  const say = (value: string) => {
    setTaps(tapsAfterEdit(taps, text, value));
    setText(value);
    if (!composeTalk(base, value, NO_TAPS).pain) setSoreOnly(false);
  };
  const build = () => {
    const day = preview(talk);
    if (!day) return;
    setBuilt({ talk, day });
    requestAnimationFrame(() => titleRef.current?.focus());
  };
  const change = () => {
    setBuilt(null);
    requestAnimationFrame(() => textRef.current?.focus());
  };

  const gears = GEAR.includes(talk.equipment) ? GEAR : [...GEAR, talk.equipment];
  const times = [...new Set([...TIMES, talk.minutes])].sort((a, b) => a - b);
  const gear = gearLabel(talk.equipment, profile);
  const summary = talk.pain
    ? 'You mentioned pain. Nothing will be built around it.'
    : `${talk.train.length ? capital(words(talk.train)) : 'Nothing to train'} with ${gear.toLowerCase()}${talk.skip.length ? `, skipping ${words(talk.skip)}` : ''}, ${talk.minutes} min.`;
  const blocked = talk.pain || talk.train.length === 0;

  if (built) {
    const { day } = built;
    return (
      <section className="t7-card tt" aria-label="Today's workout preview">
        <div className="tt-pv-head">
          <div>
            <span className="tt-badge">Today only · {day.gear}</span>
            <h2 className="tt-pv-title" ref={titleRef} tabIndex={-1}>{day.title}</h2>
          </div>
          <span className={`t7-state t7-state--${day.status}`}>
            {day.status === 'ready' ? 'Ready' : day.status === 'limited' ? 'Limited' : 'Not enough equipment'}
          </span>
        </div>
        <div className="tt-meta">
          <p><b>{day.minutes}</b><small>min</small></p>
          <p><b>{day.sets}</b><small>sets</small></p>
          <p><b>{day.exercises.length}</b><small>exercises</small></p>
        </div>
        <div className="tt-why">
          {day.why.map((line) => <p key={line.label}><b>{line.label}</b> {line.text}</p>)}
        </div>
        <ul className="tt-list">
          {day.exercises.map((exercise) => (
            <li key={exercise.exerciseId} className="tt-ex">
              <span>
                <b>{exercise.name}{exercise.lead && <span className="tt-tag">Main lift</span>}</b>
                <span className="tt-ex__meta">{exercise.muscle} · rest {restLabel(exercise.restSeconds)}</span>
              </span>
              <span className="tt-ex__sets">{exercise.sets} × {exercise.reps}</span>
            </li>
          ))}
        </ul>
        {day.described && (
          <div className="tt-week">
            <b>{plannedName} moves to your next session</b>
            <span>Your weekly plan keeps every day; nothing is lost.</span>
          </div>
        )}
        <button type="button" className="pill-primary" onClick={() => onStart(built.talk)} disabled={day.exercises.length === 0}>
          Start this workout
        </button>
        <button type="button" className="secondary" onClick={change}>Change what I said</button>
      </section>
    );
  }

  return (
    <section className="t7-card tt" aria-label="Tell me about today">
      <div>
        <span className="tt-badge">Planned today · {plannedName}</span>
        <h2>
          <button type="button" className="tt-toggle" aria-expanded={open} aria-controls="tt-body" onClick={() => setOpen(!open)}>
            Tell me about today
            <Icon name="expand_more" size={20} className={open ? 'tt-chev tt-chev--open' : 'tt-chev'} />
          </button>
        </h2>
        <p className="tt-hint">Gear, time, anything sore, what you feel like training. Or just press Start.</p>
      </div>
      {open && (
        <div id="tt-body" className="tt-body">
          <label htmlFor="tt-say" className="sr-only">What's today like?</label>
          <textarea
            id="tt-say"
            ref={textRef}
            className="tt-say"
            rows={3}
            value={text}
            placeholder="Full gym today. Legs are sore. Chest and abs, 45 min."
            onChange={(event) => say(event.target.value)}
          />
          <div className="tt-examples" role="group" aria-label="Examples">
            {EXAMPLES.map((example) => (
              <button key={example.label} type="button" className="tt-ex-chip" onClick={() => say(example.say)}>{example.label}</button>
            ))}
          </div>

          <div className="tt-understood">
            <p className="tt-hint">What I understood. Tap to change.</p>
            <p className="sr-only" aria-live="polite">{summary}</p>
            <div className="tt-row" role="group" aria-label="Gear">
              <span className="tt-k" aria-hidden="true">Gear</span>
              <div className="tt-chips">
                {gears.map((choice) => (
                  <button key={choice} type="button" className="tt-chip" aria-pressed={talk.equipment === choice}
                    onClick={() => setTaps({ ...taps, equipment: choice })}>{gearLabel(choice, profile)}</button>
                ))}
              </div>
            </div>
            <div className="tt-row" role="group" aria-label="Train">
              <span className="tt-k" aria-hidden="true">Train</span>
              <div className="tt-chips">
                {AREAS.map((area) => (
                  <button key={area} type="button" className="tt-chip" aria-pressed={talk.train.includes(area)}
                    onClick={() => setTaps(tapTrain(talk, taps, area))}>{area}</button>
                ))}
              </div>
            </div>
            <div className="tt-row" role="group" aria-label="Skip">
              <span className="tt-k" aria-hidden="true">Skip</span>
              <div className="tt-chips">
                {AREAS.map((area) => (
                  <button key={area} type="button" className="tt-chip tt-chip--skip" aria-pressed={talk.skip.includes(area)}
                    onClick={() => setTaps(tapSkip(talk, taps, area))}>{area}</button>
                ))}
              </div>
            </div>
            <div className="tt-row" role="group" aria-label="Time">
              <span className="tt-k" aria-hidden="true">Time</span>
              <div className="tt-chips">
                {times.map((minutes) => (
                  <button key={minutes} type="button" className="tt-chip" aria-pressed={talk.minutes === minutes}
                    onClick={() => setTaps({ ...taps, minutes })}>{minutesLabel(minutes)}</button>
                ))}
              </div>
            </div>
          </div>

          {talk.pain ? (
            <p className="tt-stop" role="alert">
              <b>You mentioned pain.</b> I can work around soreness, not pain. Skip today or check with someone who can look at it. If it's only soreness, edit your note.
              <button type="button" className="secondary" onClick={() => setSoreOnly(true)}>It's only soreness</button>
            </p>
          ) : talk.train.length === 0 ? (
            <p className="tt-warn">Pick at least one area to train.</p>
          ) : null}
          {talk.notices.map((notice) => <p key={notice.kind} className="tt-warn">{noticeText(notice)}</p>)}
          <button type="button" className="pill-primary" onClick={build} disabled={blocked}>Build today's workout</button>
        </div>
      )}
    </section>
  );
}
