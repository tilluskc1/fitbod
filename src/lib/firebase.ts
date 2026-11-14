/**
 * (#255) The Firebase project behind in-app feedback. Both values are public by design: the
 * Firestore rules allow `create` on `feedback` only, with field and size checks, and refuse
 * every read. No secret lives here and no env var is needed.
 */
export const FIREBASE = {
  projectId: 'home-strength',
  apiKey: 'AIzaSyA2efM2HsT1n1GpIiTrk4eFCkwREdFhUvo',
  /** (#359) The project's Google sign-in web client (public, as Firebase's own createAuthUri returns it). */
  googleClientId: '9260936720-e1n79bki64nf6u313nki5egebtisp6on.apps.googleusercontent.com',
} as const;
