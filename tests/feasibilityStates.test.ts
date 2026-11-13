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
// It plans Dumbbell Row 4, Rear Delt Fly 4, Plank 3: about 29 min at honest rest (#132), with one core
// exercise by the split-day cap (#190) and no other back or biceps move for this kit. That is more than
// half of 45 min, so no count gap shows (#67), only the missing biceps.
const noCurls = { ...dumbbells, sessionMinutes: 45, exclusions: EXERCISES.filter((e) => e.pattern === 'elbow_flexion').map((e) => e.id) };

const programFor = (who: Profile, name: string) => {
  const slot = planSlots(buildPlan(who)).find((item) => item.name.startsWith(name));
  assert.ok(slot, name);
  return slotProgram(who, slot, []);
};
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
/** (#297) Plan's status chip: tone and words, null when Ready. */
const planChipOf = (html: string) => /<span class="plan-chip plan-chip--(\w+)">([^<]+)<\/span>/.exec(html);
const rowStats = (html: string) => plain(html).match(/Today [^·]*?(\d+) exercises? · (\d+) sets?(?: · (≈?\d+) min)?/);

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
  const adapted = adaptWorkout(program, defaultConstraints(who), who.exclusions, who.goal);
  const now = new Date('2026-11-04T10:00:00.000Z');
  const today = renderToStaticMarkup(createElement(Today as never, { profile: who, program, adapted,
    equipment: 'home', adjusted: false, history: [], current: null, now, onPreview: noop, onAdjust: noop,
    onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));
  const planHtml = renderToStaticMarkup(createElement(Plan as never, { profile: who, program, today: todayGlance(adapted, null),
    todayIds: adapted.exercises.map((exercise: { exerciseId: string }) => exercise.exerciseId), history: [],
    unit: 'kg', onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop }));
  return { today, plan: planHtml, adapted };
}

test('Today and Plan show Limited and Not enough with alternatives, and nothing for Ready', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const { default: Plan } = await load('/src/screens/PlanScreen.tsx');

    // (#297) Today keeps the full FeasibilityNote (line, reason, alternatives); Plan carries a short chip
    // with the same reason words and the honest stats, never the alternative buttons.
    const limited = screens(Today, Plan, kettlebell, 'Legs');
    assert.match(plain(limited.today), /Limited session · no calf work/);
    assert.match(limited.today, /<button[^>]*>Add Machine<\/button>/);
    assert.match(plain(limited.today), /35 min/);
    assert.match(plain(limited.today), /13 sets/);
    assert.deepEqual([...(planChipOf(limited.plan) ?? [])].slice(1), ['limited', 'Limited · no calf work'], 'Plan chip');
    assert.doesNotMatch(limited.plan, /Add Machine|feasibility__alt/, 'Plan shows no alternatives');
    assert.match(plain(limited.plan), /13 sets? · 35 min/);

    const none = screens(Today, Plan, bodyweight, 'Pull');
    assert.match(plain(none.today), /Not enough equipment · no pulling or biceps curls/);
    assert.match(plain(none.today), /No pull exercise can be performed with the selected equipment and exclusions\./, 'reason is visible');
    assert.match(none.today, /<button[^>]*>Add Pull-up bar<\/button>/);
    assert.deepEqual([...(planChipOf(none.plan) ?? [])].slice(1), ['none', 'Not enough equipment'], 'Plan chip');
    assert.doesNotMatch(none.plan, /Add Pull-up bar|feasibility__alt/, 'Plan shows no alternatives');
    // The empty day's own row states no minutes (#200); the header's "usual" line still may.
    assert.equal(rowStats(none.plan)?.[3], undefined, 'no minutes in an empty day row');
    assert.equal(tabBarAction(null, none.adapted).disabled, true, 'no Start of an empty workout');
    assert.match(none.today, /<button[^>]*disabled=""[^>]*>Preview workout/);

    const curls = screens(Today, Plan, noCurls, 'Pull');
    assert.match(curls.today, /<button[^>]*>Allow [^<]+<\/button>/);
    assert.match(plain(curls.today), /Limited session · no biceps work 3 exercises fit\. No biceps exercise is possible with these constraints\./, 'reason under the line');
    assert.deepEqual([...(planChipOf(curls.plan) ?? [])].slice(1), ['limited', 'Limited · no biceps work'], 'Plan chip');

    const thinPush: Profile = { ...kettlebell, sessionMinutes: 60 };
    const push = screens(Today, Plan, thinPush, 'Push');
    assert.equal(programFor(thinPush, 'Push').feasibility?.alternatives.length, 5);
    assert.equal(programFor(barbell, 'Push').feasibility?.status, 'ok');
    // Today shows three alternative chips and More; Plan shows one chip and no alternatives.
    assert.equal((push.today.match(/class="feasibility__alt"/g) ?? []).length, 3);
    assert.match(push.today, /<button[^>]*>More in Equipment<\/button>/);
    assert.equal((push.plan.match(/feasibility__alt|More in Equipment/g) ?? []).length, 0);
    assert.equal(planChipOf(push.plan)?.[1], 'limited');

    const ready = screens(Today, Plan, fullGear, 'Push');
    assert.doesNotMatch(plain(ready.today), /Limited session|Not enough equipment|Add |Allow /);
    assert.equal(planChipOf(ready.plan), null, 'Ready day has no Plan chip');
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
