import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { adaptWorkout } from '../src/lib/adapt.ts';
import type { EquipmentChoice } from '../src/lib/adapt.ts';
import { AREAS, MUSCLE_NOUN } from '../src/lib/areas.ts';
import type { Area } from '../src/lib/areas.ts';
import { buildPlan } from '../src/lib/generator.ts';
import { liveAdapted, liveExercises } from '../src/lib/liveProgression.ts';
import { planSlots, todayProgram } from '../src/lib/sequence.ts';
import { createSession } from '../src/lib/session.ts';
import { customDayPreview, describedDayStatus, talkConstraints } from '../src/lib/todayTalk.ts';
import type { TalkState } from '../src/lib/todayTalk.ts';
import type { Profile } from '../src/types.ts';

/**
 * #219: a described day ("Tell me about today") is Limited only for a gap it can name, and Today
 * shows the same status and reason lines as the composer's preview, from one helper.
 */
const gym: Profile = {
  name: 'K', goal: 'Build Muscle', experience: 'Intermediate', daysPerWeek: 4,
  equipment: ['Barbell', 'Dumbbell', 'Machine', 'Cable', 'Kettlebell'], support: ['Bench', 'Rack', 'Pull-up bar'],
  exclusions: [], loads: {}, unit: 'lb', sessionMinutes: 60,
};
const lower = planSlots(buildPlan(gym))[1];
const SETUPS: EquipmentChoice[] = ['home', 'hotel', 'bodyweight'];
const subsets = (items: Area[]) => items.reduce<Area[][]>((all, item) => all.concat(all.map((set) => [...set, item])), [[]]);
/** The generator's movement-family wording, which belongs to planned days only. */
const REQUIREMENT = /pressing|pulling|squat or lunge|hip hinge|available with these constraints|movement patterns|Limited session|Full session|Limited · \d/i;
const CONTEXT = new Set(['Skipped:', 'Loads:', 'Time:']);

function day(talk: TalkState) {
  const constraints = talkConstraints(talk, undefined, lower.focus);
  const program = todayProgram(gym, lower, [], constraints);
  const live = liveAdapted(adaptWorkout(program, constraints, [], gym.goal), gym, []);
  return { constraints, program, live, preview: customDayPreview(talk, program, live, gym, lower.focus) };
}

test('#219: sweep — a described day is Limited exactly when it names a gap, and Today reads the same', () => {
  let checked = 0;
  const count = { limited: 0, ready: 0, none: 0 };
  for (const equipment of SETUPS) {
    for (const minutes of [30, 45, 60]) {
      for (const train of subsets(AREAS).filter((set) => set.length > 0)) {
        for (const skip of [[], ...AREAS.filter((area) => !train.includes(area)).map((area) => [area])] as Area[][]) {
          const talk: TalkState = { equipment, minutes, train, skip, sore: skip, pain: false, notices: [] };
          const { constraints, program, live, preview } = day(talk);
          if (!constraints.focus) continue;
          const at = `${equipment} ${minutes} ${train}/${skip}: ${live.exercises.map((e) => e.exerciseId)}`;
          count[preview.status] += 1;
          if (live.exercises.length > 0) {
            assert.equal(preview.status === 'limited', preview.gaps.length > 0, `${at}: ${preview.status} with ${preview.gaps.length} gaps`);
          } else {
            assert.equal(preview.status, 'none', at);
          }
          const reasons = preview.why.filter((line) => !CONTEXT.has(line.label));
          if (preview.status !== 'ready') {
            assert.ok(reasons.some((line) => preview.gaps.some((gap) => new RegExp(`\\b${MUSCLE_NOUN[gap.muscle]}\\b`).test(line.text))),
              `${at}: ${preview.status} names no muscle: ${JSON.stringify(preview.why)}`);
          }
          for (const line of preview.why) assert.doesNotMatch(`${line.label} ${line.text}`, REQUIREMENT, at);
          // The one helper App gives Today: the same status and the same reason lines.
          const shown = describedDayStatus(constraints, program, live, gym);
          assert.ok(shown, at);
          assert.equal(shown.status, preview.status, at);
          assert.deepEqual(shown.reasons, reasons, at);
          checked += 1;
        }
      }
    }
  }
  assert.equal(checked, 2232);
  assert.equal(count.limited + count.ready + count.none, checked);
});

test('#219: a planned day has no described status; its feasibility stays the generator\'s', () => {
  const constraints = { equipment: 'hotel' as const, minutes: 45 };
  const program = todayProgram(gym, lower, [], constraints);
  assert.equal(describedDayStatus(constraints, program, adaptWorkout(program, constraints, [], gym.goal), gym), null);
});

test('#219: the travel gym Arms day with Chest skipped reads Ready (≈28 min), no gaps', () => {
  for (const minutes of [30, 45, 60]) {
    const { preview } = day({ equipment: 'hotel', minutes, train: ['Arms'], skip: ['Chest'], sore: [], pain: false, notices: [] });
    assert.deepEqual(preview.gaps, [], `${minutes}`);
    assert.equal(preview.status, 'ready', `${minutes}`);
  }
  const { preview } = day({ equipment: 'hotel', minutes: 60, train: ['Arms'], skip: ['Chest'], sore: [], pain: false, notices: [] });
  assert.equal(preview.approx, true);
  assert.equal(preview.minutes, 28);
});

async function withServer<T>(run: (load: (path: string) => Promise<Record<string, unknown>>) => Promise<T>) {
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom' });
  try { return await run((path) => server.ssrLoadModule(path)); } finally { await server.close(); }
}
const plain = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const noop = () => {};
/** The hero's state chip: its tone and its words (after the icon's ligature). */
const chipOf = (html: string) => /<span class="t7-state t7-state--(\w+)"><span [^>]*>\w+<\/span>([^<]+)<\/span>/.exec(html);

test('#219: Today and Plan show a described day\'s status and reasons as the preview does, pending or running', async () => {
  await withServer(async (load) => {
    const { default: Today } = await load('/src/screens/TodayScreen.tsx');
    const { default: Plan } = await load('/src/screens/PlanScreen.tsx');
    const { todayGlance } = await load('/src/lib/adapt.ts') as { todayGlance: typeof import('../src/lib/adapt.ts').todayGlance };
    const now = new Date('2026-11-07T10:00:00.000Z');
    const states: TalkState[] = [
      // Ready, although the generator calls it short of pressing and pulling.
      { equipment: 'hotel', minutes: 60, train: ['Arms'], skip: ['Chest'], sore: [], pain: false, notices: [] },
      // Limited for gear: bodyweight has no back exercise.
      { equipment: 'bodyweight', minutes: 30, train: ['Back', 'Core'], skip: [], sore: [], pain: false, notices: [] },
      // Limited with a twin: Diamond Push-Up repeats Push-Up.
      { equipment: 'bodyweight', minutes: 45, train: ['Chest', 'Arms'], skip: [], sore: [], pain: false, notices: [] },
    ];
    for (const talk of states) {
      const { constraints, program, live, preview } = day(talk);
      const described = describedDayStatus(constraints, program, live, gym);
      const at = `${talk.equipment} ${talk.train}/${talk.skip}`;
      const reasons = preview.why.filter((line) => !CONTEXT.has(line.label));
      const word = preview.status === 'ready' ? 'Ready' : preview.status === 'limited' ? 'Limited' : 'Not enough equipment';
      // Pending (the override saved, not started) and running (a described session has no slot link).
      const running = createSession({ id: 's', name: live.name, dayIndex: lower.index, exercises: liveExercises(live, gym, []), now: now.toISOString(), durationMin: live.minutes });
      for (const current of [null, running]) {
        const today = renderToStaticMarkup(createElement(Today as never, { profile: gym, program, adapted: live,
          equipment: talk.equipment, adjusted: true, history: [], current, now, described, onPreview: noop, onAdjust: noop,
          onWhy: noop, onRestore: noop, onOpenSettings: noop, onOpenExercise: noop, onReviewChange: noop }));
        const chip = chipOf(today);
        assert.ok(chip, at);
        assert.equal(chip[1], preview.status, `${at}: tone`);
        assert.equal(chip[2].trim(), word, `${at}: chip`);
        const text = plain(today);
        for (const line of reasons) assert.ok(text.includes(`${line.label} ${line.text}`), `${at}: Today lacks ${line.label} ${line.text}`);
        assert.doesNotMatch(text, REQUIREMENT, at);
      }
      const plan = plain(renderToStaticMarkup(createElement(Plan as never, { profile: gym, program, today: todayGlance(live, null, true), history: [],
        unit: 'lb', now, described, onOpenSettings: noop, onViewDay: noop, onOpenLibrary: noop, onReviewChange: noop })));
      for (const line of reasons) assert.ok(plan.includes(`${line.label} ${line.text}`), `${at}: Plan lacks ${line.label}`);
      assert.doesNotMatch(plan, REQUIREMENT, at);
    }
  });
});

test('#219: the Adjust review of a described day shows its reasons, never the generator\'s requirements', async () => {
  await withServer(async (load) => {
    const { default: Adapt } = await load('/src/screens/AdaptScreen.tsx');
    for (const talk of [
      { equipment: 'hotel', minutes: 45, train: ['Arms'], skip: ['Chest'], sore: [], pain: false, notices: [] },
      { equipment: 'bodyweight', minutes: 30, train: ['Back', 'Core'], skip: [], sore: [], pain: false, notices: [] },
    ] as TalkState[]) {
      const { constraints, program, live, preview } = day(talk);
      // The rebuilt day carries the generator's planned-day verdict; the review must not show it.
      assert.equal(live.feasibility?.status, 'limited');
      const html = plain(renderToStaticMarkup(createElement(Adapt as never, { profile: gym, originalSets: 20, adapted: live, constraints,
        before: { minutes: 60 }, after: { minutes: preview.minutes, approx: preview.approx }, notices: [], onStart: noop, onKeep: noop, onEdit: noop,
        described: describedDayStatus(constraints, program, live, gym) })));
      const at = `${talk.equipment} ${talk.train}`;
      assert.doesNotMatch(html, REQUIREMENT, at);
      for (const line of preview.why.filter((item) => !CONTEXT.has(item.label))) assert.ok(html.includes(`${line.label} ${line.text}`), at);
    }
  });
});
