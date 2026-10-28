import { useState } from 'react';
import { EQUIPMENT_OPTIONS, SUPPORT_OPTIONS } from '../data/exercises';
import type { Equipment, Experience, Goal, Profile, SupportEquipment } from '../types';

interface Props {
  onComplete: (profile: Profile) => void;
}

const GOALS: { value: Goal; label: string; blurb: string }[] = [
  { value: 'Build Muscle', label: 'Build muscle', blurb: 'Hypertrophy-focused training' },
  { value: 'Lose Fat', label: 'Lose fat', blurb: 'Higher-rep, higher-volume work' },
  { value: 'Get Stronger', label: 'Get stronger', blurb: 'Compound-lift progression' },
  { value: 'General Fitness', label: 'General fitness', blurb: 'Balanced full-body training' },
];

const EXPERIENCES: { value: Experience; label: string; blurb: string }[] = [
  { value: 'Beginner', label: 'Beginner', blurb: 'New to lifting or returning after a break' },
  { value: 'Intermediate', label: 'Intermediate', blurb: '6+ months of consistent training' },
  { value: 'Advanced', label: 'Advanced', blurb: 'Years of structured training' },
];

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [goal, setGoal] = useState<Goal>('Build Muscle');
  const [experience, setExperience] = useState<Experience>('Beginner');
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [equipment, setEquipment] = useState<Equipment[]>(['Dumbbell']);
  const [support, setSupport] = useState<SupportEquipment[]>(['Bench']);

  const toggleEquipment = (item: Equipment) => {
    setEquipment((current) =>
      current.includes(item) ? current.filter((value) => value !== item) : [...current, item],
    );
  };

  const toggleSupport = (item: SupportEquipment) => {
    setSupport((current) =>
      current.includes(item) ? current.filter((value) => value !== item) : [...current, item],
    );
  };

  const finish = () => {
    onComplete({
      goal,
      experience,
      daysPerWeek,
      equipment,
      support,
      exclusions: [],
      loads: {},
      name: name.trim() || 'Athlete',
      unit: 'kg',
      sessionMinutes: 35,
    });
  };

  return (
    <div className="onboarding">
      <div className="onboarding-top">
        <div className="logo">
          YOUR STRENGTH <b>·</b> COACH
        </div>
        <div className="progress-dots" aria-label={`Step ${step + 1} of 4`}>
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className={`dot ${index <= step ? 'on' : ''}`} />
          ))}
        </div>
      </div>

      {step === 0 && (
        <section className="onboarding-step">
          <h1>Let’s make this yours.</h1>
          <p className="muted">A plan you can keep, built around the equipment you actually own.</p>

          <label className="setup-label" htmlFor="onboarding-name">
            What should the coach call you?
          </label>
          <input
            id="onboarding-name"
            className="search"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your first name"
            autoComplete="given-name"
          />

          <span className="setup-label">Your goal</span>
          <div className="option-list">
            {GOALS.map((option) => (
              <button
                key={option.value}
                className={`option-card ${goal === option.value ? 'selected' : ''}`}
                onClick={() => setGoal(option.value)}
                aria-pressed={goal === option.value}
              >
                <span className="option-title">{option.label}</span>
                <span className="option-blurb">{option.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="onboarding-step">
          <h1>How much training have you done?</h1>
          <p className="muted">This sets exercise volume and how many exercises a session holds.</p>
          <div className="option-list">
            {EXPERIENCES.map((option) => (
              <button
                key={option.value}
                className={`option-card ${experience === option.value ? 'selected' : ''}`}
                onClick={() => setExperience(option.value)}
                aria-pressed={experience === option.value}
              >
                <span className="option-title">{option.label}</span>
                <span className="option-blurb">{option.blurb}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="onboarding-step">
          <h1>How many days per week?</h1>
          <p className="muted">Pick a schedule you can actually keep. Missed days never add catch-up work.</p>
          <div className="day-picker">
            {[2, 3, 4, 5, 6].map((days) => (
              <button
                key={days}
                className={`day-chip ${daysPerWeek === days ? 'selected' : ''}`}
                onClick={() => setDaysPerWeek(days)}
                aria-pressed={daysPerWeek === days}
              >
                {days}
                <span>days</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="onboarding-step">
          <h1>What equipment do you have?</h1>
          <p className="muted">Only supported exercises appear. Nothing is assumed from what you pick.</p>

          <span className="setup-label">Primary equipment</span>
          <div className="chip-wrap">
            {EQUIPMENT_OPTIONS.map((item) => (
              <button
                key={item}
                className={`chip ${equipment.includes(item) ? 'on' : ''}`}
                onClick={() => toggleEquipment(item)}
                aria-pressed={equipment.includes(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <span className="setup-label">Support equipment</span>
          <p className="muted">
            A bench is never assumed just because you own dumbbells, and a rack is never assumed for
            barbell squats.
          </p>
          <div className="chip-wrap">
            {SUPPORT_OPTIONS.map((item) => (
              <button
                key={item}
                className={`chip ${support.includes(item) ? 'on' : ''}`}
                onClick={() => toggleSupport(item)}
                aria-pressed={support.includes(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <p className="muted">
            You can change this later. Bodyweight work is always available.
          </p>
        </section>
      )}

      <div className="onboarding-actions">
        {step > 0 && (
          <button className="secondary" style={{ flex: '0 0 104px' }} onClick={() => setStep((value) => value - 1)}>
            Back
          </button>
        )}
        {step < 3 ? (
          <button className="primary" onClick={() => setStep((value) => value + 1)}>
            Continue
          </button>
        ) : (
          <button className="primary" onClick={finish}>
            Build my plan
          </button>
        )}
      </div>
    </div>
  );
}
