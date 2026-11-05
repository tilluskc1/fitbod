import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { dumbbellLoadsPatch, loadsInputText } from '../src/lib/units.ts';

const profile = (unit: 'kg' | 'lb', Dumbbell: number[] = []) => ({
  goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 3, equipment: ['Dumbbell'],
  support: ['Bench'], exclusions: [], loads: { Dumbbell }, unit,
}) as const;

test('an lb user typing 25, 35 in settings stores canonical kg', () => {
  assert.deepEqual(dumbbellLoadsPatch('25, 35', profile('lb')), { loads: { Dumbbell: [11.34, 15.876] } });
});

test('a kg user typing 10, 15 in settings stores them unchanged', () => {
  assert.deepEqual(dumbbellLoadsPatch('10, 15', profile('kg')), { loads: { Dumbbell: [10, 15] } });
});

test('stored kg loads display in the chosen unit without double conversion', () => {
  assert.equal(loadsInputText([11.34, 15.876], 'lb'), '25, 35');
  assert.equal(loadsInputText([11.34, 15.876], 'kg'), '11.34, 15.876');
  assert.equal(loadsInputText(undefined, 'lb'), '');
});

test('leaving the displayed loads untouched saves nothing, so kg never drifts', () => {
  const lb = profile('lb', [10, 22.5]);
  assert.equal(dumbbellLoadsPatch(loadsInputText(lb.loads.Dumbbell, 'lb'), lb), null);
  assert.equal(dumbbellLoadsPatch('', profile('kg')), null);
});

test('the settings sheet shows owned loads and their label in the chosen unit', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { SettingsSheet } = await server.ssrLoadModule('/src/screens/Sheets.tsx');
    const render = (p: ReturnType<typeof profile>) => renderToStaticMarkup(createElement(SettingsSheet, {
      profile: p, onChange: () => {}, onExport: () => {}, onRestore: () => {}, onClose: () => {}, storageNote: 'Saved',
    }));
    const lb = render(profile('lb', [11.34, 15.876]));
    assert.match(lb, /id="profile-loads"[^>]*value="25, 35"|value="25, 35"[^>]*id="profile-loads"/);
    assert.match(lb, /Dumbbells you own \(lb, per hand\)/);
    assert.match(lb, /placeholder="e\.g\. 15, 25, 35 lb"/);
    assert.doesNotMatch(lb, /\(kg, per hand\)/);
    const kg = render(profile('kg', [10, 15]));
    assert.match(kg, /value="10, 15"/);
    assert.match(kg, /Dumbbells you own \(kg, per hand\)/);
    assert.match(kg, /placeholder="e\.g\. 10, 15, 20 kg"/);
  } finally {
    await server.close();
  }
});
