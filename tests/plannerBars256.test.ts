import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #256: while the planner is open its own bar replaces the dock and the tab bar. The browser proof
// (reach and tap target at 390x844, 360x780, 390x650, reminder on/off, keyboard open) is
// scripts/e2e/planner-reach.mjs.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const css = read('src/index.css');
const rule = (selector: string) => { const at = css.indexOf(`${selector} {`); assert.ok(at >= 0, selector); return css.slice(at, css.indexOf('}', at)); };

test('the tab bar steps aside while the planner is open on Today', () => {
  assert.match(read('src/App.tsx'), /\{!\(tab === 'today' && composing && !current\) && <TabBar/);
  assert.match(read('src/screens/TodayScreen.tsx'), /className="flow-dock" hidden=\{composing && !current\}/);
});

test("every planner step and the summary keep their actions in the pinned bar", () => {
  const talk = read('src/components/TodayTalk.tsx');
  assert.equal(talk.split('<div className="tt-bar">').length - 1, 2);
  const bar = rule('.tt-bar');
  assert.match(bar, /position: sticky/);
  assert.match(bar, /bottom: 0/);
  assert.match(bar, /env\(safe-area-inset-bottom/);
  assert.match(rule('.tt-say'), /scroll-margin-bottom: 150px/);
});

test('the entry comes before the backup note so the reminder cannot push it under the dock', () => {
  const today = read('src/screens/TodayScreen.tsx');
  assert.ok(today.indexOf('{!current && composer}') < today.indexOf('{backup && onBackup && !current'));
});
