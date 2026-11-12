import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

// #254 CREDITS.md covers everything in public/. A path ending in "/" covers its whole folder; any
// other entry covers that one file. A new file with no entry fails, and so does a stale entry.
const root = new URL('..', import.meta.url).pathname;
const credits = readFileSync(join(root, 'CREDITS.md'), 'utf8');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

const entries = [...credits.matchAll(/^\|\s*`(public\/[^`]+)`/gm)].map((match) => match[1]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [relative(root, path).split('\\').join('/')];
  });
}

test('#254 every file in public/ has a CREDITS.md entry', () => {
  assert.ok(entries.length > 0, 'CREDITS.md has table rows');
  const missing = files(join(root, 'public')).filter(
    (file) => !entries.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry)),
  );
  assert.deepEqual(missing, [], 'add these to CREDITS.md with source and licence, or "not recorded"');
});

test('#254 every CREDITS.md entry names a path that exists, once', () => {
  for (const entry of entries) assert.ok(existsSync(join(root, entry)), `${entry} is in CREDITS.md but not in the repo`);
  assert.equal(new Set(entries).size, entries.length, 'no path listed twice');
});

test('#254 no entry leaves its source or licence blank', () => {
  for (const row of credits.split('\n').filter((line) => /^\|\s*`public\//.test(line))) {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, 4, `four columns: ${row}`);
    assert.ok(cells.every(Boolean), `no empty cell: ${row}`);
  }
});

test('#254 README provenance links CREDITS.md and no longer claims no third-party assets', () => {
  const section = readme.slice(readme.indexOf('## Provenance'), readme.indexOf('\n## ', readme.indexOf('## Provenance') + 1));
  assert.match(section, /\[CREDITS\.md\]\(CREDITS\.md\)/);
  assert.doesNotMatch(section, /No\s+third-party app code or assets/);
});
