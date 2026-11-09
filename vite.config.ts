import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
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
 * and stamp a build id from their hashed names plus every public file's bytes, so any deploy
 * (code or public/ only) installs a fresh shell cache.
 */
function publicFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (relative(dir, path) !== 'sw.js') out.push(path)
    }
  }
  try { walk(dir) } catch { /* no public dir */ }
  return out
}

export function swBuildManifest(): Plugin {
  let outDir = 'dist'
  let publicDir = ''
  return {
    name: 'sw-build-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
      publicDir = config.publicDir
    },
    writeBundle(_options, bundle) {
      const assets = Object.keys(bundle)
        .filter((file) => /\.(js|css)$/.test(file))
        .sort()
        .map((file) => `/${file}`)
      const hash = createHash('sha256').update(assets.join('\n'))
      for (const file of publicDir ? publicFiles(publicDir) : []) hash.update(relative(publicDir, file)).update(readFileSync(file))
      const id = hash.digest('hex').slice(0, 10)
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
