import type { ReactNode } from 'react';
import Icon from './Icon';
import type { TabBarActionKind } from '../../lib/tabBarAction';

export type Tab = 'today' | 'plan' | 'progress' | 'coach';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'local_fire_department' },
  { id: 'plan', label: 'Plan', icon: 'calendar_month' },
  { id: 'progress', label: 'Progress', icon: 'monitoring' },
  { id: 'coach', label: 'Coach', icon: 'chat_bubble' },
];

export type TabBarAction = {
  /** What the action does now: begin today's workout or reopen the live one. */
  kind: TabBarActionKind;
  label: string;
  name: string;
  onActivate: () => void;
  disabled?: boolean;
  /** Share of the open session's sets already logged (0–1); drawn as a ring around Resume. */
  progress?: number;
};

/** Ring length for r=35 (2πr ≈ 220). */
const RING = 220;

export function TabBar({
  active,
  onChange,
  workoutAction,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  /** (#20) When set, a primary action sits between Plan and Progress. */
  workoutAction?: TabBarAction;
}) {
  const tabButton = (tab: (typeof TABS)[number]) => (
    <button
      key={tab.id}
      className={`tab ${active === tab.id ? 'active' : ''}`}
      onClick={() => onChange(tab.id)}
      aria-current={active === tab.id ? 'page' : undefined}
    >
      <Icon name={tab.icon} size={23} filled={active === tab.id} />
      {tab.label}
    </button>
  );

  return (
    <nav className="tabbar" aria-label="Main navigation">
      {TABS.slice(0, 2).map((tab) => tabButton(tab))}
      {workoutAction && (
        <button
          type="button"
          className={`tab tab-action ${workoutAction.kind === 'resume' ? 'tab-action--resume' : ''}`.trim()}
          onClick={workoutAction.onActivate}
          disabled={workoutAction.disabled}
          aria-label={
            workoutAction.kind === 'resume' && workoutAction.progress !== undefined
              ? `${workoutAction.name}, ${Math.round(workoutAction.progress * 100)}% of sets logged`
              : workoutAction.name
          }
        >
          <span className="tab-action__play" aria-hidden="true">
            {workoutAction.kind === 'resume' && (
              <svg className="tab-action__ring" viewBox="0 0 76 76">
                <circle cx="38" cy="38" r="35" fill="none" stroke="rgba(28, 36, 6, 0.15)" strokeWidth="4" />
                <circle
                  cx="38"
                  cy="38"
                  r="35"
                  fill="none"
                  stroke="#1c2406"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${(RING * Math.min(1, Math.max(0, workoutAction.progress ?? 0))).toFixed(1)} ${RING}`}
                  transform="rotate(-90 38 38)"
                />
              </svg>
            )}
            <Icon name="play_arrow" size={28} />
          </span>
          <span className="tab-action__label" aria-hidden="true">{workoutAction.label}</span>
        </button>
      )}
      {TABS.slice(2).map((tab) => tabButton(tab))}
    </nav>
  );
}

/**
 * The device shell. There is deliberately no fake status bar or home
 * indicator: real insets come from env(safe-area-inset-*), and the chrome that
 * pretends to be iOS is exactly what makes a web app feel like a mockup.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="frame-stage">
      <div className="native-app">{children}</div>
    </div>
  );
}
