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
    'no pain today except my knee',
    'no pain at all except my knee',
    'nothing hurts today except my knee',
    'no pain anywhere except the knee',
    'nothing hurts but my knee',
    'no pain but my knee',
    'nothing hurts – except my knee',
    'nothing hurts. except my knee',
    'nothing hurts... except my knee',
    'nothing hurts! but my knee does',
    'nothing hurts? except my knee',
    'nothing hurts\nexcept my knee',
  ]) assert.equal(talkParse(text).pain, true, text);
});

test('#241: a plain denial is still no pain', () => {
  for (const text of ['nothing hurts', 'no pain today, chest', 'nothing hurts, 30 min', 'pain-free', "my back doesn't hurt", 'injury free, legs']) {
    assert.equal(talkParse(text).pain, undefined, text);
  }
});

test('#241: unsure reads as pain (lesson 3, last parser round): any exception word after a denial stops; "It\'s only soreness" answers it', () => {
  for (const text of ['no pain, but legs are sore', 'no pain. Skip legs but train chest']) assert.equal(talkParse(text).pain, true, text);
});
