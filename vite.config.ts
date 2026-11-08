import { createHash } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// node --test runs each test file in its own process, in parallel; several start a Vite
// server, so a shared dep cache races (ENOTEMPTY on node_modules/.vite/deps). Give each
// test process its own cache. Dev and build keep the default.
const testCacheDir = process.env.NODE_TEST_CONTEXT
  ? join(tmpdir(), `fitbod-vite-test-${process.pid}`)
  : undefined
if (testCacheDir) process.once('exit', () => rmSync(testCacheDir, { recursive: true, force: true }))

/**
 * #251: write the emitted JS and CSS into dist/sw.js so the worker precaches them on install,
 * and stamp a build id from their hashed names so each deploy installs a fresh cache.
 */
export function swBuildManifest(): Plugin {
  let outDir = 'dist'
  return {
    name: 'sw-build-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    writeBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => /\.(js|css)$/.test(file))
        .sort()
        .map((file) => `/${file}`)
      const id = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 10)
      const path = join(outDir, 'sw.js')
      const source = readFileSync(path, 'utf8')
      const out = source
        .replace("const BUILD_ID = 'dev';", `const BUILD_ID = '${id}';`)
        .replace('const BUILD_ASSETS = [];', `const BUILD_ASSETS = ${JSON.stringify(assets)};`)
      if (out === source || assets.length === 0) throw new Error('sw-build-manifest: sw.js markers not found')
      writeFileSync(path, out)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swBuildManifest()],
  cacheDir: testCacheDir,
})
