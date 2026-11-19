// Splits the e2e scripts across parallel CI jobs (#385).
//
// Single source of truth: the `node scripts/e2e/X.mjs` entries in package.json's "e2e" script.
// A dev adds a script by appending `&& node scripts/e2e/new.mjs` there; this file picks it up.
//
//   node scripts/e2e/groups.mjs <n>   run group n's scripts in order, stop at the first failure
//   node scripts/e2e/groups.mjs list  print every group (for humans and the workflow log)
//
// It never builds: the CI job (or you, locally) runs `npm run build` first.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GROUP_COUNT = 3;

// Seconds per script on a CI runner (main 6f5acf7, run 44462775316). Only the slow ones matter;
// a script not listed here is "unknown" and goes to the lightest group at that moment.
export const WEIGHTS = {
  'notice-kinds': 295,
  'end-workout': 104,
  'install-note': 51,
  'inline-sets': 47,
  'plan-page': 34,
  feedback: 32,
  'howto-379': 24,
  'big-jump': 24,
  'progress-backup': 21,
  'catalog-additions': 21,
  supersets: 20,
  'planner-reach': 17,
  'my-gym': 17,
  'ramp-rows': 15,
  'notes-372': 12,
  'standalone-fit': 11,
  'name-start-over': 11,
  'later-369': 11,
  'switch-picks': 11,
  'second-workout': 10,
  'data-on-phone': 10,
  'weight-steps-371': 10,
};
export const DEFAULT_WEIGHT = 8;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Script names (no path, no .mjs) in the order package.json's "e2e" script runs them. */
export function parseScripts(e2eCommand) {
  return [...e2eCommand.matchAll(/node\s+scripts\/e2e\/([\w.-]+?)\.mjs/g)].map((m) => m[1]);
}

/** Returns GROUP_COUNT arrays. Known-weight scripts first (heaviest first, to the lightest group),
 *  then unknown ones in package order, so appending a script never moves an existing one. */
export function assignGroups(names, count = GROUP_COUNT) {
  const groups = Array.from({ length: count }, () => ({ load: 0, names: [] }));
  const lightest = () => groups.reduce((a, b) => (b.load < a.load ? b : a));
  const known = names
    .filter((n) => n in WEIGHTS)
    .sort((a, b) => WEIGHTS[b] - WEIGHTS[a] || names.indexOf(a) - names.indexOf(b));
  const unknown = names.filter((n) => !(n in WEIGHTS));
  for (const n of known) {
    const g = lightest();
    g.names.push(n);
    g.load += WEIGHTS[n];
  }
  for (const n of unknown) {
    const g = lightest();
    g.names.push(n);
    g.load += DEFAULT_WEIGHT;
  }
  // Run each group in package.json order, like the serial run.
  return groups.map((g) => g.names.sort((a, b) => names.indexOf(a) - names.indexOf(b)));
}

export function readScripts() {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return parseScripts(pkg.scripts.e2e);
}

function main() {
  const arg = process.argv[2];
  const groups = assignGroups(readScripts());
  if (arg === 'list') {
    groups.forEach((g, i) => console.log(`group ${i} (${g.length}): ${g.join(' ')}`));
    return;
  }
  const n = Number(arg);
  if (!Number.isInteger(n) || n < 0 || n >= GROUP_COUNT) {
    console.error(`usage: node scripts/e2e/groups.mjs <0..${GROUP_COUNT - 1}|list>`);
    process.exit(2);
  }
  const started = Date.now();
  console.log(`e2e group ${n}: ${groups[n].length} scripts`);
  for (const name of groups[n]) {
    const t = Date.now();
    console.log(`::group::${name}`);
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'e2e', `${name}.mjs`)], { stdio: 'inherit', cwd: root });
    console.log('::endgroup::');
    const secs = ((Date.now() - t) / 1000).toFixed(1);
    if (r.status !== 0) {
      console.error(`FAIL ${name} after ${secs}s (exit ${r.status ?? r.signal})`);
      process.exit(r.status || 1);
    }
    console.log(`ok ${name} ${secs}s`);
  }
  console.log(`e2e group ${n}: all ${groups[n].length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
