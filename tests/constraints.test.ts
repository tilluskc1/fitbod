import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultConstraints,
  keywordParser,
  normalizeNumberWords,
  resolveConstraints,
} from '../src/lib/constraints.ts';
import type { Profile } from '../src/types.ts';

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    goal: 'Build Muscle',
    experience: 'Intermediate',
    daysPerWeek: 3,
    equipment: [],
    support: [],
    exclusions: [],
    loads: {},
    ...overrides,
  };
}

test('kettlebell-only names the unsupported equipment instead of mapping to home', () => {
  assert.deepEqual(keywordParser.parse('kettlebell only'), {
    unsupportedEquipment: 'kettlebell',
  });
});

test('a one-minute request stays visible instead of snapping to ten', () => {
  assert.deepEqual(keywordParser.parse('I only have 1 minute'), { minutes: 1 });
});

test('#426: spoken numbers normalize to digits, so voice reads the same as typed text', () => {
  assert.equal(normalizeNumberWords('thirty minutes'), '30 minutes');
  assert.equal(normalizeNumberWords('Forty-five minutes'), '45 minutes');
  assert.equal(normalizeNumberWords('a hundred and ten minutes'), '110 minutes');
  assert.equal(normalizeNumberWords('30 minutes'), '30 minutes', 'typed digits pass through unchanged');
  assert.deepEqual(keywordParser.parse('thirty minutes'), { minutes: 30 });
});

test('unsupported equipment keeps the current setup and says what was asked', () => {
  const resolved = resolveConstraints(
    { minutes: 35, equipment: 'home' },
    { unsupportedEquipment: 'kettlebell' },
  );
  assert.deepEqual(resolved.constraints, { minutes: 35, equipment: 'home' });
  assert.equal(resolved.notices.length, 1);
  assert.equal(resolved.notices[0].kind, 'unsupported-equipment');
});

test('out-of-range minutes clamp visibly to the supported boundary', () => {
  const short = resolveConstraints({ minutes: 35, equipment: 'home' }, { minutes: 1 });
  assert.equal(short.constraints.minutes, 10);
  assert.equal(short.notices.length, 1);
  assert.equal(short.notices[0].kind, 'minutes-adjusted');

  const long = resolveConstraints({ minutes: 35, equipment: 'home' }, { minutes: 200 });
  assert.equal(long.constraints.minutes, 120);
  assert.equal(long.notices.length, 1);
});

test('a supported request applies cleanly with no notices', () => {
  const resolved = resolveConstraints(
    { minutes: 35, equipment: 'home' },
    { minutes: 20, equipment: 'bodyweight' },
  );
  assert.deepEqual(resolved.constraints, { minutes: 20, equipment: 'bodyweight' });
  assert.deepEqual(resolved.notices, []);
});

test('the default setup follows the saved equipment, not a home assumption', () => {
  assert.deepEqual(defaultConstraints(makeProfile()), {
    minutes: 35,
    equipment: 'bodyweight',
  });
  assert.deepEqual(defaultConstraints(makeProfile({ equipment: ['Dumbbell'] })), {
    minutes: 35,
    equipment: 'home',
  });
  assert.deepEqual(
    defaultConstraints(makeProfile({ equipment: ['Dumbbell'], sessionMinutes: 30 })),
    { minutes: 30, equipment: 'home' },
  );
});
