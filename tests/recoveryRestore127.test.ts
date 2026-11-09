import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').map((item) => item.trim()).includes(selector))
    .map(([, , body]) => body).join('\n');
const noop = () => {};

test('Recovery: Restore backup is a pill label around a visually hidden file input (#127)', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  let html: string;
  try {
    const { default: Recovery } = await server.ssrLoadModule('/src/components/Recovery.tsx');
    html = renderToStaticMarkup(createElement(Recovery, {
      error: 'Saved data is not valid JSON.', raw: '{not json', onDownload: noop, onRestore: noop, onStartFresh: noop,
    }));
  } finally { await server.close(); }
  const label = html.match(/<label class="([^"]*)"[^>]*>Restore backup(<input[^>]*>)<\/label>/);
  assert.ok(label, 'the label wraps its text and the file input, so it names the input for screen readers');
  const [, labelClass, input] = label;
  assert.match(labelClass, /\bsecondary\b/);
  assert.match(labelClass, /\brecovery-restore\b/);
  assert.match(input, /type="file"/);
  assert.match(input, /class="settings-row__file"/, 'the input uses the house hidden file input');
  assert.doesNotMatch(input, /\bhidden\b|tabindex="-1"|display/, 'still in the tab order');

  // Hidden but present: covers the pill, cannot paint or push the layout wider.
  const hidden = rule('.settings-row__file');
  for (const declaration of ['position: absolute', 'inset: 0', 'width: 100%', 'opacity: 0']) {
    assert.ok(hidden.includes(declaration), `.settings-row__file has ${declaration}`);
  }
  const pill = rule('.recovery-restore');
  for (const declaration of ['position: relative', 'white-space: nowrap']) {
    assert.ok(pill.includes(declaration), `.recovery-restore has ${declaration}`);
  }
  assert.match(rule('.recovery-restore:focus-within'), /outline: 2px solid var\(--focus\)/, 'keyboard focus shows on the pill');
});
