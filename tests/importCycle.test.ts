import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #212: plan.ts and progression.ts imported each other. savedSetup lives in setup.ts so neither has to.
// Counts every runtime edge: import and export-from, either quote, with or without ".ts".
const importsOf = (file: string) => [...readFileSync(new URL(`../src/lib/${file}`, import.meta.url), 'utf8')
  .matchAll(/^(import|export)(?!\s+type\b)[^;]*?\sfrom\s+['"]\.\/([\w.]+?)(?:\.ts)?['"]/gms)]
  .map((match) => `${match[2]}.ts`);

test('plan.ts does not import progression.ts, and setup.ts imports no lib module', () => {
  assert.ok(!importsOf('plan.ts').includes('progression.ts'), 'plan.ts imports progression.ts');
  assert.deepEqual(importsOf('setup.ts'), []);
});

test('the guard counts export-from and extensionless paths as edges', () => {
  // progression.ts re-exports savedSetup with an export-from; the guard must see that edge.
  assert.ok(importsOf('progression.ts').includes('setup.ts'));
});
