import type { ReactNode } from 'react';
import Icon from './Icon';
import { HelpIcon } from './Icons';

export type Tab = 'today' | 'plan' | 'progress' | 'coach';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'local_fire_department' },
  { id: 'plan', label: 'Plan', icon: 'calendar_month' },
  { id: 'progress', label: 'Progress', icon: 'monitoring' },
  { id: 'coach', label: 'Coach', icon: 'chat_bubble' },
];

/** (#430) The centre button: Ask in every state. It never starts, resumes or ends a workout, and is never disabled. */
export type TabBarAsk = {
  onAsk: () => void;
  /** Voice is missing or was refused: a question mark stands in for the mic. */
  voiceBlocked: boolean;
};

export function TabBar({
  active,
  onChange,
  ask,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
  ask?: TabBarAsk;
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
      {ask && (
        <button type="button" className="tab tab-action" onClick={ask.onAsk} aria-label="Ask">
          <span className="tab-action__play" aria-hidden="true">
            {ask.voiceBlocked ? <HelpIcon /> : <Icon name="mic" size={28} />}
          </span>
          <span className="tab-action__label" aria-hidden="true">Ask</span>
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
