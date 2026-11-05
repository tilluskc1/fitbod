import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// node --test runs each test file in its own process, in parallel; several start a Vite
// server, so a shared dep cache races (ENOTEMPTY on node_modules/.vite/deps). Give each
// test process its own cache. Dev and build keep the default.
const testCacheDir = process.env.NODE_TEST_CONTEXT
  ? join(tmpdir(), `fitbod-vite-test-${process.pid}`)
  : undefined
if (testCacheDir) process.once('exit', () => rmSync(testCacheDir, { recursive: true, force: true }))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  cacheDir: testCacheDir,
})
