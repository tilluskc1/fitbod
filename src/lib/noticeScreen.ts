/**
 * (#259) A passing message belongs to the screen that raised it. The screen is the full-screen
 * view, or the tab when the tab bar shows; a sheet opening over it is not a new screen.
 */
export function screenKey(view: string, tab: string): string {
  return view === 'tabs' ? `tabs:${tab}` : view;
}

/** The recap's own exit lands on Today, so its message ("Session saved to history") goes along (#276). */
const CONTINUES: Record<string, string> = { recap: 'tabs:today' };

/**
 * Where a message raised on `raisedOn` belongs once the user is on `screen`: the screen it now
 * belongs to, or null to clear it. It stays on the screen it was raised on, including one a handler
 * moved to in the same update (a skip that returns to Today, a finish that opens the recap), and
 * follows the recap to Today; any other move clears it, so a Today banner never follows the user into
 * the logger and a recap message never follows them into Coach or Progress.
 */
export function noticeHome(raisedOn: string | null, screen: string): string | null {
  if (raisedOn === null) return null;
  return raisedOn === screen || CONTINUES[raisedOn] === screen ? screen : null;
}
