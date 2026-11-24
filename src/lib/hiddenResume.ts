/**
 * (#430) "Hide for now" on the resume row: device-local, one workout id, never part of the backup or the
 * synced record. Hiding only tucks the row away; the workout stays open, Plan keeps a quiet Resume and
 * expiry still applies. A new workout id shows its row again.
 */
export const HIDDEN_RESUME_KEY = 'fitbod-clone-v1:hidden-resume';

type KeyStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function store(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The workout id whose row is hidden on this device, or null. */
export function readHiddenResume(from: KeyStore | null = store()): string | null {
  try {
    const value = from?.getItem(HIDDEN_RESUME_KEY) ?? null;
    return value && value.trim() !== '' ? value : null;
  } catch {
    return null;
  }
}

/** Hide the row for this workout id, or clear it with null. Best effort: a refusal only shows the row. */
export function writeHiddenResume(id: string | null, to: KeyStore | null = store()): void {
  try {
    if (id === null) to?.removeItem(HIDDEN_RESUME_KEY);
    else to?.setItem(HIDDEN_RESUME_KEY, id);
  } catch {
    // Storage refused: the row simply stays visible.
  }
}
