import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { EXERCISES } from '../src/data/exercises.ts';
import { adaptWorkout, todayGlance } from '../src/lib/adapt.ts';
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
// Dumbbells now have a calf raise (#174); a kettlebell-only Legs day still has no calf work.
const kettlebell: Profile = { ...base, daysPerWeek: 3, equipment: ['Kettlebell'], loads: {} };
const bodyweight = { ...base, equipment: [], loads: {} };
const barbell: Profile = { ...base, equipment: ['Barbell'], loads: {} };
const fullGear: Profile = { ...base, equipment: ['Dumbbell', 'Barbell', 'Cable', 'Machine'], support: ['Bench', 'Rack', 'Pull-up bar'] };
// Every curl excluded: Pull loses its biceps exercises (3 of 5), and Allow offers each curl back.
// 45 min: at honest rest (#132) a 35-min Pull only has room for the 4 exercises still possible, so no gap shows.
const noCurls = { ...dumbbells, sessionMinutes: 45, exclusions: EXERCISES.filter((e) => e.pattern === 'elbow_flexion').map((e) => e.id) };

const programFor = (who: Profile, name: string) => {
  const slot = planSlots(buildPlan(who)).find((item) => item.name.startsWith(name));
  assert.ok(slot, name);
  return slotProgram(who, slot, []);
};
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};

test('slotProgram carries the slot feasibility without padding the session', () => {
  const legs = programFor(kettlebell, 'Legs');
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
  const plan = renderToStaticMarkup(createElement(Plan as never, { profile: who, program, today: todayGlance(program, adapted, null), history: [],
    unit: 'kg', now, onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop, onReviewChange: noop }));
  return { today, plan, adapted };
}

test('Today and Plan show Limited and Not enough with alternatives, and nothing for Ready', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const { default: Plan } = await load('/src/screens/PlanScreen.tsx');

    const limited = screens(Today, Plan, kettlebell, 'Legs');
    for (const html of [limited.today, limited.plan]) {
      assert.match(plain(html), /Limited session · no calf work/);
      assert.match(html, /<button[^>]*>Add Machine<\/button>/);
      assert.match(html, /35 min/);
    }

    const none = screens(Today, Plan, bodyweight, 'Pull');
    for (const html of [none.today, none.plan]) {
      assert.match(plain(html), /Not enough equipment · no pulling or biceps curls/);
      assert.match(plain(html), /No pull exercise can be performed with the selected equipment and exclusions\./, 'reason is visible');
      assert.match(html, /<button[^>]*>Add Pull-up bar<\/button>/);
      assert.doesNotMatch(plain(html), /\d+ min/, 'no minutes for a day with no exercises');
    }
    assert.equal(tabBarAction(null, none.adapted).disabled, true, 'no Start of an empty workout');
    assert.match(none.today, /<button[^>]*disabled=""[^>]*>Preview workout/);

    const curls = screens(Today, Plan, noCurls, 'Pull');
    assert.match(curls.today, /<button[^>]*>Allow [^<]+<\/button>/);
    // The day fills its time, but with every curl excluded nothing trains biceps: named, with the fix (#67, #174).
    assert.match(plain(curls.today), /Limited session · no biceps work 4 exercises fit\. No biceps exercise is possible with these constraints\./, 'reason under the line');

    // Five alternatives: three chips, the rest behind the equipment settings. A kettlebell cannot fill
    // half of a 60-minute Push, so that day is short (#67); a barbell Push now fills its 35 min and is Ready.
    const thinPush: Profile = { ...kettlebell, sessionMinutes: 60 };
    const push = screens(Today, Plan, thinPush, 'Push');
    assert.equal(programFor(thinPush, 'Push').feasibility?.alternatives.length, 5);
    assert.equal(programFor(barbell, 'Push').feasibility?.status, 'ok');
    for (const html of [push.today, push.plan]) {
      assert.equal((html.match(/class="feasibility__alt"/g) ?? []).length, 3);
      assert.match(html, /<button[^>]*>More in Equipment<\/button>/);
    }

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
    // A thin day (the gear cannot fill half of 60 min) with an excluded exercise: more than three fixes on offer.
    const thin: Profile = { ...base, daysPerWeek: 3, equipment: ['Kettlebell'], loads: {}, sessionMinutes: 60, exclusions: ['kettlebell-press'] };
    const feasibility = programFor(thin, 'Push').feasibility!;
    let settings = 0;
    const reviews: { title: string; detail: string; patch: { exclusions?: string[] } }[] = [];
    const node = (FeasibilityNote as (p: object) => unknown)({ feasibility, profile: thin,
      onOpenSettings: () => { settings += 1; }, onReviewChange: (change: never) => reviews.push(change) });
    for (const button of elements(node).filter((el) => el.type === 'button')) button.props.onClick?.();
    const shown = feasibility.alternatives.slice(0, 3);
    const allow = shown.filter((a) => a.kind === 'allow-exercise');
    const more = feasibility.alternatives.length > 3 ? 1 : 0;
    assert.equal(more, 1, 'fixture has hidden alternatives');
    assert.equal(settings, shown.length - allow.length + more, 'Add X and More in Equipment open equipment settings');
    assert.equal(reviews.length, allow.length, 'Allow X opens a preview, it saves nothing');
    const [first] = reviews;
    assert.match(first.title, /^Allow .+ again\?$/);
    assert.match(first.detail, /future workouts/);
    assert.deepEqual(first.patch.exclusions, thin.exclusions.filter((id) => id !== allow[0].exerciseId));

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
    assert.match(plain(empty), /Your equipment can’t cover pulling or biceps curls yet\. Add gear to fill this day\./);
    assert.match(empty, /<button[^>]*>Edit equipment<\/button>/);
  });
});
