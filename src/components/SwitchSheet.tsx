import { useState } from 'react';
import Sheet from './ui/Sheet';
import Icon from './ui/Icon';
import type { SwitchOption } from '../lib/switchDay';
import { AREAS } from '../lib/areas';
import type { Area } from '../lib/areas';
import { NO_PICKS, PART_LABEL, PRESETS, consequenceLine, pickPreset, togglePart } from '../lib/switchPick';
import type { PickPreview, Picks } from '../lib/switchPick';

interface Props {
  options: SwitchOption[];
  onPick: (option: SwitchOption) => void;
  onClose: () => void;
  /** (#296) What the picks build, from the same path Plan today with me runs; null with nothing picked. */
  preview: (picks: Picks) => PickPreview | null;
  /** (#296) "trained yesterday" per body part, a label only. */
  recovery: Partial<Record<Area, string>>;
  onBuild: (picks: Picks) => void;
  /** "Sore or hurt? Plan today with me": Switch never asks about pain. */
  onPlanToday: () => void;
  /** (#219) The gear fix for a pick today's kit cannot train. */
  onChangeGear: () => void;
}

const STATUS: Record<SwitchOption['status'], string> = { ready: 'Ready', limited: 'Limited', none: 'Not enough equipment' };

function listOf(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * (#150) Pick any day in the split. A later day skips the ones before it, and says so.
 * (#296) Or train something else: a preset or body parts, built as a today-only described day.
 */
export default function SwitchSheet({ options, onPick, onClose, preview, recovery, onBuild, onPlanToday, onChangeGear }: Props) {
  const [picks, setPicks] = useState<Picks>(NO_PICKS);
  const [first] = options;
  const next = options[1];
  const built = picks.parts.length > 0 ? preview(picks) : null;
  const canBuild = built !== null && built.exercises > 0;
  return (
    <Sheet
      title="Switch workout"
      subtitle="Within your split. Skipping never adds catch-up work."
      onClose={onClose}
      variant="switch"
      footer={(
        <>
          {picks.parts.length === 0 && <p className="sw-hint">Pick at least one</p>}
          <button type="button" className="pill-primary sw-build" disabled={!canBuild} onClick={() => onBuild(picks)}>
            Build this workout
          </button>
        </>
      )}
    >
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

      <section className="sw-else" aria-labelledby="sw-else-title">
        <h3 className="sw-else__title" id="sw-else-title">Or train something else</h3>
        <p className="sw-else__sub">Today only. Your plan stays next.</p>
        <div className="sw-chips sw-chips--presets" role="group" aria-label="Workout type">
          {PRESETS.map((preset) => (
            <button key={preset} type="button" className="sw-chip" aria-pressed={picks.preset === preset} onClick={() => setPicks(pickPreset(picks, preset))}>
              {preset}
            </button>
          ))}
        </div>
        <div className="sw-chips sw-chips--parts" role="group" aria-label="Body parts">
          {AREAS.map((area) => (
            <button
              key={area}
              type="button"
              className="sw-chip sw-chip--part"
              aria-pressed={picks.parts.includes(area)}
              aria-label={recovery[area] ? `${PART_LABEL[area]}, ${recovery[area]}` : PART_LABEL[area]}
              onClick={() => setPicks(togglePart(picks, area))}
            >
              <span className="sw-chip__name">{PART_LABEL[area]}</span>
              {recovery[area] && <span className="sw-chip__rec">{recovery[area]}</span>}
            </button>
          ))}
        </div>
        <div className="sw-out" aria-live="polite">
          {built && (
            <>
              <p className={`sw-line sw-line--${built.status}`}>{consequenceLine(built)}</p>
              {built.smallLine && <p className="sw-note">{built.smallLine}</p>}
              {built.status !== 'ready' && built.reasons.length > 0 && (
                <div className={`feasibility feasibility--${built.status === 'none' ? 'infeasible' : 'limited'}`} role="note">
                  <p className="feasibility__line">{built.status === 'none' ? 'Not enough equipment' : 'Limited'}</p>
                  {built.reasons.map((line) => (
                    <p className="feasibility__reason" key={line.label}><b>{line.label}</b> {line.text}</p>
                  ))}
                  {built.gearGap && (
                    <button type="button" className="text-action" onClick={onChangeGear}>Change today's gear</button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <button type="button" className="sw-plan" onClick={onPlanToday}>
          Sore or hurt? <b>Plan today with me</b>
          <Icon name="chevron_right" size={18} />
        </button>
      </section>
    </Sheet>
  );
}
