import Sheet from './ui/Sheet';
import Icon from './ui/Icon';
import { EQUIPMENT_OPTIONS, setupConsequence } from '../lib/adapt';
import type { EquipmentChoice, SetupOption } from '../lib/adapt';

interface Props {
  options: SetupOption[];
  current: EquipmentChoice;
  dayName: string;
  savedGear: string;
  onPick: (choice: EquipmentChoice) => void;
  onEditSaved: () => void;
  onClose: () => void;
}

/** (#149) Today's equipment, each option with what still fits. Today only; saved gear lives in Settings. */
export default function GymSheet({ options, current, dayName, savedGear, onPick, onEditSaved, onClose }: Props) {
  return (
    <Sheet title="Your gym" subtitle={`Saved gear: ${savedGear}. A change here is for today only.`} onClose={onClose}>
      <div className="len-list">
        {options.map((option) => (
          <button
            key={option.choice}
            type="button"
            className="len-opt"
            aria-current={option.choice === current ? 'true' : undefined}
            onClick={() => onPick(option.choice)}
          >
            <span className="len-opt__badge" aria-hidden="true"><Icon name="fitness_center" size={18} /></span>
            <span className="len-opt__text">
              <span className="len-opt__name">{EQUIPMENT_OPTIONS[option.choice].label}</span>
              <span className={`len-opt__c ${option.kind === 'none' ? 'len-opt__c--none' : ''}`}>{setupConsequence(option, dayName)}</span>
            </span>
            {option.choice === current ? <Icon name="check" size={20} /> : <span />}
          </button>
        ))}
        <button type="button" className="len-opt" onClick={onEditSaved}>
          <span className="len-opt__badge" aria-hidden="true"><Icon name="tune" size={18} /></span>
          <span className="len-opt__text">
            <span className="len-opt__name">Edit saved equipment</span>
            <span className="len-opt__c">Changes your program, not just today</span>
          </span>
          <Icon name="chevron_right" size={20} />
        </button>
      </div>
    </Sheet>
  );
}
