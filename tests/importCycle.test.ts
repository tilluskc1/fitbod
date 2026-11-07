import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #212: plan.ts and progression.ts imported each other. savedSetup lives in setup.ts so neither has to.
const importsOf = (file: string) => [...readFileSync(new URL(`../src/lib/${file}`, import.meta.url), 'utf8')
  .matchAll(/^import[^;]*?from '\.\/([\w.]+)'/gms)].map((match) => match[1]);

test('plan.ts does not import progression.ts, and setup.ts imports no lib module', () => {
  assert.ok(!importsOf('plan.ts').includes('progression.ts'), 'plan.ts imports progression.ts');
  assert.ok(importsOf('progression.ts').includes('plan.ts'), 'the guard would be pointless if progression stopped needing plan');
  assert.deepEqual(importsOf('setup.ts'), []);
});
