import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { EXERCISES, MUSCLE_GROUPS } from '../src/data/exercises.ts';
import { STUDIO_KITS, catalogCard, catalogFlags, coverage, musclesWithCounts } from '../src/lib/catalog.ts';

// #230: a dev-only studio shows every exercise, its frames and the gaps in one place.

const publicFile = (path: string) => existsSync(new URL(`../public${path}`, import.meta.url));

test('the left rail lists every muscle group with its exercise count, summing to the catalog', () => {
  const rail = musclesWithCounts();
  assert.deepEqual(rail.map((row) => row.muscle), [...MUSCLE_GROUPS]);
  assert.equal(rail.reduce((sum, row) => sum + row.count, 0), EXERCISES.length);
  assert.ok(rail.every((row) => row.count === EXERCISES.filter((exercise) => exercise.muscles[0] === row.muscle).length));
});

test('a card carries what curation needs: frames, muscles, gear, pattern, role, rep range, swaps, video slot', () => {
  const card = catalogCard('barbell-bench-press');
  assert.equal(card.name, 'Barbell Bench Press');
  assert.equal(card.frames.length, 2);
  assert.deepEqual(card.muscles, ['Chest', 'Triceps', 'Shoulders']);
  assert.equal(card.equipment, 'Barbell');
  assert.deepEqual(card.needs, ['barbell', 'bench']);
  assert.equal(card.pattern, 'horizontal_push');
  assert.equal(card.role, 'Lead');
  assert.match(card.repRange, /^\d+–\d+$/);
  // What the app prescribes (#230 review): a lead takes heavy ranges; the program's own range wins.
  assert.deepEqual(card.leadRanges, { muscle: '4–6', strength: '3–5', beginner: '8–10' });
  assert.deepEqual(catalogCard('dumbbell-bench-press').leadRanges, { muscle: '6–10', strength: '5–8', beginner: '8–10' });
  assert.equal(catalogCard('plank').repRange, '45 s hold');
  assert.equal(catalogCard('goblet-squat').repRange, '8–10');
  assert.equal(catalogCard('lateral-raise').leadRanges, null);
  assert.ok(card.swaps.length > 0 && card.swaps.every((swap) => swap !== card.name));
  assert.equal(card.video, null, 'no clips yet: the slot is empty');
  assert.equal(catalogCard('lateral-raise').role, 'Isolation');
  assert.equal(catalogCard('plank').role, 'Core');
});

test('coverage: muscle by kit lists what each kit can train, and the gym covers every muscle', () => {
  const grid = coverage('muscle');
  assert.deepEqual(grid.rows, [...MUSCLE_GROUPS]);
  assert.deepEqual(grid.kits, STUDIO_KITS.map((kit) => kit.id));
  for (const muscle of MUSCLE_GROUPS) assert.ok(grid.cell(muscle, 'gym').length > 0, `gym trains ${muscle}`);
  // A bodyweight kit cannot pull without a bar: the gap the grid exists to show.
  assert.deepEqual(grid.cell('Back', 'bodyweight'), []);
  assert.ok(grid.cell('Chest', 'bodyweight').includes('Push-Up'));
});

test('coverage: pattern by kit shows no vertical pull without a bar', () => {
  const grid = coverage('pattern');
  assert.ok(grid.rows.includes('vertical_pull'));
  assert.deepEqual(grid.cell('vertical_pull', 'bodyweight'), []);
  assert.ok(grid.cell('vertical_pull', 'gym').length > 0);
});

test('flags: media and catalog agree today, a broken frame and a missing entry are caught', () => {
  assert.deepEqual(catalogFlags({ exists: publicFile }), []);
  const flags = catalogFlags({
    exists: (path) => !path.includes('push-up/1'),
    media: { 'push-up': { frames: ['/exercises/push-up/0.jpg', '/exercises/push-up/1.jpg'] }, 'old-move': { frames: [] } },
  });
  assert.ok(flags.some((flag) => flag.kind === 'broken-frame' && flag.exerciseId === 'push-up'));
  assert.ok(flags.some((flag) => flag.kind === 'no-exercise' && flag.exerciseId === 'old-move'));
  assert.ok(flags.some((flag) => flag.kind === 'no-media' && flag.exerciseId === 'barbell-bench-press'));
});

test('the studio is a dev entry the production build never ships', () => {
  const html = readFileSync(new URL('../studio.html', import.meta.url), 'utf8');
  assert.match(html, /src="\/src\/studio\/main\.tsx"/);
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(index, /studio/);
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /studio/, 'not added as a build input');
});
