// (#431) Build-time guard for the exercise library (runs first in `npm run build`). Fails the build when
// a committed library file carries media (see scripts/library/guard.mjs), its name no longer matches its
// content hash, an id is not a `lib-f-` id or takes a built-in's id, or public/library/ holds anything
// besides the two files src/data/libraryFiles.ts names.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardRow } from './library/guard.mjs';

/** Every problem with the library files under `root`; empty when the build may go on. */
export function checkLibrary(root, builtInIds = []) {
  const problems = [];
  const names = readFileSync(join(root, 'src/data/libraryFiles.ts'), 'utf8');
  const files = {
    index: /index: '\/library\/(index\.[0-9a-f]{10}\.json)'/.exec(names)?.[1],
    text: /text: '\/library\/(text\.[0-9a-f]{10}\.json)'/.exec(names)?.[1],
  };
  if (!files.index || !files.text) return ['src/data/libraryFiles.ts does not name an index and a text file'];
  const dir = join(root, 'public/library');
  const extra = existsSync(dir) ? readdirSync(dir).filter((name) => name !== files.index && name !== files.text) : [];
  if (extra.length) problems.push(`public/library/ holds files no build reads: ${extra.join(', ')}`);
  const read = (name) => {
    const path = join(dir, name);
    if (!existsSync(path)) { problems.push(`public/library/${name} is missing`); return null; }
    const body = readFileSync(path, 'utf8');
    if (createHash('sha256').update(body).digest('hex').slice(0, 10) !== name.split('.')[1]) problems.push(`${name}: content does not match its hash`);
    return JSON.parse(body);
  };
  const index = read(files.index);
  const text = read(files.text);
  if (!index || !text) return problems;
  const builtIns = new Set(builtInIds);
  const ids = new Set();
  for (const row of index.rows ?? []) {
    const problem = guardRow(row);
    if (problem) problems.push(`${row.id}: ${problem}`);
    if (typeof row.id !== 'string' || !/^lib-f-[A-Za-z0-9_-]+$/.test(row.id)) problems.push(`${row.id}: not a lib-f- id`);
    if (builtIns.has(row.id)) problems.push(`${row.id}: takes a built-in id`);
    if (ids.has(row.id)) problems.push(`${row.id}: listed twice`);
    ids.add(row.id);
  }
  const linkProblem = guardRow(index.links ?? {});
  if (linkProblem) problems.push(`links: ${linkProblem}`);
  for (const [id, steps] of Object.entries(text.text ?? {})) {
    const problem = guardRow(steps);
    if (problem) problems.push(`${id} instructions: ${problem}`);
    if (!ids.has(id)) problems.push(`${id}: instructions for a row the index does not list`);
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { EXERCISES } = await import('../src/data/exercises.ts');
  const problems = checkLibrary(root, EXERCISES.map((exercise) => exercise.id));
  if (problems.length) {
    console.error(`Exercise library check failed (#431):\n${problems.slice(0, 20).join('\n')}`);
    process.exit(1);
  }
}
