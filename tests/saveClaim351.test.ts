import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { claimsSave, done, dropSaveClaim, headsUp, problem } from '../src/lib/notices.ts';

test('a Done that says something was saved is a save claim (#351)', () => {
  assert.equal(claimsSave(done('Workout saved.')), true);
  assert.equal(claimsSave(done('Saved for future workouts. Logged sets are unchanged.')), true);
  assert.equal(claimsSave(done('No sets logged, so nothing was saved.')), false);
  assert.equal(claimsSave(done('Backup downloaded.')), false);
  assert.equal(claimsSave(done('Restored 2 workouts.')), false);
  assert.equal(claimsSave(headsUp('Workout saved.')), false);
  assert.equal(claimsSave(problem('Workout saved.')), false);
  assert.equal(claimsSave(null), false);
  assert.equal(dropSaveClaim(done('Workout saved.')), null);
  const kept = done('Backup downloaded.');
  assert.equal(dropSaveClaim(kept), kept);
});

test('lesson 30: every Done App raises that says "saved" is a save claim or says nothing was saved (#351)', () => {
  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // (#372) Texts a Done picks between (a ternary) and the toast builders in notes.ts count too.
  const notes = readFileSync(new URL('../src/lib/notes.ts', import.meta.url), 'utf8');
  const lines = [
    ...source.split('\n').filter((line) => line.includes('setNotice(done(')),
    ...notes.split('\n').filter((line) => /^\s*return `/.test(line)),
  ];
  const texts = lines.flatMap((line) => [...line.matchAll(/'([^']*)'|`([^`$]*)/g)].map((m) => m[1] ?? m[2]))
    .filter((t) => /saved/i.test(t));
  assert.ok(texts.length >= 3, `found ${texts.join(' | ')}`);
  for (const text of texts) {
    if (/nothing was saved/.test(text)) assert.equal(claimsSave(done(text)), false, text);
    else assert.equal(claimsSave(done(text)), true, `${text} says it saved but is not a save claim`);
  }
});
