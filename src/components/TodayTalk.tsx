import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../types';
import type { EquipmentChoice } from '../lib/adapt';
import { AREAS } from '../lib/areas';
import type { Area } from '../lib/areas';
import { noticeText } from '../lib/constraints';
import { PAIN_CHECK } from '../lib/safety';
import { restLabel } from '../lib/sessionTime';
import { NO_TAPS, composeTalk, gearLabel, tapsAfterEdit } from '../lib/todayTalk';
import type { CustomDayPreview, TalkState, Taps } from '../lib/todayTalk';
import {
  QUESTIONS, gearChoices, isPlannedPick, nothingSore, pickPlanned, planLine, timeChoices, toggleSore, toggleTrain,
} from '../lib/planToday';
import type { Question } from '../lib/planToday';
import Icon from './ui/Icon';

interface Props {
  profile: Profile;
  /** The planned day's name, for the badge and Q3's "My planned day". */
  plannedName: string;
  /** The planned day's areas: what "My planned day" trains. */
  plannedAreas: Area[];
  /** The saved setup and length, pre-selected on Q4 and Q1. */
  savedGear: EquipmentChoice;
  savedMinutes: number;
  /** Today's gear and time and the planned day's areas: every answer's default. */
  base: TalkState;
  /** The day these answers build, from the same engine Start runs. */
  preview: (talk: TalkState) => CustomDayPreview | null;
  onStart: (talk: TalkState) => void;
  /** Open or previewing: the screen's other primary steps aside. */
  onActive?: (active: boolean) => void;
}

const QUESTION_TEXT: Record<Question, string> = {
  time: 'How long do you have?',
  sore: 'Anything sore or hurting?',
  train: 'What do you want to train?',
  gear: 'Where are you training?',
};
const minutesLabel = (minutes: number) => (minutes === 60 ? '1 hr' : `${minutes} min`);

/**
 * "Plan today with me" (#236) on the #193 composer: one question per screen with tap answers,
 * defaults pre-selected, then the day the generator builds from them. "Or just tell me" fills the
 * same answers from a sentence. Answers are chip taps over the text (`composeTalk`), so every way
 * of answering builds the same day. Voice is the keyboard's own dictation: nothing here listens.
 */
export default function TodayTalk({ profile, plannedName, plannedAreas, savedGear, savedMinutes, base, preview, onStart, onActive }: Props) {
  const [step, setStep] = useState<Question | 'summary' | null>(null);
  const [text, setText] = useState('');
  // Answers sit on top of the text, so typing more never undoes them (see `tapsAfterEdit`).
  const [taps, setTaps] = useState<Taps>(NO_TAPS);
  // Q2 "It hurts": pain from a tap, as the text's pain words do.
  const [hurts, setHurts] = useState(false);
  // "It's only soreness": the lifter's answer to the pain stop, kept while the note still says pain.
  const [soreOnly, setSoreOnly] = useState(false);
  const [built, setBuilt] = useState<{ talk: TalkState; day: CustomDayPreview } | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const said = composeTalk(base, text, taps);
  const talk = { ...said, pain: (said.pain && !soreOnly) || hurts };

  useEffect(() => {
    onActive?.(step !== null);
    return () => onActive?.(false);
  }, [step, onActive]);
  // Gear or time changed in another sheet: that newer choice shows through the answers.
  const baseKey = `${base.equipment}:${base.minutes}`;
  const [seenBase, setSeenBase] = useState(baseKey);
  if (seenBase !== baseKey) {
    setSeenBase(baseKey);
    setTaps({ areas: taps.areas });
  }

  const go = (next: Question | 'summary' | null) => {
    setStep(next);
    if (next !== 'summary') setBuilt(null);
    requestAnimationFrame(() => titleRef.current?.focus());
  };
  /** Build from the answers so far; pain or nothing to train sends the lifter to that question instead. */
  const build = () => {
    if (talk.pain) return go('sore');
    if (talk.train.length === 0) return go('train');
    const day = preview(talk);
    if (!day) return;
    setBuilt({ talk, day });
    go('summary');
  };
  const say = (value: string) => {
    setTaps(tapsAfterEdit(taps, text, value));
    setText(value);
    if (!composeTalk(base, value, NO_TAPS).pain) setSoreOnly(false);
  };
  const close = () => {
    setStep(null);
    setBuilt(null);
  };

  if (step === null) {
    return (
      <section className="t7-card tt" aria-label="Plan today with me">
        <span className="tt-badge">Planned today · {plannedName}</span>
        <button type="button" className="tt-open" onClick={() => go('time')}>
          <span>
            <b>Plan today with me</b>
            <small>How long, what's sore, what to train. I'll build it from your answers.</small>
          </span>
          <Icon name="chevron_right" size={22} />
        </button>
      </section>
    );
  }

  const gear = gearLabel(talk.equipment, profile);
  const line = talk.pain ? `You mentioned pain. Nothing will be built around it. ${PAIN_CHECK}` : planLine(talk, plannedName, plannedAreas, gear);

  if (step === 'summary' && built) {
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
        <p className="tt-line">{planLine(built.talk, plannedName, plannedAreas, gearLabel(built.talk.equipment, profile))}</p>
        <div className="tt-meta">
          <p><b>{day.approx ? '≈' : ''}{day.minutes}</b><small>min</small></p>
          <p><b>{day.sets}</b><small>sets</small></p>
          <p><b>{day.exercises.length}</b><small>exercises</small></p>
        </div>
        <div className="tt-why">
          {day.why.map((why) => <p key={why.label}><b>{why.label}</b> {why.text}</p>)}
        </div>
        {built.talk.notices.map((notice) => <p key={notice.kind} className="tt-warn">{noticeText(notice)}</p>)}
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
        <button type="button" className="secondary" onClick={() => go('time')}>Change answers</button>
      </section>
    );
  }

  const question = step === 'summary' ? 'time' : step;
  const index = QUESTIONS.indexOf(question);
  const last = index === QUESTIONS.length - 1;
  const left = talk.skip;
  const offered = AREAS.filter((area) => !left.includes(area));
  const planned = isPlannedPick(talk, plannedAreas);
  // Pain stops at Q2; nothing to train stops at Q3 and Q4. Q1 always moves on, so text pain reaches its stop.
  const blocked = (question !== 'time' && talk.pain) || ((question === 'train' || question === 'gear') && talk.train.length === 0);

  return (
    <section className="t7-card tt" aria-label="Plan today with me">
      <div>
        <span className="tt-badge">Plan today · {index + 1} of {QUESTIONS.length}</span>
        <h2 ref={titleRef} tabIndex={-1}>{QUESTION_TEXT[question]}</h2>
        <p className="sr-only" aria-live="polite">{line}</p>
      </div>

      {question === 'time' && (
        <>
          <div className="tt-chips" role="group" aria-label="Time">
            {timeChoices(savedMinutes, talk.minutes).map((minutes) => (
              <button key={minutes} type="button" className="tt-chip" aria-pressed={talk.minutes === minutes}
                onClick={() => setTaps({ ...taps, minutes })}>{minutesLabel(minutes)}</button>
            ))}
          </div>
          {talk.notices.map((notice) => <p key={notice.kind} className="tt-warn">{noticeText(notice)}</p>)}
          <div className="tt-tell">
            <label htmlFor="tt-say" className="tt-hint">Or just tell me</label>
            <textarea
              id="tt-say"
              className="tt-say"
              rows={2}
              value={text}
              placeholder="30 min, legs are sore, upper body."
              onChange={(event) => say(event.target.value)}
            />
            {text.trim() && (
              <button type="button" className="secondary" onClick={build}>Plan from what I said</button>
            )}
          </div>
        </>
      )}

      {question === 'sore' && (
        <>
          <div className="tt-chips" role="group" aria-label="Sore or hurting">
            <button type="button" className="tt-chip" aria-pressed={left.length === 0 && !talk.pain}
              onClick={() => { setTaps(nothingSore(base, text, taps)); setHurts(false); setSoreOnly(true); }}>Nothing</button>
            {AREAS.map((area) => (
              <button key={area} type="button" className="tt-chip tt-chip--skip" aria-pressed={left.includes(area)}
                onClick={() => setTaps(toggleSore(base, text, taps, area))}>{area}</button>
            ))}
            <button type="button" className="tt-chip tt-chip--skip" aria-pressed={talk.pain}
              onClick={() => { setHurts(!talk.pain); if (talk.pain) setSoreOnly(true); }}>It hurts (pain)</button>
          </div>
          {talk.pain ? (
            <p className="tt-stop" role="alert">
              <b>You mentioned pain.</b> I can work around soreness, not pain. {PAIN_CHECK}
              <button type="button" className="secondary" onClick={() => { setHurts(false); setSoreOnly(true); }}>It's only soreness</button>
            </p>
          ) : left.length > 0 ? (
            <p className="tt-hint">I'll leave out {left.join(', ').toLowerCase()} today.</p>
          ) : null}
        </>
      )}

      {question === 'train' && (
        <>
          <div className="tt-chips" role="group" aria-label="Train">
            <button type="button" className="tt-chip" aria-pressed={planned}
              onClick={() => setTaps(pickPlanned(base, text, taps, plannedAreas))}>My planned day ({plannedName})</button>
            {offered.map((area) => (
              <button key={area} type="button" className="tt-chip" aria-pressed={!planned && talk.train.includes(area)}
                onClick={() => setTaps(toggleTrain(base, text, taps, area, plannedAreas))}>{area}</button>
            ))}
          </div>
          {left.length > 0 && <p className="tt-hint">Not offered: {left.join(', ')}. {talk.sore.length ? 'Sore wins today.' : 'You said skip.'}</p>}
          {talk.train.length === 0 && <p className="tt-warn">{left.length ? 'Everything you planned is left out. ' : ''}Pick at least one area to train.</p>}
        </>
      )}

      {question === 'gear' && (
        <div className="tt-chips" role="group" aria-label="Gear">
          {gearChoices(savedGear, talk.equipment).map((choice) => (
            <button key={choice} type="button" className="tt-chip" aria-pressed={talk.equipment === choice}
              onClick={() => setTaps({ ...taps, equipment: choice })}>
              {gearLabel(choice, profile)}{choice === savedGear ? ' (saved)' : ''}
            </button>
          ))}
        </div>
      )}

      <div className="tt-nav">
        <button type="button" className="secondary" onClick={() => (index === 0 ? close() : go(QUESTIONS[index - 1]))}>
          {index === 0 ? 'Cancel' : 'Back'}
        </button>
        <button type="button" className="pill-primary" disabled={blocked}
          onClick={() => (last ? build() : go(QUESTIONS[index + 1]))}>
          {last ? 'Build my day' : 'Next'}
        </button>
      </div>
      {!last && (
        <button type="button" className="link-btn tt-skip" onClick={build}>
          Build with these answers
        </button>
      )}
    </section>
  );
}

