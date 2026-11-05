export type TabBarActionKind = 'start' | 'resume';

const META: Record<TabBarActionKind, { label: string; name: string }> = {
  start: { label: 'Start', name: 'Start workout' },
  resume: { label: 'Resume', name: 'Resume workout' },
};

/** (#20) An active session is never replaced from the tab bar: reopen it. */
export function tabBarAction(current: unknown, adapted: { exercises: readonly unknown[] }) {
  const kind: TabBarActionKind = current ? 'resume' : 'start';
  return { kind, ...META[kind], disabled: !current && adapted.exercises.length === 0 };
}
