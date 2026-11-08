import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EXERCISES } from '../src/data/exercises.ts';
import media from '../src/data/media.json' with { type: 'json' };

// #270: README and PRODUCT.md are what agents and reviewers read first, so their checkable facts are
// checked here. Update the docs and this test together.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readme = read('README.md');
const product = read('PRODUCT.md');

test('README and PRODUCT.md state the real exercise count', () => {
  const count = EXERCISES.length;
  assert.match(readme, new RegExp(`\\b${count} exercises\\b`), `README should say ${count} exercises`);
  assert.match(product, new RegExp(`\\b${count}-exercise catalog\\b`));
  assert.match(product, new RegExp(`for ${count} exercises\\b`));
  for (const doc of [readme, product]) {
    for (const [, n] of doc.matchAll(/\b(\d+)[ -]exercises?\b/g)) assert.equal(Number(n), count, `stale count ${n}`);
  }
});

test('README says every exercise has photographs only while that is true', () => {
  const missing = EXERCISES.filter((e) => !(media as Record<string, { frames: string[] }>)[e.id]?.frames?.length);
  assert.equal(missing.length, 0, `README claims every exercise has photos; missing: ${missing.map((e) => e.id)}`);
});

test('the docs name the shipped app and its units, and drop Phase 1 claims', () => {
  assert.match(readme, /^# Home Strength$/m);
  assert.match(readme, /lb by default, kg available/);
  for (const stale of [/Fitbod Clone/, /Kilograms only/, /does not change programming/, /\b41 (regression )?tests\b/]) {
    assert.doesNotMatch(readme, stale);
    assert.doesNotMatch(product, stale);
  }
});

test('README and PRODUCT.md agree on the backend: local-first now, cloud parked', () => {
  assert.match(readme, /No account and no server/);
  assert.match(product, /cloud track is parked, not dropped/);
  assert.doesNotMatch(product, /permanently/);
});
