import { useState } from 'react';
import Sheet from './ui/Sheet';
import Icon from './ui/Icon';
import { consequence } from '../lib/adapt';
import type { LengthOption } from '../lib/adapt';

export type LengthScope = 'today' | 'default';

interface Props {
  options: LengthOption[];
  current: number;
  onPick: (minutes: number, scope: LengthScope) => void;
  onClose: () => void;
}

function label(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** (#148) Two taps to change today's length: each option shows what it costs before it is chosen. */
export default function DurationSheet({ options, current, onPick, onClose }: Props) {
  const [scope, setScope] = useState<LengthScope>('today');
  return (
    <Sheet title="Workout duration" subtitle="Each option shows what changes before you pick it." onClose={onClose}>
      <div className="len-scope" role="group" aria-label="Apply to">
        <button type="button" aria-pressed={scope === 'today'} onClick={() => setScope('today')}>This workout</button>
        <button type="button" aria-pressed={scope === 'default'} onClick={() => setScope('default')}>Set as default</button>
      </div>
      <div className="len-list">
        {options.map((option) => (
          <button
            key={option.minutes}
            type="button"
            className="len-opt"
            aria-current={option.minutes === current ? 'true' : undefined}
            onClick={() => onPick(option.minutes, scope)}
          >
            <span className="len-opt__badge" aria-hidden="true">{option.minutes}</span>
            <span className="len-opt__text">
              <span className="len-opt__name">{label(option.minutes)}</span>
              <span className={`len-opt__c ${option.kind === 'none' ? 'len-opt__c--none' : ''}`}>{consequence(option)}</span>
            </span>
            {option.minutes === current ? <Icon name="check" size={20} /> : <span />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
