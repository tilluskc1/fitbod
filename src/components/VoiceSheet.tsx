import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../types';
import { cardioNotice, composeTalk, gearLabel, talkParse, tapsAfterEdit } from '../lib/todayTalk';
import type { TalkState, Taps } from '../lib/todayTalk';
import type { Question } from '../lib/planToday';
import { newRecognition } from '../lib/speech';
import Sheet from './ui/Sheet';
import Icon from './ui/Icon';

type Stage = 'listening' | 'heard' | 'empty' | 'retry';

interface Props {
  base: TalkState;
  profile: Pick<Profile, 'equipment'>;
  /** The chips/text left from any earlier session, so the card matches what `onConfirm` will build. */
  taps: Taps;
  text: string;
  /** "Yes": build from this transcript, unedited. */
  onConfirm: (transcript: string) => void;
  /** Tapped one of the four slots: open that question, seeded with this transcript. */
  onEditSlot: (question: Question, transcript: string) => void;
  /** Pain was heard: hand straight to the existing pain stop, never a heard-you card for it. */
  onPain: (transcript: string) => void;
  /** Nothing usable was heard, or the lifter asked for chips instead. */
  onFallback: () => void;
  /** A start error, unsupported API, or a permission denial: hide the mic for the rest of the session. */
  onBlocked: () => void;
  onClose: () => void;
}

/** (#426) No new result for this long auto-stops listening, same as the approved mockup. */
const SILENCE_MS = 2000;

/**
 * The mic's own sheet: listens, shows the transcript, then one of three outcomes — the existing
 * pain stop, the existing per-question fix screens (four "slots"), or a plain "didn't catch that"
 * back to the chips. It parses nothing itself; every reading goes through `talkParse`/`composeTalk`,
 * the same engine typed text already uses, so voice can never disagree with typing.
 */
export default function VoiceSheet({ base, profile, taps, text, onConfirm, onEditSlot, onPain, onFallback, onBlocked, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('listening');
  const [live, setLive] = useState('');
  const [finalText, setFinalText] = useState('');
  const [retryMessage, setRetryMessage] = useState("Didn't catch that.");
  const [attempt, setAttempt] = useState(0);
  const liveRef = useRef('');
  const recognitionRef = useRef<ReturnType<typeof newRecognition>>(null);
  const silenceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const recognition = newRecognition();
    if (!recognition) {
      onBlocked();
      return undefined;
    }
    recognitionRef.current = recognition;
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    const resetSilence = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      silenceRef.current = setTimeout(() => recognition.stop(), SILENCE_MS);
    };
    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i += 1) text += event.results[i][0].transcript;
      liveRef.current = text;
      setLive(text);
      resetSilence();
    };
    recognition.onerror = (event) => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        onBlocked();
        return;
      }
      // Our own stop()/abort() surfaces as this error in some browsers; onend settles it instead.
      if (event.error === 'aborted') return;
      setRetryMessage(event.error === 'network'
        ? "Voice needs your browser's speech service online."
        : "Didn't catch that.");
      setStage('retry');
    };
    recognition.onend = () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      const text = liveRef.current.trim();
      if (!text) {
        setStage('empty');
        return;
      }
      setFinalText(text);
      const parsed = talkParse(text);
      if (parsed.pain) {
        onPain(text);
        return;
      }
      if (Object.keys(parsed).length === 0) {
        setStage('empty');
        return;
      }
      setStage('heard');
    };

    try {
      recognition.start();
      resetSilence();
    } catch {
      onBlocked();
      return undefined;
    }
    return () => {
      if (silenceRef.current) clearTimeout(silenceRef.current);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retry = () => {
    liveRef.current = '';
    setLive('');
    setStage('listening');
    setAttempt((count) => count + 1);
  };

  if (stage === 'listening') {
    return (
      <Sheet title="Listening…" onClose={onClose} variant="voice">
        <div className="tt-voice-listen">
          <div className="tt-voice-mic tt-voice-mic--live" aria-hidden="true">
            <Icon name="mic" size={28} />
            <span className="tt-voice-eq"><i /><i /><i /></span>
          </div>
          <p className="tt-voice-transcript" aria-live="polite">
            {live || 'Say how long, what’s sore, and what to train.'}
          </p>
          <button type="button" className="tt-voice-stop" onClick={() => recognitionRef.current?.stop()}>
            <span className="tt-stopsq" aria-hidden="true" />
            Stop
          </button>
        </div>
      </Sheet>
    );
  }

  if (stage === 'empty' || stage === 'retry') {
    return (
      <Sheet title="Didn't catch that" onClose={onClose} variant="voice">
        <p className="tt-warn tt-voice-notheard">{stage === 'retry' ? retryMessage : "Didn't catch that — say how long, what's sore, and what to train."}</p>
        <div className="tt-bar">
          <button type="button" className="pill-primary" onClick={retry}>Try again</button>
          <button type="button" className="secondary" onClick={onFallback}>Use the chips instead</button>
        </div>
      </Sheet>
    );
  }

  // Same inputs `onConfirm` builds from (see TodayTalk's voiceConfirm), so the card never shows
  // something different from the plan a tap on "Yes, build it" produces.
  const talk = composeTalk(base, finalText, tapsAfterEdit(taps, text, finalText));
  const cardio = cardioNotice(finalText);
  const slots: { question: Question; label: string; value: string }[] = [
    { question: 'time', label: 'Time', value: `${talk.minutes} min` },
    { question: 'sore', label: 'Sore', value: talk.sore.length ? talk.sore.join(', ') : 'Nothing' },
    { question: 'train', label: 'Train', value: talk.train.length ? talk.train.join(', ') : 'Not set' },
    { question: 'gear', label: 'Gear', value: gearLabel(talk.equipment, profile) },
  ];

  return (
    <Sheet title="Here's what I heard" onClose={onClose} variant="voice">
      <p className="tt-voice-transcript tt-voice-transcript--done">“{finalText}”</p>
      {cardio && <p className="tt-hint">{cardio.charAt(0).toUpperCase() + cardio.slice(1)} noted — not tracked.</p>}
      <div className="tt-voice-slots">
        {slots.map((slot) => (
          <button key={slot.question} type="button" className="tt-voice-slot" onClick={() => onEditSlot(slot.question, finalText)}>
            <span className="tt-voice-slot__label">{slot.label}</span>
            <span className="tt-voice-slot__value">{slot.value}</span>
            <Icon name="edit" size={16} label={`Fix ${slot.label.toLowerCase()}`} />
          </button>
        ))}
      </div>
      <div className="tt-bar">
        <button type="button" className="pill-primary" onClick={() => onConfirm(finalText)}>Yes, build it</button>
        <button type="button" className="secondary" onClick={onFallback}>No, use chips</button>
      </div>
    </Sheet>
  );
}
