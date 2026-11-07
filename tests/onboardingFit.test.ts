import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #222: step 1 fits a phone and Continue stays in reach on every step.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const rule = (selector: string) => { const at = css.indexOf(`${selector} {`); assert.ok(at >= 0, selector); return css.slice(at, css.indexOf('}', at)); };

test('goals sit two to a row with one-line descriptions', () => {
  const source = readFileSync(new URL('../src/components/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(source, /<span className="setup-label">Your goal<\/span>\s*<div className="option-list option-list--grid">/);
  for (const blurb of ['Moderate reps', 'Higher reps', 'Heavy compounds', 'Balanced']) assert.match(source, new RegExp(`blurb: '${blurb}'`));
  assert.match(rule('.option-list--grid'), /grid-template-columns: 1fr 1fr/);
});

test('Continue is pinned to the bottom of the onboarding scroller', () => {
  const actions = rule('.onboarding-actions');
  assert.match(actions, /position: sticky/);
  assert.match(actions, /bottom: 0/);
  assert.match(actions, /env\(safe-area-inset-bottom\)/);
});

test('onboarding starts at 45 minutes at a gym with the full gym floor (owner default, #222)', () => {
  const source = readFileSync(new URL('../src/components/Onboarding.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<number \| null>\(45\)/);
  assert.match(source, /useState<'gym' \| 'home' \| null>\('gym'\)/);
  assert.match(source, /useState<Equipment\[\]>\(\[\.\.\.EQUIPMENT_OPTIONS\]\)/);
});
