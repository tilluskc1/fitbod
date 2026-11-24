export type TabBarActionKind = 'plan' | 'resume';

// (#428) The visible caption is "Talk", not "Plan": the nav bar already has a Plan tab, and this
// caption is plain text (not the accessible name below), so a same-named locator would hit both.
const META: Record<TabBarActionKind, { label: string; name: string }> = {
  plan: { label: 'Talk', name: 'Plan today with me' },
  resume: { label: 'Resume', name: 'Resume workout' },
};

/**
 * (#20) An active session is never replaced from the tab bar: reopen it.
 * (#428) Otherwise the button never starts a workout; it opens the "Plan today with
 * me" helper, which always has something to offer — even an empty or infeasible day
 * is exactly what it is for — so it is never disabled.
 */
export function tabBarAction(current: unknown) {
  const kind: TabBarActionKind = current ? 'resume' : 'plan';
  return { kind, ...META[kind], disabled: false };
}
