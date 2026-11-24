import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { LIBRARY_SOURCE } from '../src/data/libraryFiles.ts';
import { ABOUT_CREDITS } from '../src/lib/about.ts';
import { SOURCE } from '../scripts/library/transform.mjs';

// #431 Sibling of credits254 (which covers public/): every file in src/data/ is either credited in
// CREDITS.md with four filled cells, or is the app's own work. The library row pins the import's commit,
// and the in-app credits name the library.
const root = new URL('..', import.meta.url).pathname;
const credits = readFileSync(join(root, 'CREDITS.md'), 'utf8');

/** Written for this app, no outside content. A new src/data file must land here or in CREDITS.md. */
const OWN_WORK = new Set(['src/data/exercises.ts', 'src/data/flagship.ts', 'src/data/gymItems.ts', 'src/data/library.ts']);

const rows = credits.split('\n').filter((line) => /^\|\s*`src\/data\//.test(line));
const credited = rows.map((row) => /^\|\s*`([^`]+)`/.exec(row)![1]);

test('#431 every src/data file is credited or own work', () => {
  const missing = readdirSync(join(root, 'src/data'))
    .map((name) => `src/data/${name}`)
    .filter((file) => !OWN_WORK.has(file) && !credited.includes(file));
  assert.deepEqual(missing, [], 'credit these in CREDITS.md, or add them to OWN_WORK if written for this app');
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 4, `four columns: ${row}`);
    assert.ok(cells.every(Boolean), `no empty cell: ${row}`);
  }
});

test('#431 the library row pins the same commit as the import', () => {
  assert.equal(LIBRARY_SOURCE.commit, SOURCE.commit);
  const row = credits.split('\n').find((line) => line.startsWith('| `public/library/`'));
  assert.ok(row, 'CREDITS.md has a public/library/ row');
  assert.ok(row.includes(SOURCE.commit), 'it names the pinned commit');
  assert.match(row, /Unlicense/);
});

test('#431 the in-app credits name the library', () => {
  assert.ok(ABOUT_CREDITS.includes('Exercise library text: free-exercise-db (public domain).'));
  assert.equal(ABOUT_CREDITS[0], 'Exercise photos: free-exercise-db (public domain).', 'existing lines keep their order');
});

test('#431 no AGPL or openGym text in the credits, src/data or the library files', () => {
  const texts = [
    credits,
    ABOUT_CREDITS.join('\n'),
    ...readdirSync(join(root, 'src/data')).map((name) => readFileSync(join(root, 'src/data', name), 'utf8')),
    ...readdirSync(join(root, 'public/library')).map((name) => readFileSync(join(root, 'public/library', name), 'utf8')),
  ];
  for (const text of texts) assert.doesNotMatch(text, /AGPL|Affero|opengym/i);
});
