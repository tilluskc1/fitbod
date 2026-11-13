/**
 * (#295) Every message on screen is one of three kinds, by meaning:
 * - Done: an action worked. A dark toast near the bottom that passes on its own after 4 s.
 * - Heads-up: act soon, nothing broke. A card in the screen's flow, until acted on or dismissed.
 * - Problem: something failed. A red card at the top of the screen, until resolved.
 */
export type NoticeKind = 'done' | 'headsUp' | 'problem';

export interface Notice {
  kind: NoticeKind;
  text: string;
}

export const done = (text: string): Notice => ({ kind: 'done', text });
export const headsUp = (text: string): Notice => ({ kind: 'headsUp', text });
export const problem = (text: string): Notice => ({ kind: 'problem', text });

/** How long a Done toast stays up. */
export const TOAST_MS = 4000;

/** Only Done passes on its own; the cards wait for the user. */
export function noticeExpires(notice: Notice): boolean {
  return notice.kind === 'done';
}

/** Done and Heads-up are announced politely; a Problem interrupts. */
export function noticeRole(kind: NoticeKind): 'status' | 'alert' {
  return kind === 'problem' ? 'alert' : 'status';
}

/** A toast fired while a sheet is open waits for the sheet to close, never showing behind it. */
export function toastShows(notice: Notice | null, sheetOpen: boolean): boolean {
  return notice !== null && notice.kind === 'done' && !sheetOpen;
}

/**
 * (#351) A Done that says something was saved. Under a standing save error it is untrue, so it never
 * shows there; the Problem card says what happened. "No sets logged, so nothing was saved." claims
 * nothing and is not one.
 */
const SAVE_CLAIMS = ['Workout saved.', 'Saved for future workouts.'];

export function claimsSave(notice: Notice | null): boolean {
  return notice !== null && notice.kind === 'done' && SAVE_CLAIMS.some((claim) => notice.text.startsWith(claim));
}

/** (#351) A notice updater for a failed save: a save claim goes, anything else stays. */
export const dropSaveClaim = (notice: Notice | null): Notice | null => (claimsSave(notice) ? null : notice);

/**
 * (#295, #307) Today's Heads-up cards, in priority order. Product default (owner can override):
 * at most one shows at a time; the install note first, then the backup note, then the rest
 * (a passing Heads-up message, the Limited day, the fresher-day offer).
 */
export const TODAY_CARD_ORDER = ['install', 'backup', 'message', 'limited', 'fresher'] as const;
export type TodayCard = (typeof TODAY_CARD_ORDER)[number];

export function todayCard(present: Partial<Record<TodayCard, boolean>>): TodayCard | null {
  return TODAY_CARD_ORDER.find((key) => present[key]) ?? null;
}
