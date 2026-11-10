/**
 * (#255) The Firebase project behind in-app feedback. Both values are public by design: the
 * Firestore rules allow `create` on `feedback` only, with field and size checks, and refuse
 * every read. No secret lives here and no env var is needed.
 */
export const FIREBASE = {
  projectId: 'home-strength',
  apiKey: 'AIzaSyA2efM2HsT1n1GpIiTrk4eFCkwREdFhUvo',
} as const;
