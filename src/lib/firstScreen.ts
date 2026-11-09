import type { AppState } from '../types.ts';

/**
 * Whether the app opens on the splash for this data: only when there is no profile yet, so
 * onboarding comes next. A stored profile means onboarding already happened, so a reload, a
 * resumed session or a restored backup (#285) never sits behind the splash.
 */
export function opensOnSplash(state: AppState): boolean {
  return state.profile === null;
}
