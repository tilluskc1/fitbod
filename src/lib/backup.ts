import type { AppState } from '../types.ts';

/** (#225) A backup older than this, with training to lose, earns the Today reminder. */
export const BACKUP_INTERVAL_DAYS = 7;
const DAY_MS = 86_400_000;

/** Due when there is at least one completed workout and no backup in the last 7 days. */
export function backupDue(state: AppState, now: Date): boolean {
  if (!state.history.some((workout) => workout.status === 'completed')) return false;
  if (!state.lastBackupAt) return true;
  return now.getTime() - Date.parse(state.lastBackupAt) > BACKUP_INTERVAL_DAYS * DAY_MS;
}

/** Today's one line, or null when no backup is due. */
export function backupReminder(state: AppState, now: Date): string | null {
  if (!backupDue(state, now)) return null;
  if (!state.lastBackupAt) return 'Not backed up yet.';
  const days = Math.floor((now.getTime() - Date.parse(state.lastBackupAt)) / DAY_MS);
  return `Last backup: ${days} days ago.`;
}

/** The slice of `navigator` the flow uses, injectable so it can be tested. */
export interface ShareNavigator {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
}

export type BackupResult = { ok: true; via: 'share' | 'download' } | { ok: false; message?: string };

/**
 * Hand the backup file to the Share sheet (Web Share API Level 2), or download
 * it where file sharing is unsupported. `ok` means a backup left the app: the
 * share resolved or the download fired. A cancel is silent; any other failure
 * returns a short message. Neither records a backup.
 */
export async function shareBackup(
  text: string,
  filename: string,
  deps: { nav?: ShareNavigator; download: (text: string, filename: string) => void },
): Promise<BackupResult> {
  const file = new File([text], filename, { type: 'application/json' });
  const { nav, download } = deps;
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      // Files only: some iOS share targets save a title as a separate text file.
      await nav.share({ files: [file] });
      return { ok: true, via: 'share' };
    } catch (error) {
      // The user closed the sheet: nothing to report.
      if ((error as { name?: unknown } | null)?.name === 'AbortError') return { ok: false };
      return { ok: false, message: 'Backup not shared, so nothing was recorded. Try again, or use Export JSON backup in Settings.' };
    }
  }
  try {
    download(text, filename);
  } catch {
    return { ok: false, message: 'Backup not saved, so nothing was recorded. Try again.' };
  }
  return { ok: true, via: 'download' };
}

/**
 * (#292) What Start over says after a backup try. A cancel or failure keeps
 * everything, and says so; a backup that left the app shows its own message.
 */
export function startOverBackupNote(result: { ok: boolean; message: string | null }): string | null {
  if (result.ok) return result.message;
  return result.message ? `${result.message} Nothing was erased.` : 'Backup cancelled. Nothing was erased.';
}

/** (#292) "Last backup: never" or "Last backup: 2 Nov". */
export function lastBackupLine(lastBackupAt?: string): string {
  if (!lastBackupAt) return 'Last backup: never';
  return `Last backup: ${new Date(lastBackupAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
