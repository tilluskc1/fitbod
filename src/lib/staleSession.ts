import type { WorkoutRecord } from '../types.ts';
import { unfinishedSince } from './session.ts';

/**
 * (#399) The one "stale session" test Today and Plan both read (lesson 36): the open session started on an
 * earlier calendar day (23:50 seen at 00:10 counts). A legacy session with no or a bad date is never stale.
 * Built on #397's `unfinishedSince`, so the hero's "from <day>" and this test can never disagree (lesson 9).
 */
export function isStaleSession(session: Pick<WorkoutRecord, 'date'> | null | undefined, now: Date): boolean {
  return unfinishedSince(session ?? null, now) !== null;
}
