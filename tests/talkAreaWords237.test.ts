import assert from 'node:assert/strict';
import test from 'node:test';
import { AREAS } from '../src/lib/areas.ts';
import { talkParse } from '../src/lib/todayTalk.ts';

/* #237: compound area words. Best effort, one round (lessons #3); the chips stay the safety net. */

const UPPER = ['Chest', 'Back', 'Shoulders', 'Arms'];
const pick = (text: string) => {
  const { train, avoid, sore, minutes } = talkParse(text);
  return Object.fromEntries(Object.entries({ train, avoid, sore, minutes }).filter(([, v]) => v !== undefined));
};

test('#237: every table row trains its areas', () => {
  const rows: [string, string[]][] = [
    ['upper body', UPPER], ['upperbody', UPPER], ['upper-body', UPPER],
    ['lowerbody', ['Legs']], ['lower-body', ['Legs']], ['lower body', ['Legs']],
    ['full body', [...AREAS]], ['fullbody', [...AREAS]], ['full-body', [...AREAS]],
    ['leg day', ['Legs']], ['legday', ['Legs']], ['leg-day', ['Legs']],
    ['upper', UPPER], ['upper today', UPPER], ['just upper please', UPPER],
  ];
  for (const [text, train] of rows) assert.deepEqual(pick(text), { train }, text);
});

test('#237: the same words skip when sore or left out', () => {
  assert.deepEqual(pick('sore upperbody'), { avoid: UPPER, sore: UPPER });
  assert.deepEqual(pick('upper-body is sore'), { avoid: UPPER, sore: UPPER });
  assert.deepEqual(pick('skip lowerbody'), { avoid: ['Legs'] });
  assert.deepEqual(pick('no legday'), { avoid: ['Legs'] });
  assert.deepEqual(pick('fullbody is sore'), { avoid: [...AREAS], sore: [...AREAS] });
  assert.deepEqual(pick('my upper is sore, legs'), { train: ['Legs'], avoid: UPPER, sore: UPPER });
});

test('#237: "upper" before a muscle names only that muscle', () => {
  assert.deepEqual(pick('upper back'), { train: ['Back'] });
  assert.deepEqual(pick('upper chest'), { train: ['Chest'] });
  assert.deepEqual(pick('upper-back is sore'), { avoid: ['Back'], sore: ['Back'] });
  assert.deepEqual(pick('upper chest and arms'), { train: ['Chest', 'Arms'] });
});

test("#237: the owner's sentence reads as 30 min, skip Legs, train upper body", () => {
  assert.deepEqual(pick('i have 30 min today i have sore legs i can do upperbody today'),
    { minutes: 30, train: UPPER, avoid: ['Legs'], sore: ['Legs'] });
});
