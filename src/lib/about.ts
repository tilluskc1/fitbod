import type { FeedbackBody } from './sendFeedback.ts';

/**
 * (#253) Settings > About. Every line is the product default from the story; the claims must match
 * the code. "What we receive" is built from FEEDBACK_SENT, one entry per field `feedbackBody` puts in a
 * note, so a new field fails `tests/about253.test.ts` until this text says what it is.
 */
export const ABOUT_TITLE = 'About Home Strength';

export const ABOUT_WHO = 'Home Strength is built and run by a small independent team.';

export const ABOUT_WORKOUTS =
  "Your workouts, sets and settings stay on this phone, in this browser. We don't keep a copy. Back up regularly: clearing browser data deletes them.";

/** What a feedback note carries, in the order the About text names it. Keyed by `feedbackBody`'s fields. */
export const FEEDBACK_SENT: ReadonlyArray<{ field: keyof FeedbackBody['fields']; says: string }> = [
  { field: 'message', says: 'your message' },
  { field: 'name', says: 'your name if you add one' },
  { field: 'screen', says: 'the screen you were on' },
  { field: 'device', says: 'your phone type' },
  { field: 'appVersion', says: 'the app version' },
  { field: 'workoutCount', says: 'how many workouts you have logged' },
  { field: 'testerId', says: 'a random ID that is the same for every note from this phone' },
];

const listed = FEEDBACK_SENT.map((item) => item.says);

export const ABOUT_RECEIVE = `Only what you choose to send. A feedback note sends ${listed.slice(0, -1).join(', ')}, and ${listed.at(-1)}. Your workout details are never sent.`;

export const ABOUT_HOSTING = 'Like any website, the host keeps basic server logs.';

export const ABOUT_CREDITS = [
  'Exercise photos: free-exercise-db (public domain).',
  'Welcome photo and video: made with AI by the Home Strength team.',
  'Full list in CREDITS.md.',
] as const;

/*
 * (#253) Send feedback from About returns to About. The feedback sheet replaces Settings (App owns
 * which sheet is open), so About marks the return here and Settings reads it once when it mounts.
 */
let backToAbout = false;

export function markReturnToAbout(): void {
  backToAbout = true;
}

/** Read without clearing: safe in a render (StrictMode runs initialisers twice). */
export function returnsToAbout(): boolean {
  return backToAbout;
}

export function clearReturnToAbout(): void {
  backToAbout = false;
}
