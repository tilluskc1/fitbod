import Sheet from './ui/Sheet';
import Icon from './ui/Icon';
import type { SwitchOption } from '../lib/switchDay';

interface Props {
  options: SwitchOption[];
  onPick: (option: SwitchOption) => void;
  onClose: () => void;
}

const STATUS: Record<SwitchOption['status'], string> = { ready: 'Ready', limited: 'Limited', none: 'Not enough equipment' };

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** (#150) Pick any day in the split. A later day skips the ones before it, and says so. */
export default function SwitchSheet({ options, onPick, onClose }: Props) {
  const [first] = options;
  const next = options[1];
  return (
    <Sheet title="Switch workout" subtitle="Within your split. Skipping never adds catch-up work." onClose={onClose}>
      <div className="len-list">
        {options.map((option) => (
          <button key={option.slotId} type="button" className="len-opt" aria-current={option.offset === 0 ? 'true' : undefined} onClick={() => onPick(option)}>
            <span className="len-opt__badge" aria-hidden="true">{option.name.charAt(0)}</span>
            <span className="len-opt__text">
              <span className="len-opt__name">{option.name}{option.offset === 0 ? ' · next' : ''}</span>
              <span className={`len-opt__c len-opt__c--${option.status}`}>
                {STATUS[option.status]} · {option.totalSets} {option.totalSets === 1 ? 'set' : 'sets'}
                {option.totalSets > 0 ? ` · ${option.approx ? '≈' : ''}${option.minutes} min` : ''}
                {option.offset > 0 ? ` · skips ${listOf(option.skips)}` : ''}
              </span>
            </span>
            {option.offset === 0 ? <Icon name="check" size={20} /> : <span />}
          </button>
        ))}
        {first && next && (
          <button type="button" className="len-opt" onClick={() => onPick(next)}>
            <span className="len-opt__badge" aria-hidden="true"><Icon name="arrow_forward" size={18} /></span>
            <span className="len-opt__text">
              <span className="len-opt__name">Skip {first.name}</span>
              <span className="len-opt__c">{next.name} becomes next. A skip earns no progression.</span>
            </span>
            <span />
          </button>
        )}
      </div>
    </Sheet>
  );
}
