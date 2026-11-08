import assert from 'node:assert/strict';
import test from 'node:test';
import { talkParse } from '../src/lib/todayTalk.ts';

test('#241: a denial with an exception still names pain, so it never builds a day', () => {
  for (const text of [
    'nothing hurts except my knee',
    'no pain but my shoulder hurts',
    'nothing hurts apart from my back',
    'no pain other than my wrist',
    'nothing hurts, except my elbow',
    'nothing hurts besides my hip',
  ]) assert.equal(talkParse(text).pain, true, text);
});

test('#241: a plain denial is still no pain', () => {
  for (const text of ['nothing hurts', 'no pain today, chest', 'nothing hurts, 30 min', 'no pain, but legs are sore']) {
    assert.equal(talkParse(text).pain, undefined, text);
  }
});
