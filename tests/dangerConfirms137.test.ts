import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const src = new URL('../src/', import.meta.url);
const sources = (readdirSync(src, { recursive: true }) as string[]).filter((file) => /\.tsx?$/.test(file));
const buttons = (html: string) => [...html.matchAll(/<button[^>]*class="([^"]+)"[^>]*>(.*?)<\/button>/g)]
  .map(([, cls, text]) => ({ cls, text: text.replace(/<[^>]+>/g, '').trim() }));

const withSheets = async (run: (mod: Record<string, (props: object) => unknown>) => void) => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    run(await server.ssrLoadModule('/src/screens/Sheets.tsx'));
  } finally {
    await server.close();
  }
};

test('no native confirm dialog anywhere in src (#137)', () => {
  for (const file of sources) {
    const text = readFileSync(new URL(file, src), 'utf8');
    assert.doesNotMatch(text, /\bconfirm\(/, `${file} opens a native confirm`);
  }
});

test('Remove from today is a danger action (#137)', () => {
  const sheets = readFileSync(new URL('screens/Sheets.tsx', src), 'utf8');
  assert.match(sheets, /className="danger" onClick=\{onRemoveToday\}/);
});

test("Don't recommend again confirms in danger; allowing it back stays primary (#137)", async () => {
  const { exclusionChange } = await import('../src/lib/preferences.ts');
  const profile = { exclusions: [] as string[], preferences: {} } as never;
  const exercise = { id: 'goblet-squat', name: 'Goblet squat' };
  await withSheets(({ ConfirmChange }) => {
    const render = (change: unknown) =>
      buttons(renderToStaticMarkup(createElement(ConfirmChange, { change, onConfirm: () => {}, onCancel: () => {} }) as never));
    assert.deepEqual(render(exclusionChange(profile, exercise, true)), [
      { cls: 'danger', text: 'Confirm' },
      { cls: 'secondary', text: 'Cancel' },
    ]);
    assert.equal(render(exclusionChange(profile, exercise, false))[0].cls, 'primary');
  });
});

test('ConfirmSheet is an in-app dialog: danger action first, cancel below (#137)', async () => {
  await withSheets(({ ConfirmSheet }) => {
    const html = renderToStaticMarkup(createElement(ConfirmSheet, {
      title: 'Delete this workout?',
      confirmLabel: 'Delete workout',
      cancelLabel: 'Keep workout',
      onConfirm: () => {},
      onCancel: () => {},
      children: 'This cannot be undone.',
    }) as never);
    assert.match(html, /role="dialog"/);
    assert.match(html, /Delete this workout\?/);
    assert.match(html, /This cannot be undone\./);
    assert.deepEqual(buttons(html).filter((button) => button.cls !== 'sheet-close'), [
      { cls: 'danger', text: 'Delete workout' },
      { cls: 'secondary', text: 'Keep workout' },
    ]);
  });
});

test('replacing an open session discards in danger, keep below (#137)', async () => {
  await withSheets(({ DiscardSessionSheet }) => {
    const html = renderToStaticMarkup(createElement(DiscardSessionSheet, {
      currentName: 'Full body A', nextName: 'Full body B', onDiscard: () => {}, onKeep: () => {}, onClose: () => {},
    }) as never);
    assert.deepEqual(buttons(html).filter((button) => button.cls !== 'sheet-close'), [
      { cls: 'danger', text: 'Discard and start Full body B' },
      { cls: 'secondary', text: 'Keep current workout' },
    ]);
  });
});

test('one button order: the action first, the way out below, Preview included (#137)', async () => {
  await withSheets(({ DaySheet }) => {
    const html = renderToStaticMarkup(createElement(DaySheet, {
      name: 'Full body A', minutes: 45, exercises: [], unit: 'kg', onStart: () => {}, onClose: () => {},
    }) as never);
    assert.deepEqual(buttons(html).filter((button) => button.cls !== 'sheet-close').map((button) => button.text), [
      'Start workout',
      'Close',
    ]);
  });
});
