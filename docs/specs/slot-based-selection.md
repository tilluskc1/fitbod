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

Ours is generated from `generateWorkout` at 50c3a17 for Build Muscle, Beginner, 3 days, dumbbells + bench. "Compound" means the exercise lists two or more muscles; "isolation" means one. Muscle is the primary muscle. No exercise names.

| Our day | Status | Our slots (muscle, kind) |
| --- | --- | --- |
| Push | Ready (5/5) | chest compound, shoulders compound, triceps isolation, shoulders compound, chest compound |
| Pull | Ready (5/5) | back compound, biceps isolation, core isolation, core isolation, biceps isolation |
| Legs | Limited (5/5) | quads compound, glutes compound, hamstrings isolation, core isolation, quads compound |

| Real app | Slots in order (muscle, kind; superset) |
| --- | --- |
| Day 1 (7 slots) | chest compound (A), back compound (A), biceps isolation (B), rear-delt isolation (B), triceps+chest compound (C), chest compound (C), core isolation |

Recorded by the owner from one signed-in Day 1 workout in the real app, as muscle and kind per slot only (no exercise names). A, B and C mark the three supersets, each a pair done back to back; the core slot stands alone. Day 2 and later days were not recorded; the acceptance needs one workout.

That workout belongs to a different profile (Advanced, large gym) from ours (Beginner, dumbbells + bench), so the table compares slot shapes only, not exercises, loads or volume.

### Gaps (one issue each, all needing owner triage)

| Real-app shape | Ours today | Issue |
| --- | --- | --- |
| Slots paired into supersets A/B/C | Straight sets only | #90 |
| Workout length set by time; slot count changes with duration | Fixed slot template per day, trimmed to fit | #91 |
| Upper/lower day types | Push/Pull/Legs only | #92 |
| Three chest compounds on the upper day (one triceps+chest) | Two chest compounds on Push | #94 |
| Heavier, lower-rep first compound (top set) | Same rep range for every slot | #95 |
