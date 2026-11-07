import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// #168: the keyboard focus ring must reach 3:1 against the surfaces it sits on (WCAG 2.2, 1.4.11).

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every focus outline uses the focus token, never lime', () => {
  assert.doesNotMatch(css, /outline:[^;]*var\(--lime\)/);
  const outlines = css.match(/outline: 2px solid var\(--[a-z-]+\)/g) ?? [];
  assert.ok(outlines.length >= 3);
  for (const rule of outlines) assert.equal(rule, 'outline: 2px solid var(--focus)');
});

test('the focus token reaches 3:1 on the mint page, white cards and the sheet surface', () => {
  const focus = token('focus')!;
  for (const surface of [token('surface')!, '#ffffff', token('surface-container-low')!]) {
    assert.ok(contrast(focus, surface) >= 3, `${focus} on ${surface}: ${contrast(focus, surface).toFixed(2)}`);
  }
  assert.ok(contrast(token('primary')!, '#ffffff') < 3, 'lime would fail, which is why it is not used');
});
