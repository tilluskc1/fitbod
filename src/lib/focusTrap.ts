/**
 * Where Tab should land inside a modal: wrap from the last focusable to the
 * first (and back with Shift), and pull focus in when it sits outside.
 * Returns null when the browser's own move stays inside.
 */
export function trapTarget(current: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return backwards ? count - 1 : 0;
  if (!backwards && current === count - 1) return 0;
  if (backwards && current === 0) return count - 1;
  return null;
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
