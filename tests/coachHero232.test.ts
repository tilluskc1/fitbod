import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createServer } from 'vite';

// #232: the Coach hero card is a light v7 card; its kicker, title and copy reach 4.5:1 against every
// colour of the card's background, with and without history. Browser pass: docs/mockups/232-coach-hero/.
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const blocks = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selectors, body]) =>
  ({ selectors: selectors.split(',').map((item) => item.trim()), body }));
const decl = (selector: string, prop: string) => blocks
  .filter((block) => block.selectors.includes(selector))
  .flatMap((block) => [...block.body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim()))
  .at(-1);
const resolve = (value: string): string =>
  value.replace(/var\(--([a-z0-9-]+)\)/g, (_, name) => resolve(decl(':root', `--${name}`) ?? `missing --${name}`));

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// Text colour by the cascade this card uses: `.big-card .x`, then `.x`, then inherited from the card, then body.
const textColour = (cls: string) => resolve(
  decl(`.big-card .${cls}`, 'color') ?? decl(`.${cls}`, 'color') ?? decl('.big-card', 'color') ?? decl('body', 'color')!,
);
// Every colour the card background paints (a gradient's every stop), so no pixel is missed.
const backgroundColours = () => resolve(decl('.big-card', 'background') ?? decl('.big-card', 'background-color')!)
  .match(/#[0-9a-fA-F]{6}\b/g) ?? [];

const profile = {
  name: 'Sam', goal: 'muscle', experience: 'intermediate', daysPerWeek: 4, sessionMinutes: 60,
  equipment: ['Barbell', 'Dumbbell'], support: ['Bench', 'Rack'], unit: 'lb', loads: {},
};
const done = { id: 'w1', date: '2026-11-08T10:00:00.000Z', name: 'Upper A', dayIndex: 0, status: 'completed', exercises: [] };

test('Coach hero text reaches 4.5:1 on every background colour, with and without history (#232)', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try {
    const { default: Coach } = await server.ssrLoadModule('/src/screens/CoachScreen.tsx');
    for (const history of [[], [done]]) {
      const html = renderToStaticMarkup(createElement(Coach, {
        profile, history, program: { name: 'Upper A', minutes: 60 }, onWhy: () => {}, onEdit: () => {},
      }));
      const card = html.match(/<section class="big-card">([\s\S]*?)<\/section>/)?.[1];
      assert.ok(card, 'the hero card renders');
      const texts = [...card.matchAll(/<(span|h2|p) class="([^"]+)">([^<]+)</g)].map((m) => ({ cls: m[2], text: m[3] }));
      assert.deepEqual(texts.map((t) => t.cls), ['kicker', 'big-title', 'big-copy']);
      const backgrounds = backgroundColours();
      assert.ok(backgrounds.length > 0, 'the card has a resolvable background colour');
      for (const { cls, text } of texts) {
        for (const bg of backgrounds) {
          const ratio = contrast(textColour(cls), bg);
          assert.ok(ratio >= 4.5, `${history.length} sessions, .${cls} "${text}" ${textColour(cls)} on ${bg}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
  } finally {
    await server.close();
  }
});

test('the hero card uses the same light surface as the recent-context card, and no dark radial gradient is left (#232)', () => {
  assert.equal(resolve(decl('.big-card', 'background')!), resolve(decl('.card', 'background')!));
  assert.doesNotMatch(css, /radial-gradient|#1a2413|#182014/i);
});
