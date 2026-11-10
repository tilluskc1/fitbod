import assert from 'node:assert/strict';
import test from 'node:test';
import { EMPTY_STATE, mergeImport } from '../src/lib/storage.ts';
import { validateState } from '../src/lib/validate.ts';
import type { AppState } from '../src/types.ts';

// #307 The Today install note's dismiss record: one optional field, like lastBackupAt (#225).
const with_ = (installNoteDismissals?: unknown) =>
  ({ ...EMPTY_STATE, ...(installNoteDismissals === undefined ? {} : { installNoteDismissals }) }) as AppState;

test('#307 validate: absent stays absent; up to two dates kept; anything else refused', () => {
  const none = validateState(with_());
  assert.ok(none.ok);
  assert.equal('installNoteDismissals' in none.state, false);
  const two = ['2026-11-01T09:00:00.000Z', '2026-11-09T09:00:00.000Z'];
  const ok = validateState(with_(two));
  assert.ok(ok.ok);
  assert.deepEqual(ok.state.installNoteDismissals, two);
  for (const bad of ['2026-11-01', [42], ['yesterday'], [...two, two[0]], null]) {
    const result = validateState(with_(bad));
    assert.equal(result.ok, false, `rejects ${JSON.stringify(bad)}`);
    if (!result.ok) assert.match(result.error, /state\.installNoteDismissals/);
  }
});

test('#307 a restore keeps this browser’s own dismissals, never the file’s', () => {
  const file = with_(['2026-10-01T09:00:00.000Z']);
  assert.equal('installNoteDismissals' in mergeImport(EMPTY_STATE, file).state, false);
  const local = with_(['2026-11-01T09:00:00.000Z', '2026-11-09T09:00:00.000Z']);
  assert.deepEqual(mergeImport(local, file).state.installNoteDismissals, local.installNoteDismissals);
});

test('#307 sheet renders three numbered steps with workouts, only the add step with none', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createServer } = await import('vite');
  const { installGuide } = await import('../src/lib/install.ts');
  const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { InstallSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const guide = installGuide({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1',
      touchPoints: 5,
      standalone: false,
    });
    const render = (workouts: number) =>
      plain(renderToStaticMarkup(createElement(InstallSheet, { guide, workouts, onBackup: async () => ({ ok: true, message: null }), onClose: () => {} })));
    const some = render(2);
    assert.match(some, /^Install on this phone Add Home Strength to your Home Screen\./);
    assert.match(some, /1 Back up your workouts\. The Home Screen app starts empty\. Back up now 2 Tap Share in the address bar/);
    assert.match(some, /3 Open the new app and tap Restore backup on the first screen\. Done$/);
    const none = render(0);
    assert.doesNotMatch(none, /Back up|Restore backup/);
    assert.match(none, /Tap Share in the address bar/);
  } finally {
    await server.close();
  }
});
