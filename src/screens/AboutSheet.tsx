import type { ReactNode } from 'react';
import Sheet from '../components/ui/Sheet';
import { additionCredits } from '../lib/additions';
import { CheckIcon } from '../components/ui/Icons';
import {
  ABOUT_CREDITS,
  ABOUT_HOSTING,
  ABOUT_RECEIVE,
  ABOUT_TITLE,
  ABOUT_USAGE,
  ABOUT_WHO,
  ABOUT_WORKOUTS,
} from '../lib/about';
import { SAFETY_NOTICE } from '../lib/safety';
import './about.css';

interface Props {
  /** (#255) Open the Send feedback sheet; absent where feedback is not offered. */
  onFeedback?: () => void;
  /** Back to Settings. */
  onClose: () => void;
}

/** (#253) Settings > About: who makes the app, what stays on the phone, what a note sends, credits. */
export default function AboutSheet({ onFeedback, onClose }: Props) {
  const groups: Array<{ id: string; title: string; body: ReactNode }> = [
    {
      id: 'about-who',
      title: 'Who',
      body: (
        <>
          <p className="about__text">{ABOUT_WHO}</p>
          {onFeedback && (
            <button type="button" className="feasibility__alt about__feedback" onClick={onFeedback}>
              Send feedback
            </button>
          )}
        </>
      ),
    },
    { id: 'about-workouts', title: 'Your workouts', body: <p className="about__text">{ABOUT_WORKOUTS}</p> },
    {
      id: 'about-receive',
      title: 'What we receive',
      body: (
        <>
          <p className="about__text">{ABOUT_RECEIVE}</p>
          <p className="about__text">{ABOUT_USAGE}</p>
        </>
      ),
    },
    { id: 'about-hosting', title: 'Hosting', body: <p className="about__text">{ABOUT_HOSTING}</p> },
    { id: 'about-safety', title: 'Safety', body: <p className="about__text">{SAFETY_NOTICE}</p> },
    {
      id: 'about-credits',
      title: 'Credits',
      body: (
        <ul className="about__credits">
          {[...ABOUT_CREDITS, ...additionCredits()].map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ),
    },
  ];

  return (
    <Sheet title={ABOUT_TITLE} onClose={onClose} variant="settings">
      <div className="glass-scope settings about">
        {groups.map((group) => (
          <section key={group.id} className="settings-group" aria-labelledby={group.id}>
            <h3 className="settings-group__title" id={group.id}>
              {group.title}
            </h3>
            <div className="settings-card about__card">{group.body}</div>
          </section>
        ))}
        <div className="sheet-actions">
          <button className="primary" onClick={onClose}>
            <CheckIcon size={18} />
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
