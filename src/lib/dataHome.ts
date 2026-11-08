/**
 * #258: data lives only in this browser. Three moments say so: onboarding's last step, the first
 * open of an installed Home Screen app with no data, and the first finished workout's recap.
 * Each is "once" by its own condition, so nothing new is stored.
 */
export const DATA_ON_PHONE = 'Your workouts stay on this phone. Back up from Settings now and then.';
export const INSTALLED_FRESH = 'Starting fresh? If you used the browser before, restore your backup here.';
export const FIRST_BACKUP = 'Your first workout is saved on this phone only. A backup keeps it safe if you clear the browser or change phones.';

/** The recap offers "Back up now" for the first completed workout only, and only before any backup. */
export function offerFirstBackup(state: { history: { status: string }[]; lastBackupAt?: string }): boolean {
  return !state.lastBackupAt && state.history.filter((workout) => workout.status === 'completed').length === 1;
}
