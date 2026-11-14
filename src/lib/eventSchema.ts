/**
 * (#359) The event names, day types and the field allowlist. Kept out of events.ts so the training
 * app's bundle does not carry them: only /admin, the tests and (as types) events.ts read this file.
 * firestore.rules repeats these lists; tests/admin359.test.ts checks the field list there.
 */
export const EVENT_NAMES = [
  'workout-started',
  'workout-finished',
  'workout-cut-short',
  'switch',
  'plan-today',
  'replace',
  'supersets-on',
  'supersets-off',
  'backup',
  'feedback',
] as const;

export const DAY_TYPES = ['push', 'pull', 'legs', 'upper', 'lower', 'full-body', 'picked'] as const;

/** The only fields an event may carry, in this order. A test fails the build on anything else. */
export const EVENT_FIELDS = ['testerId', 'event', 'dayType', 'appVersion', 'date', 'createdAt'] as const;
