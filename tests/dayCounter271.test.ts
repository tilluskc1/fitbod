import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dayCounter } from '../src/lib/sequence.ts';

// #271: "Slot" is our internal word; lifters see "Day N of M this week". The rendered Today, Plan and
// Train text is checked in the browser by scripts/e2e/day-counter.mjs.
test('the counter speaks in days, and a single-day plan shows none', () => {
  assert.equal(dayCounter(0, 4), 'Day 1 of 4 this week');
  assert.equal(dayCounter(4, 5), 'Day 5 of 5 this week');
  assert.equal(dayCounter(0, 1), undefined);
  assert.equal(dayCounter(0, 0), undefined);
});

test('no user-facing string in src says "slot"', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      // src/studio is the dev-only catalog studio, not in the production build (#230).
      if (statSync(path).isDirectory()) { if (name !== 'studio') walk(path); }
      else if (/\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  for (const file of files) {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/.*$/gm, '');
    // String literals and JSX text that read as words, not identifiers or class names.
    const literals = [...code.matchAll(/'([^'\n]*)'|`([^`]*)`|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const raw of literals) {
      let text = raw;
      while (/\$\{[^{}]*\}/.test(text)) text = text.replace(/\$\{[^{}]*\}/g, '');
      if (/\bslots?\b/i.test(text) && /\s/.test(text.trim())) assert.fail(`${file}: user-facing "${text.trim()}"`);
    }
  }
});
