import type { AppState } from '../types.ts';

/**
 * Whether the app opens on the splash for this data: only when there is no profile yet, so
 * onboarding comes next. A stored profile means onboarding already happened, so a reload, a
 * resumed session or a restored backup (#285) never sits behind the splash.
 */
export function opensOnSplash(state: AppState): boolean {
  return state.profile === null;
}

/**
 * (#288) The splash after this tab adopts another tab's newer data: it lifts once that data has a
 * profile, and is never raised again by an adoption, so a tab mid-onboarding or on Today stays put.
 */
export function splashAfterAdopt(shown: boolean, adopted: AppState): boolean {
  return shown && opensOnSplash(adopted);
}
