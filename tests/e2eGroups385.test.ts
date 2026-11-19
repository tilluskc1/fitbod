import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
// @ts-expect-error plain .mjs, no types
import { assignGroups, GROUP_COUNT, parseScripts, readScripts, WEIGHTS } from '../scripts/e2e/groups.mjs';

// #385: CI runs the e2e scripts as 3 parallel jobs. package.json's "e2e" script stays the only list.

test('every e2e script in package.json lands in exactly one group, and the file exists', () => {
  const names: string[] = readScripts();
  assert.ok(names.length > 10);
  assert.equal(new Set(names).size, names.length, 'a script is listed twice in package.json');
  const groups: string[][] = assignGroups(names);
  assert.equal(groups.length, GROUP_COUNT);
  assert.deepEqual([...groups.flat()].sort(), [...names].sort());
  for (const n of names) assert.ok(existsSync(`scripts/e2e/${n}.mjs`), `${n}.mjs is missing`);
  for (const g of groups) assert.ok(g.length > 0, 'an empty group');
});

test('a script appended to the e2e command is picked up and assigned once', () => {
  const cmd = 'npm run build && node scripts/e2e/a.mjs && node scripts/e2e/notice-kinds.mjs && node scripts/e2e/brand-new.mjs';
  const names: string[] = parseScripts(cmd);
  assert.deepEqual(names, ['a', 'notice-kinds', 'brand-new']);
  const groups: string[][] = assignGroups(names);
  assert.equal(groups.flat().filter((n) => n === 'brand-new').length, 1);
  assert.equal(groups.flat().length, 3);
});

test('adding an unknown script never moves a known one, and goes to a light group', () => {
  const before: string[] = readScripts();
  const a: string[][] = assignGroups(before);
  const b: string[][] = assignGroups([...before, 'zz-new-script']);
  for (const [i, g] of a.entries()) {
    assert.deepEqual(
      b[i].filter((n) => n !== 'zz-new-script'),
      g,
    );
  }
  const loads = a.map((g) => g.reduce((s, n) => s + (WEIGHTS[n] ?? 8), 0));
  const target = b.findIndex((g) => g.includes('zz-new-script'));
  assert.equal(loads[target], Math.min(...loads));
});

test('the weighted groups are balanced: none carries much more than the slowest script', () => {
  const groups: string[][] = assignGroups(readScripts());
  const loads = groups.map((g) => g.reduce((s, n) => s + (WEIGHTS[n] ?? 8), 0));
  assert.ok(Math.max(...loads) <= 330, `group loads ${loads.join('/')}`);
});
