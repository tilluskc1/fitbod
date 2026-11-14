import { useMemo, useState } from 'react';
import Sheet from './ui/Sheet';
import { GYM_GROUPS, GYM_ITEMS, gymItem, initialTicks, orderedItems } from '../data/gymItems';
import { readGymText } from '../lib/gymText';
import { gymTicks, type GymTaps } from '../lib/myGym';
import type { GymItemId, Profile } from '../types';

interface Props {
  /** The saved list and families the sheet opens with. */
  profile: Pick<Profile, 'gymItems' | 'equipment' | 'support'>;
  onSave: (items: GymItemId[]) => void;
  /** Absent when there is no saved list to clear (onboarding, or none saved yet). */
  onClear?: () => void;
  onClose: () => void;
}

/**
 * (#357) "My gym": type what the gym has, check the ticks, save. The text is read on the phone, best
 * effort (lesson 3); the chips are the truth and a tap always wins over the text. Nothing is saved until
 * Save my gym.
 */
export default function MyGymSheet({ profile, onSave, onClear, onClose }: Props) {
  const [start] = useState(() => initialTicks(profile));
  const [text, setText] = useState('');
  const [taps, setTaps] = useState<GymTaps>({});
  const read = useMemo(() => readGymText(text), [text]);
  const ticks = gymTicks(start, read, taps);
  const typed = text.trim().length > 0;
  const toggle = (id: GymItemId) => setTaps((current) => ({ ...current, [id]: !ticks.includes(id) }));

  return (
    <Sheet
      title="My gym"
      subtitle="Plans use only what is ticked. Nothing changes until you save."
      onClose={onClose}
      variant="gym"
      headingId="my-gym-title"
    >
      <form
        className="my-gym"
        onSubmit={(event) => {
          event.preventDefault();
          if (ticks.length > 0) onSave(orderedItems(ticks));
        }}
      >
        <label className="field-label" htmlFor="my-gym-text">What does your gym have?</label>
        <textarea
          id="my-gym-text"
          className="feedback-form__message my-gym__text"
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. leg press, leg curl, dumbbells, cable stack"
          aria-describedby="my-gym-read"
          autoComplete="off"
        />
        <p className={`my-gym__read${typed && read.length === 0 ? ' my-gym__read--none' : ''}`} id="my-gym-read" role="status">
          {!typed ? 'Or tick it below.'
            : read.length === 0 ? "Didn't catch that. Tick what your gym has."
              : `Ticked from your words: ${read.map((id) => gymItem(id).label).join(', ')}. Check the list below.`}
        </p>
        {GYM_GROUPS.map((group) => (
          <fieldset className="my-gym__group" key={group}>
            <legend className="setup-label">{group}</legend>
            <div className="chip-wrap">
              {GYM_ITEMS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`chip ${ticks.includes(item.id) ? 'on' : ''}`}
                  aria-pressed={ticks.includes(item.id)}
                  onClick={() => toggle(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        <p className="settings-row__note my-gym__note">
          Machines and cables not ticked are never planned or offered as swaps. Bodyweight work is always available.
        </p>
        {onClear && (
          <button type="button" className="text-action my-gym__clear" onClick={onClear}>
            Clear my gym list (every machine counts again)
          </button>
        )}
        <div className="sheet-actions">
          <button type="submit" className="primary" disabled={ticks.length === 0}>
            Save my gym{ticks.length > 0 ? ` (${ticks.length})` : ''}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
