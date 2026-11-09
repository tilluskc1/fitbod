/**
 * Weight cells whose suggested start the lifter cleared (#309 review 2), so a reload does not put the
 * suggestion back. UI memory for the running workout only, under its own key: the workout record is
 * unchanged. It holds one session at a time, so it never grows past one workout's cells.
 */
const KEY = 'fitbod-clone-v1:cleared-cells';

export function readCleared(sessionId: string): string[] {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null') as { session?: unknown; cells?: unknown } | null;
    if (raw?.session !== sessionId || !Array.isArray(raw.cells)) return [];
    return raw.cells.filter((cell): cell is string => typeof cell === 'string');
  } catch {
    return [];
  }
}

export function writeCleared(sessionId: string, cells: string[]): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ session: sessionId, cells }));
  } catch {
    // Storage full or blocked: the cell stays empty for this visit only.
  }
}
