import type { ReactNode } from 'react';
import Icon from './Icon';

export type Tab = 'today' | 'plan' | 'progress' | 'coach';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'local_fire_department' },
  { id: 'plan', label: 'Plan', icon: 'calendar_month' },
  { id: 'progress', label: 'Progress', icon: 'monitoring' },
  { id: 'coach', label: 'Coach', icon: 'chat_bubble' },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="tabbar" aria-label="Main navigation">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${active === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={23} filled={active === tab.id} />
          {tab.label}
        </button>
      ))}
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
