// #251: one online visit must be enough to open offline. The build writes the emitted JS and CSS
// into dist/sw.js, and each deploy gets its own cache name so old assets are dropped.
// The browser check is scripts/e2e/offline-first-visit.mjs (npm run e2e).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { swBuildManifest } from '../vite.config.ts';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

function build(files: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'sw251-'));
  try {
    writeFileSync(join(dir, 'sw.js'), source);
    const plugin = swBuildManifest() as any;
    plugin.configResolved({ build: { outDir: dir } });
    plugin.writeBundle({}, Object.fromEntries(files.map((file) => [file, {}])));
    return readFileSync(join(dir, 'sw.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const buildId = (sw: string) => /const BUILD_ID = '([0-9a-f]+)';/.exec(sw)?.[1];

test('the built worker precaches every emitted JS and CSS file', () => {
  const sw = build(['assets/index-AAA.js', 'assets/index-BBB.css', 'assets/lazy-CCC.js', 'index.html']);
  assert.match(sw, /const BUILD_ASSETS = \["\/assets\/index-AAA\.js","\/assets\/index-BBB\.css","\/assets\/lazy-CCC\.js"\];/);
  assert.match(sw, /\.\.\.BUILD_ASSETS,/);
  assert.ok(!sw.includes('index.html"'), 'html is not a bundle asset');
});

test('a new deploy gets a new cache name, the same deploy keeps it', () => {
  const a = buildId(build(['assets/index-AAA.js', 'assets/index-BBB.css']));
  const again = buildId(build(['assets/index-BBB.css', 'assets/index-AAA.js']));
  const b = buildId(build(['assets/index-ZZZ.js', 'assets/index-BBB.css']));
  assert.ok(a && b);
  assert.equal(a, again);
  assert.notEqual(a, b);
});

test('old caches are deleted on activate and lookups ignore Vary', () => {
  assert.match(source, /key\.startsWith\('fitbod-clone-'\) && key !== CACHE/);
  assert.match(source, /const CACHE = `fitbod-clone-shell-v6-\$\{BUILD_ID\}`/);
  assert.match(source, /caches\.match\(request, \{ ignoreVary: true \}\)/);
});

test('the build fails loudly if the worker markers go missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sw251-'));
  try {
    writeFileSync(join(dir, 'sw.js'), '// no markers');
    const plugin = swBuildManifest() as any;
    plugin.configResolved({ build: { outDir: dir } });
    assert.throws(() => plugin.writeBundle({}, { 'assets/a.js': {} }), /markers not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
