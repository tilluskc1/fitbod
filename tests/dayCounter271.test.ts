import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dayCounter } from '../src/lib/sequence.ts';

// #271: "Slot" is our internal word; lifters see "Day N of M this week". The rendered Today, Plan and
// Train text is checked in the browser by scripts/e2e/day-counter.mjs.
test('the counter speaks in days, and a single-day plan shows none', () => {
  assert.equal(dayCounter(0, 4), 'Day 1 of 4');
  assert.equal(dayCounter(4, 5), 'Day 5 of 5');
  // Plan position, not the calendar: never a "this week" claim (the Weekly goal card counts weeks).
  assert.doesNotMatch(dayCounter(1, 4) ?? '', /week/i);
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
  // Line by line, so a quote or backtick in one place can never pair with one far away.
  // A word, not code: `slot.name`, `slot?.index`, `slot:` or `slot-row` are identifiers and keys.
  const word = /(?<![.\w-])slots?(?![?.:(\w-])/i;
  const prose = (text: string) => (word.test(text) && /\s/.test(text.trim())) || /(?<![.\w-])Slots?(?![?.:(\w-])/.test(text);
  for (const file of files) {
    let inComment = false;
    readFileSync(file, 'utf8').split('\n').forEach((raw, index) => {
      let line = raw;
      if (inComment) { if (!line.includes('*/')) return; line = line.slice(line.indexOf('*/') + 2); inComment = false; }
      line = line.replace(/\/\*.*?\*\//g, '');
      if (line.includes('/*')) { inComment = true; line = line.slice(0, line.indexOf('/*')); }
      line = line.replace(/(^|\s)\/\/.*$/, '');
      const pieces = [...line.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`|\}([^<>{}=;()\[\],]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
      // JSX text on a line of its own: words only, no code punctuation.
      if (/^\s*[A-Za-z][^<>{}=;()\[\]`'"]*$/.test(line) && /\s\S/.test(line.trim())) pieces.push(line);
      for (const piece of pieces) {
        const text = piece.replace(/\$\{[^{}]*\}/g, '');
        if (prose(text)) assert.fail(`${file}:${index + 1}: user-facing "${text.trim()}"`);
      }
    });
  }
});
