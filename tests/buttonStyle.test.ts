import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) =>
  ({ selectors: selectors.split(',').map((item) => item.trim()), body }));
const rules = (selector: RegExp) =>
  blocks.filter((block) => block.selectors.some((item) => selector.test(item))).map((block) => block.body);

test('one primary action style: .primary is the .pill-primary rule, with no override changing its shape (#118)', () => {
  assert.match(css, /\.primary,\s*\.pill-primary \{[^}]*border-radius: 999px;[^}]*background: var\(--btn\);/);
  const overrides = blocks.filter((block) => block.selectors.some((item) => /\.primary$/.test(item))
    && !block.selectors.includes('.pill-primary'));
  for (const { body } of overrides) {
    assert.doesNotMatch(body, /border-radius|min-height|font-size|background|box-shadow/, `override: ${body.trim()}`);
  }
  assert.doesNotMatch(css, /\.btn-primary/);
});

test('a selected chip, segment or unit reads as the filled green of a primary pill', () => {
  for (const selector of [/^\.chip\.on$/, /^\.glass-scope \.chip\.on$/, /^\.segmented button\.on$/, /^\.unit-toggle button\.on$/, /^\.feedback-btns button\.on$/]) {
    const bodies = rules(selector);
    assert.ok(bodies.length > 0, `${selector} is styled`);
    assert.ok(bodies.some((body) => /background: var\(--(primary|lime)\)/.test(body)), `${selector} is filled green`);
  }
  for (const selector of [/^\.segmented$/, /^\.segmented button$/, /^\.unit-toggle$/, /^\.unit-toggle button$/]) {
    assert.ok(rules(selector).some((body) => /border-radius: 999px/.test(body)), `${selector} is a pill`);
  }
});

test('selected chips stay readable: day-chip label, and the reduced-transparency hover cannot unfill them', () => {
  assert.ok(rules(/^\.day-chip\.selected span$/).some((body) => /color: var\(--on-primary\)/.test(body)));
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'));
  const hover = reduced.indexOf('.glass-scope .chip:hover');
  const refill = reduced.search(/\.glass-scope \.chip\.on,\s*\.glass-scope \.day-chip\.selected \{\s*background: var\(--primary\);/);
  assert.ok(hover >= 0 && refill > hover, 'the selected fill comes after the hover reset');
});

test('secondary and danger buttons are pills too, and nothing puts the 13 px corner back (#125)', () => {
  for (const selector of [/^\.secondary$/, /^\.danger$/]) {
    const bodies = rules(selector);
    assert.ok(bodies.length > 0, `${selector} is styled`);
    assert.ok(bodies.some((body) => /border-radius: 999px/.test(body)), `${selector} is a pill`);
  }
  // Any rule that names either class, with a state or modifier too; any corner property.
  const overrides = blocks.filter((block) => block.selectors.some((item) => /\.(secondary|danger)\b/.test(item)));
  for (const { body } of overrides) assert.doesNotMatch(body, /radius\s*:(?!\s*999px)/, `override: ${body.trim()}`);
  // Clear of the rounded ends, like .pill-primary.
  for (const selector of [/^\.secondary$/, /^\.danger$/]) assert.ok(rules(selector).some((body) => /padding: 0 18px/.test(body)));
});
