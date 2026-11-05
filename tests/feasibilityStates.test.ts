import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { EXERCISES } from '../src/data/exercises.ts';
import { adaptWorkout } from '../src/lib/adapt.ts';
import { defaultConstraints } from '../src/lib/constraints.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { planSlots, slotProgram } from '../src/lib/sequence.ts';
import { tabBarAction } from '../src/lib/tabBarAction.ts';
import type { Profile } from '../src/types.ts';

const base: Profile = {
  name: 'K', goal: 'Build Muscle', experience: 'Beginner', daysPerWeek: 5,
  equipment: ['Dumbbell'], support: [], exclusions: [], loads: { Dumbbell: [10, 15, 18] }, unit: 'kg',
};
const dumbbells = { ...base, daysPerWeek: 3 };
const bodyweight = { ...base, equipment: [], loads: {} };
const fullGear: Profile = { ...base, equipment: ['Dumbbell', 'Barbell', 'Cable', 'Machine'], support: ['Bench', 'Rack', 'Pull-up bar'] };
// Every curl excluded: Pull has no biceps flexion, and allowing one restores it.
const noCurls = { ...dumbbells, exclusions: EXERCISES.filter((e) => e.pattern === 'elbow_flexion').map((e) => e.id) };

const programFor = (who: Profile, name: string) => {
  const slot = planSlots(buildPlan(who)).find((item) => item.name.startsWith(name));
  assert.ok(slot, name);
  return slotProgram(who, slot, []);
};
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

test('slotProgram carries the slot feasibility without padding the session', () => {
  const legs = programFor(dumbbells, 'Legs');
  assert.equal(legs.feasibility?.status, 'limited');
  assert.ok(legs.feasibility?.coverage.some((item) => item.id === 'calf' && !item.satisfied));
  assert.ok(legs.feasibility?.alternatives.some((item) => item.label === 'Add Machine'));

  const pull = programFor(bodyweight, 'Pull');
  assert.equal(pull.feasibility?.status, 'infeasible');
  assert.equal(pull.exercises.length, 0, 'never invents a workout');

  const curls = programFor(noCurls, 'Pull');
  assert.ok(curls.feasibility?.alternatives.some((item) => item.kind === 'allow-exercise'));

  const ready = programFor(fullGear, 'Push');
  assert.equal(ready.feasibility?.status, 'ok');
  assert.deepEqual(ready.feasibility?.alternatives, []);
});

async function withServer<T>(run: (load: (path: string) => Promise<Record<string, unknown>>) => Promise<T>) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try { return await run((path) => server.ssrLoadModule(path)); } finally { await server.close(); }
}

function screens(Today: unknown, Plan: unknown, who: Profile, name: string) {
  const program = programFor(who, name);
  const adapted = adaptWorkout(program, defaultConstraints(who), who.exclusions);
  const now = new Date('2026-11-04T10:00:00.000Z');
  const today = renderToStaticMarkup(createElement(Today as never, { profile: who, program, adapted,
    equipment: 'home', adjusted: false, history: [], current: null, now, onPreview: noop, onAdjust: noop,
    onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));
  const plan = renderToStaticMarkup(createElement(Plan as never, { profile: who, program, history: [],
    unit: 'kg', now, onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop, onReviewChange: noop }));
  return { today, plan, adapted };
}

test('Today and Plan show Limited and Not enough with alternatives, and nothing for Ready', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const { default: Plan } = await load('/src/screens/PlanScreen.tsx');

    const limited = screens(Today, Plan, dumbbells, 'Legs');
    for (const html of [limited.today, limited.plan]) {
      assert.match(plain(html), /Limited session · no calf work/);
      assert.match(html, /<button[^>]*>Add Machine<\/button>/);
    }

    const none = screens(Today, Plan, bodyweight, 'Pull');
    for (const html of [none.today, none.plan]) {
      assert.match(plain(html), /Not enough equipment · no pulling, biceps flexion/);
      assert.match(html, /<button[^>]*>Add Pull-up bar<\/button>/);
    }
    assert.equal(tabBarAction(null, none.adapted).disabled, true, 'no Start of an empty workout');
    assert.match(none.today, /<button[^>]*disabled=""[^>]*>Preview workout/);

    const curls = screens(Today, Plan, noCurls, 'Pull');
    assert.match(curls.today, /<button[^>]*>Allow [^<]+<\/button>/);

    const ready = screens(Today, Plan, fullGear, 'Push');
    for (const html of [ready.today, ready.plan]) {
      assert.doesNotMatch(plain(html), /Limited session|Not enough equipment|Add |Allow /);
    }
  });
});

type El = { type: unknown; props: { children?: unknown; onClick?: () => void; [key: string]: unknown } };
const elements = (value: unknown): El[] =>
  Array.isArray(value) ? value.flatMap(elements)
    : value && typeof value === 'object' && 'props' in value
      ? [value as El, ...elements((value as El).props.children)]
      : [];

test('each alternative does what it says; Allow only previews, Confirm saves, Cancel changes nothing', async () => {
  await withServer(async (load) => {
    const { default: FeasibilityNote } = await load('/src/components/ui/FeasibilityNote.tsx');
    const { ConfirmChange } = await load('/src/screens/Sheets.tsx');
    const feasibility = programFor(noCurls, 'Pull').feasibility!;
    let settings = 0;
    const reviews: { title: string; detail: string; patch: { exclusions?: string[] } }[] = [];
    const node = (FeasibilityNote as (p: object) => unknown)({ feasibility, profile: noCurls,
      onOpenSettings: () => { settings += 1; }, onReviewChange: (change: never) => reviews.push(change) });
    for (const button of elements(node).filter((el) => el.type === 'button')) button.props.onClick?.();
    const allow = feasibility.alternatives.filter((a) => a.kind === 'allow-exercise');
    assert.equal(settings, feasibility.alternatives.length - allow.length, 'Add X opens equipment settings');
    assert.equal(reviews.length, allow.length, 'Allow X opens a preview, it saves nothing');
    const [first] = reviews;
    assert.match(first.title, /^Allow .+ again\?$/);
    assert.match(first.detail, /future workouts/);
    assert.deepEqual(first.patch.exclusions, noCurls.exclusions.filter((id) => id !== allow[0].exerciseId));

    const saved: unknown[] = [];
    let cancelled = 0;
    const confirm = (ConfirmChange as (p: object) => unknown)({ change: first,
      onConfirm: (patch: unknown) => saved.push(patch), onCancel: () => { cancelled += 1; } });
    const [ok, cancel] = elements(confirm).filter((el) => el.type === 'button');
    cancel.props.onClick?.();
    assert.deepEqual(saved, [], 'Cancel changes nothing');
    assert.equal(cancelled, 1);
    ok.props.onClick?.();
    assert.deepEqual(saved, [first.patch], 'Confirm removes only that exclusion');
  });
});

test('an empty Not enough day points to equipment, not Adjust today', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const { default: Plan } = await load('/src/screens/PlanScreen.tsx');
    const { today } = screens(Today, Plan, bodyweight, 'Pull');
    const empty = today.match(/<div class="empty-state"[\s\S]*?<\/div>/)?.[0] ?? '';
    assert.doesNotMatch(empty, /Adjust today/);
    assert.match(plain(empty), /pulling, biceps flexion/);
    assert.match(empty, /<button[^>]*>Edit equipment<\/button>/);
  });
});
