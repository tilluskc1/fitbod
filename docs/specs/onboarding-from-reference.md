# Spec (DRAFT): Onboarding that matches the reference flow

Repo: `tilluskc1/fitbod`. Split from `slot-based-selection.md`. Related: #59 (Bench pre-selected), #64 (default unit), #57 (example rack), #29 (focus).

## Reference
Observed order: goal, routine, training duration, location, gym pick, equipment review, current strength (yes/no), best-lift entry (squat, bench, row, deadlift: reps + weight, kg/lb), days per week (1-2 to 6+), notifications, calories, sign-up, "analyzing" screen, plan preview, paywall.
Plan preview for Get Lean / 5 per week / Advanced / Large Gym: "Day 1 Upper Body Day, Day 2 Lower Body Day" (only two days seen). Our 5-day split is Push/Pull/Legs, so that is a slot-table difference to record.

| Step | Real app | Ours today | Decision |
| --- | --- | --- | --- |
| Goal | 4 goals | 4 goals (step 0) | Keep; map labels, do not copy text |
| Experience | Routine + years, two questions | One 3-level question (step 1) | Adopt: derive level from two answers |
| Equipment | Place preset, then editable list | Manual list + support (step 3) | Adopt preset by place type (large gym, small gym, garage); skip gym search and location |
| Best lifts | Optional, 4 lifts, kg/lb, skippable | None (loads = owned dumbbells) | Adopt as optional first-load seed; separate issue |
| Days | 1-2 to 6+ | Days stepper (step 2) | Keep; add 6+ only if the split exists |
| Session length | Not asked | Asked (step 2) | Keep (ours is a real input) |
| Plan preview | Week with day names and muscle art | PlanScreen after onboarding | Adopt: show the week before the first workout |
| Notifications, calories, Apple Health | Asked | None | Skip: local-first, no accounts |
| Sign-up, paywall | Required | None | Skip: no accounts, no pricing copied |

Do not copy: their copy text, imagery, branding, prices or paywall.

## Acceptance

- [ ] Experience level is derived from two answers (routine, years trained); the mapping is a tested pure function.
- [ ] Choosing a place type presets equipment and support gear, shows the list for review, and nothing is assumed beyond what the preset states (#59, #57).
- [ ] Best lifts are optional and skippable; entered values seed first loads in the chosen unit and never overwrite logged history.
- [ ] The week preview (day names, muscles per day) shows before the first workout starts.
- [ ] No account, location, notification, calorie or pricing step is added.
- [ ] 390x844 and 360x780 screenshots for each changed step.

## Open question for the human

Add `6+` days only if a 6-day split already exists (`SPLITS` in `src/lib/generator.ts` covers 2 to 6).
