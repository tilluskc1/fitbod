import type { ReactNode } from 'react';
import Icon from './Icon';

export type Tab = 'today' | 'plan' | 'progress' | 'coach';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'local_fire_department' },
  { id: 'plan', label: 'Plan', icon: 'calendar_month' },
  { id: 'progress', label: 'Progress', icon: 'monitoring' },
  { id: 'coach', label: 'Coach', icon: 'chat_bubble' },
];

export type TabBarAction = {
  /** What the action does now: begin today's workout or reopen the live one. */
  kind: 'start' | 'resume';
  onActivate: () => void;
  disabled?: boolean;
};

const ACTION_META: Record<TabBarAction['kind'], { label: string; name: string }> = {
  start: { label: 'Start', name: 'Start workout' },
  resume: { label: 'Resume', name: 'Resume workout' },
};

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
          className="tab tab-action"
          onClick={workoutAction.onActivate}
          disabled={workoutAction.disabled}
          aria-disabled={workoutAction.disabled}
          aria-label={ACTION_META[workoutAction.kind].name}
        >
          <span className="tab-action__play" aria-hidden="true">
            <Icon name="play_arrow" size={26} />
          </span>
          <span aria-hidden="true">{ACTION_META[workoutAction.kind].label}</span>
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
