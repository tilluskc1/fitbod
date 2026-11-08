# Spec (DRAFT, not posted): Slot-based exercise selection

Repo: `tilluskc1/fitbod`. Related, not duplicates: #29 (focus areas), #41 (preferences/exclusions), #30 (exercise action sheet), #9 (catalog coverage).

## Why

`generateWorkout` (`src/lib/generator.ts`) fills a day by seeded shuffle, then caps by pattern and by primary muscle. Reproduced with Build Muscle, Beginner, 3 days, dumbbells + bench:

- Push returns 4 of 5 exercises and reports `Limited session`. Picks: Push-Up, Rear Delt Fly, Arnold Press, Incline Dumbbell Press.
- Cause: two Shoulders-primary picks (Rear Delt Fly, Arnold Press) hit the 2-per-primary-muscle cap, which blocks Lateral Raise. Two Chest picks hit the same cap. No dumbbell triceps-primary exercise exists in the 53-exercise catalog except Diamond Push-Up, whose pattern is already used twice.
- Triceps is "covered" only through the secondary patterns of presses. That is honest coverage, but there is no triceps work with its own slot.
- Pull has two curls and two core moves; Legs has two core moves.

The cause is that nothing says what a day should contain, so slots are filled by whatever survives the caps.

## Fitbod comparison (observed, no scraping)

Fitbod's generation runs on its server (`RemoteWorkoutService`), so its exact picks cannot be recovered from the app. Compare by **movement slots**, by hand, from one workout shown in its own app after the user signs in. Record a slot table, not exercise names. Do not copy Fitbod's catalog, names, images or text. The shipped data only tells us which fields are worth modelling: muscle utility weight, body tier, unilateral flag, equipment links, incompatible pairs, ranked replacements.

## Design

1. **Day templates.** Each `PlanDay` gets ordered slots, e.g. Push = `[chest compound, shoulder compound, triceps isolation, lateral/rear delt, chest second]`. A slot names a muscle, a kind (`compound` | `isolation`) and optional allowed patterns.
2. **Fill by slot.** For each slot take the best candidate that is equipment-feasible, not excluded, not already picked and not incompatible with a picked exercise. The seed only breaks ties inside the same rank, so the same day stays stable.
3. **Incompatible pairs.** A small authored list (e.g. Push-Up with Diamond Push-Up, Arnold Press with Dumbbell Shoulder Press) that never share a day.
4. **Ranked replacements.** Each exercise gets a deterministic ordered list of same-slot alternatives, used by the swap action in #30.
5. **Honest short days.** An unfillable slot still reports `Limited session` and names the slot, never a padded one.
6. **Catalog.** Add original dumbbell triceps-primary work (e.g. Overhead Dumbbell Triceps Extension) with our own instruction text. Check against #9 before widening.

Out of scope: server generation, AI, wearables, copying their data, matching their exercise list.

## Acceptance

- [ ] Failing test first: Build Muscle, Beginner, 3 days, dumbbells + bench, no exclusions gives Push `Ready` with 5 exercises, one triceps-primary, no more than 2 shoulder-primary.
- [ ] Every shipped day template fills its slots or names the unfilled slot.
- [ ] An excluded exercise or incompatible pair is never picked together.
- [ ] Same inputs and day index give the same workout twice.
- [ ] Existing `tests/generator.test.ts`, `plan.test.ts` and `trust3.test.ts` still pass.
- [x] Slot table for our Push/Pull/Legs recorded next to Fitbod's from one signed-in workout.

## Open question for the human

Fitbod's server side cannot be matched. Is "same slots, same muscle coverage" the target, rather than the same exercises?

## Slot table: ours vs the real app

Source for the real app: the owner's screen recording of one Fitbod Day 1 (Nov 4, 2026), read frame by frame. That account is a different profile from ours (Get Lean, Advanced, 5 per week, large gym), so this compares **slot shapes**, not exercises. No exercise names are recorded for the real app.

Ours is generated from `generateWorkout` at 50c3a17 for Build Muscle, Beginner, 3 days, dumbbells + bench. "Compound" means the exercise lists two or more muscles; "isolation" means one. Muscle is the primary muscle.

| Our day | Status | Our slots (muscle, kind) |
| --- | --- | --- |
| Push | Ready (5/5) | chest compound, shoulders compound, triceps isolation, shoulders compound, chest compound |
| Pull | Ready (5/5) | back compound, biceps isolation, core isolation, core isolation, biceps isolation |
| Legs | Limited (5/5) | quads compound, glutes compound, hamstrings isolation, core isolation, quads compound |

Real app, Day 1 "Upper Body Day", 45 min, 7 exercises, 6 muscles, in screen order:

| Slot | Muscle | Kind | Group |
| --- | --- | --- | --- |
| 1 | chest | compound | superset A |
| 2 | back | compound | superset A |
| 3 | biceps | isolation | superset B |
| 4 | rear delts | isolation | superset B |
| 5 | triceps and chest | compound | superset C |
| 6 | chest | compound | superset C |
| 7 | core | isolation | alone |

Other observations from the same recording: the same day at 1 hour became 10 exercises over only 3 muscles (chest, biceps, core); the Lower Body day at 1 hour was 10 exercises over 4 muscles; the first compound was 5 sets of 6, accessories 3 sets of 12 to 16.

### Slots we lack (one issue each)

1. #88 Supersets (paired exercises, 3 rounds).
2. #89 Session length drives exercise count (7 at 45 min, 10 at 1 hour).
3. #93 Upper/lower day types for short plans.
4. #96 A third exercise for a focus muscle (done: see the per-muscle cap in `docs/chat-handoff.md`, Programming).
5. #97 Heavy top set for the first compound (5 x 6).

Shapes we already match: a rear-delt isolation slot, a core finisher, a bench-press-first day.

Limits: one workout, one account, frames read at 2-second steps (Day 1 fully, Lower Body only in part).
