import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #214: installable on Android (manifest + icons) and iPhone (apple-touch-icon), cached offline.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url));
const pngSize = (path: string) => { const png = read(path); return [png.readUInt32BE(16), png.readUInt32BE(20)]; };

test('the manifest has what Android needs to offer Install app', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest').toString('utf8'));
  assert.equal(manifest.name, 'Home Strength');
  assert.ok(manifest.short_name.length <= 12, 'short name fits under a home-screen icon');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#e6f2f1');
  const sizes = manifest.icons.map((icon: { sizes: string; purpose: string; src: string }) => {
    assert.deepEqual(pngSize(`public${icon.src}`), icon.sizes.split('x').map(Number), icon.src);
    return `${icon.sizes}:${icon.purpose}`;
  });
  for (const need of ['192x192:any', '512x512:any', '512x512:maskable']) assert.ok(sizes.includes(need), need);
});

test('index.html links the manifest and the iPhone home-screen icon', () => {
  const html = read('index.html').toString('utf8');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon\.png" \/>/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  assert.deepEqual(pngSize('public/icons/apple-touch-icon.png'), [180, 180]);
});

test('the service worker caches the manifest and icons, and main asks to keep storage', () => {
  const sw = read('public/sw.js').toString('utf8');
  for (const path of ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) assert.ok(sw.includes(`'${path}'`), path);
  assert.match(read('src/main.tsx').toString('utf8'), /navigator\.storage\.persist\(\)/);
});
