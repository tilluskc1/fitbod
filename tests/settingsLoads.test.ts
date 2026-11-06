import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { dumbbellLoadsPatch, loadsInputText, parseLoads } from '../src/lib/units.ts';

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

test('unit suffixes typed after loads are accepted, not dropped', () => {
  assert.deepEqual(parseLoads('25lb, 35 lb', 'lb'), [11.34, 15.876]);
  assert.deepEqual(parseLoads('10kg 15 KG, 20kgs', 'kg'), [10, 15, 20]);
  assert.deepEqual(dumbbellLoadsPatch('25lb, 35 lb', profile('lb')), { loads: { Dumbbell: [11.34, 15.876] } });
});

test('non-blank text with no valid load keeps the rack; blank still clears it', () => {
  const lb = profile('lb', [11.34, 15.876]);
  assert.equal(dumbbellLoadsPatch('abc', lb), null);
  assert.equal(dumbbellLoadsPatch('lb', lb), null);
  assert.deepEqual(dumbbellLoadsPatch('  ', lb), { loads: { Dumbbell: [] } });
});

test('loads entered in kg keep their exact kg when the list is edited in lb', () => {
  const lb = profile('lb', [10, 12.5]);
  const shown = loadsInputText(lb.loads.Dumbbell, 'lb');
  assert.deepEqual(dumbbellLoadsPatch(`${shown}, 40`, lb), { loads: { Dumbbell: [10, 12.5, 18.144] } });
  assert.deepEqual(dumbbellLoadsPatch(`${shown.split(', ')[0]}`, lb), { loads: { Dumbbell: [10] } }, 'removing one keeps the other exact');
});

test('a sheet focuses Close once on mount, not again on every parent re-render', () => {
  const source = readFileSync(new URL('../src/components/ui/Sheet.tsx', import.meta.url), 'utf8');
  const focusEffect = source.match(/useEffect\(\(\) => \{\s*closeRef\.current\?\.focus\(\);[\s\S]*?\}, (\[[^\]]*\])\);/);
  assert.ok(focusEffect, 'the Close-focus effect exists');
  assert.equal(focusEffect[1], '[]', 'it runs on mount only, so a save that re-creates onClose does not jump focus');
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
