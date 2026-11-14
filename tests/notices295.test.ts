import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  done,
  headsUp,
  problem,
  noticeRole,
  noticeExpires,
  toastShows,
  todayCard,
  TODAY_CARD_ORDER,
  TOAST_MS,
} from '../src/lib/notices.ts';

test('each kind has its own constructor and lifetime (#295)', () => {
  assert.deepEqual(done('Workout saved.'), { kind: 'done', text: 'Workout saved.' });
  assert.deepEqual(headsUp('x'), { kind: 'headsUp', text: 'x' });
  assert.deepEqual(problem('x'), { kind: 'problem', text: 'x' });
  assert.equal(TOAST_MS, 4000, 'a Done toast lasts 4 s');
  assert.equal(noticeExpires(done('a')), true, 'only Done passes on its own');
  assert.equal(noticeExpires(headsUp('a')), false, 'a Heads-up stays until acted on or dismissed');
  assert.equal(noticeExpires(problem('a')), false, 'a Problem stays until resolved');
});

test('screen readers hear Done as status and Problem as alert (#295)', () => {
  assert.equal(noticeRole('done'), 'status');
  assert.equal(noticeRole('headsUp'), 'status');
  assert.equal(noticeRole('problem'), 'alert');
});

test('a toast waits for an open sheet to close, never shows behind it (#295)', () => {
  assert.equal(toastShows(done('a'), false), true);
  assert.equal(toastShows(done('a'), true), false, 'fired during a sheet: shows after it closes');
  assert.equal(toastShows(problem('a'), false), false, 'a Problem is a card, not a toast');
  assert.equal(toastShows(headsUp('a'), false), false, 'a Heads-up is a card, not a toast');
  assert.equal(toastShows(null, false), false);
});

test('Today shows at most one Heads-up card: install, then backup, then the rest (#295, #307)', () => {
  assert.deepEqual(TODAY_CARD_ORDER, ['install', 'backup', 'message', 'limited', 'fresher']);
  assert.equal(todayCard({ install: true, backup: true, message: true, limited: true, fresher: true }), 'install');
  assert.equal(todayCard({ install: false, backup: true, limited: true }), 'backup');
  assert.equal(todayCard({ message: true, limited: true, fresher: true }), 'message');
  assert.equal(todayCard({ limited: true, fresher: true }), 'limited');
  assert.equal(todayCard({ fresher: true }), 'fresher');
  assert.equal(todayCard({}), null, 'nothing to say: no card');
  // Every subset of candidates yields exactly one card, the first present in order.
  for (let mask = 1; mask < 1 << TODAY_CARD_ORDER.length; mask += 1) {
    const present = Object.fromEntries(TODAY_CARD_ORDER.map((key, i) => [key, (mask >> i) & 1 ? true : false]));
    const first = TODAY_CARD_ORDER.find((key) => present[key]);
    assert.equal(todayCard(present), first);
  }
});

/**
 * Every place App raises a message, with its kind. A new `setNotice(...)` that is not built by
 * `done`, `headsUp` or `problem` (or is missing from this list) fails here.
 */
const CALL_SITES: Array<[kind: 'done' | 'headsUp' | 'problem', starts: string]> = [
  ['problem', "'No movement in this workout can be done with that setup.'"],
  ['headsUp', "'Finish or discard the open session before skipping this one.'"],
  ['done', "'Session skipped. Skips earn no progression.'"],
  ['problem', "'That preview is out of date. Preview again to approve it.'"],
  ['problem', "'No movement in this workout can be done with that setup.'"],
  ['done', '`${minutes} min is now your default length.`'],
  ['done', "'Back to your program.'"],
  ['done', 'CHANGED_FOR_TODAY'],
  ['done', "'Back to your gear.'"],
  ['done', 'CHANGED_FOR_TODAY'],
  ['headsUp', "'Finish or discard the open session before switching days.'"],
  ['done', '`${option.name} is up.'],
  // #296: a picked day from Switch, and Switch's "Or train something else" while a session runs.
  ['headsUp', "'Finish or discard the open session before switching days.'"],
  ['done', 'CHANGED_FOR_TODAY'],
  ['done', 'message'],
  ['headsUp', 'text'],
  ['done', 'text'],
  // #327: a weight more than 10% over last time, held on its set; then Apply to all's carry.
  ['headsUp', 'text'],
  ['done', 'text'],
  // #372: a note saved or removed from the exercise menu.
  ['done', "after === undefined ? 'Note removed.'"],
  ['headsUp', 'liveCarry.note'],
  // #372: the no-sets toast says when notes went with the session.
  ['done', 'noSetsNotice('],
  ['headsUp', 'progress.skipped > 0'],
  ['done', "'Workout saved.'"],
  ['done', '`${slot.name} skipped'],
  ['done', "'Session discarded. Nothing was added to history.'"],
  ['problem', 'refused'],
  ['done', "'Workout deleted.'"],
  ['problem', "'Backup not saved, so nothing was recorded. Try again.'"],
  ['done', "'Backup downloaded.'"],
  ['done', 'message'],
  ['problem', 'message'],
  ['problem', "'The file could not be read. Nothing changed.'"],
  ['problem', '`Restore rejected: ${parsed.error}`'],
  ['done', '`Restored ${merged.summary.newWorkouts}'],
  // #372: the swap toast says when the swapped-out exercise's note went with it.
  ['done', 'swapNotice(target.name'],
  ['done', 'removed'],
  ['done', 'message'],
  ['done', '`${name} is back in today\'s session.`'],
  ['done', '`Restored ${summary.newWorkouts} workouts.`'],
  ['done', "'Started with empty data.'"],
  ['done', "'Saved for future workouts. Logged sets are unchanged.'"],
];

test('every message App raises is exactly one kind, enumerated here (#295)', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const all: Array<[string, string]> = [];
  for (const match of source.matchAll(/setNotice\(/g)) {
    const rest = source.slice((match.index ?? 0) + match[0].length);
    if (rest.startsWith('null)') || rest.startsWith('dropSaveClaim)')) continue; // (#351) clears, raises nothing
    const built = rest.match(/^\s*(done|headsUp|problem)\(\s*([^\n]*)/);
    assert.ok(built, `unclassified message: setNotice(${rest.slice(0, 80)}`);
    all.push([built[1], built[2]]);
  }
  assert.equal(all.length, CALL_SITES.length, `call sites: ${all.map(([k, t]) => `${k} ${t.slice(0, 40)}`).join('\n')}`);
  all.forEach(([kind, text], i) => {
    const [wantKind, starts] = CALL_SITES[i];
    assert.ok(text.startsWith(starts), `site ${i + 1}: ${text.slice(0, 60)} should start ${starts}`);
    assert.equal(kind, wantKind, `site ${i + 1} (${starts}) is ${wantKind}`);
  });
});

test('the beige alert style is gone (#295)', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /#fbf0dd|#ecd6ae/, 'no beige banner fill or border');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /className="banner"/);
});

test('fixed messages are at most 60 characters (#295 copy deck)', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const literals = [...app.matchAll(/(?:done|headsUp|problem)\(\s*'([^']*)'/g)].map((m) => m[1]);
  assert.ok(literals.length > 10);
  for (const text of literals) assert.ok(text.length <= 60, `${text.length}: ${text}`);
});
