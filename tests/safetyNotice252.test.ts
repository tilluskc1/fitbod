import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { PAIN_CHECK, SAFETY_NOTICE } from '../src/lib/safety.ts';

// #252: every new user sees the safety line before a first workout, existing users find it in
// Settings, and the pain stop says to get it checked. The browser check is the screenshot pass.
const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('the wording is the product default', () => {
  assert.equal(SAFETY_NOTICE, 'Strength training carries risk. Start light. Stop if something hurts, and check with a doctor first if you have an injury or a health condition.');
  assert.equal(PAIN_CHECK, 'Stop and get it checked by a doctor or physio before training it.');
});

test('onboarding shows the notice on the last step, before Build my plan', () => {
  const onboarding = src('components/Onboarding.tsx');
  // Inside the sticky actions bar, so no path (At home adds many chips) can push it below the fold.
  // The browser proof is scripts/e2e/safety-notice.mjs.
  const bar = onboarding.indexOf('<div className={`onboarding-actions');
  const notice = onboarding.indexOf('{SAFETY_NOTICE}');
  assert.ok(bar > 0 && notice > bar, 'notice sits in the sticky actions bar');
  assert.match(onboarding.slice(bar, notice), /step === 3/);
  assert.ok(notice < onboarding.lastIndexOf('Build my plan'), 'notice comes before the button');
});

test('Settings has an About group with the notice, no pop-up', () => {
  const sheets = src('screens/Sheets.tsx');
  assert.match(sheets, /id="settings-about">\s*About\s*<\/h3>\s*<div className="settings-card">\s*<p className="settings-row settings-row__note">\{SAFETY_NOTICE\}<\/p>/);
});

test('the pain stop adds the professional check, once (role=alert announces it)', () => {
  const talk = src('components/TodayTalk.tsx');
  assert.match(talk, /<b>You mentioned pain\.<\/b> I can work around soreness, not pain\. \{PAIN_CHECK\}/);
  assert.equal(talk.split('{PAIN_CHECK}').length - 1, 1);
});

test('no screen claims a diagnosis or that it is safe to train through pain', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && name !== 'safety.ts') files.push(path);
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  for (const file of files) {
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const claim of ['safe to train', 'train through pain', 'diagnos']) {
      assert.ok(!text.includes(claim), `${file} says "${claim}"`);
    }
  }
});
