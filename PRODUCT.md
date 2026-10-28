# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** one lifter training mostly at home with a specific, limited kit (for example dumbbells
  plus a bench, or a kettlebell only). Uses the app mid-session, on a phone, one hand free, with no
  patience for a setup flow that asks the same questions twice.
- **Secondary:** people reviewing the repository as a work sample. They read the README, AUDIT and
  HANDOFF before running it, and judge the documented decisions as much as the screen.

## Product Purpose

A local-first strength-training app: onboarding → split → generated workout → set logging → history.
It exists so one lifter can walk into a session knowing exactly what to do with the equipment they
actually own, and leave with a record that survives a reload.

Success means the app is used session after session without a lost set, without a workout invented
from equipment the user does not have, and without a prescription that silently changes itself.

## Positioning

Programming is **equipment-honest and evidence-bound**. Every day reports `Ready`, `Limited session`
or `Not enough equipment`, names the movement families it cannot cover, and offers explicit
alternatives ("Add Bench", "Allow Barbell Bench Press") instead of padding the session with unrelated
movements. The prescription is immutable; what the user logs is a separate record.

A neighboring app could copy the split generator, but it could not truthfully claim the same thing
without also admitting what it cannot program — which is the part most apps hide behind a full-looking
exercise list.

## Operating Context

- A session is planned, performed and reviewed in one browser on one device; there is no account to
  sign into and no second device to reconcile.
- Used in a gym or home gym, often on flaky or no connectivity. Offline reopen is a real path, not a
  marketing line; media that was never loaded falls back to a labeled placeholder.
- Data lives in `localStorage` under one versioned key, roughly 5 MB, with no cloud copy. Exporting
  JSON is the only backup, and the app says so.
- Weights, volume and PRs are read after the fact in History, including correcting a set logged wrong.

## Capabilities and Constraints

Confirmed and shipped:

- Onboarding: goal, experience, days per week, primary equipment, support equipment, exclusions.
- Deterministic seeded generation that must cover the day's movement families (press, pull, squat,
  hinge, calf, core as applicable) and hard-stops when no required family can be performed.
- Equipment capabilities are separate from equipment types: owning dumbbells does not imply a bench; a
  barbell does not imply a rack.
- Double progression inside movement-specific rep ranges, with load steps taken from a recorded
  inventory when present and documented per-equipment defaults otherwise. An unfinished session
  repeats its load rather than advancing.
- Immutable `planned` sets; `performed` weight/reps/done saved on every edit; pause, resume after
  reload, finish, finish early, cancel, add/remove sets, correct history afterward.
- Versioned storage envelope with revision checks, v1 migration, validated restore with merge/dedupe,
  corrupt-data download and a recovery screen. Writes are verified, and failures are surfaced.
- Production-only service worker for the app shell and already-loaded media.
- 51-exercise catalog; 50 have photography from free-exercise-db (public domain), `nordic-curl`
  deliberately falls back to the placeholder.

Hard constraints:

- **No backend, no accounts, no cloud storage — permanently.** JSON export/restore is the only
  transfer and backup mechanism, and no feature may depend on a server.
- No URL router or per-screen deep links; one browser profile, one user.
- Kilograms only today; every stored weight is kg.
- No fabricated product evidence: no invented testimonials, user counts, or benchmarks.

Explicitly open (do not treat as decided):

- Load-inventory editing in the UI: `loads` is read for steps and rounding but can only arrive through
  a restored profile.
- Bodyweight progression beyond the rep ceiling: the model has no added-load field.
- Whether goal and experience should change programming rather than only copy and session length.
- Deload or autoregulation: a stalled lift repeats its load; no back-off week is scheduled.
- Units beyond kg.

## Brand Commitments

- **Name and tagline are placeholders.** `FITBOD·CLONE` and “Train Smarter. Live Better.” are not
  binding and must be replaced before anything ships publicly; “Fitbod” is a registered trademark.
- The durable brand commitment is the **voice**: plain, specific, and honest about limits. The app
  states what it cannot do (missing equipment, capped progression, no cloud copy) rather than hiding
  it, and it never fixes a shortfall silently.

## Evidence on Hand

- Working app and source in this repository; `npm run dev` runs it with no configuration.
- `README.md` (capabilities, storage contract, known limitations), `AUDIT.md` (reproduced Phase 1
  defects and their resolutions), `HANDOFF.md` (architecture, guarantees, verification results, Phase 2
  decisions), `tests/` (41 passing regression tests).
- `public/exercises/` — 100 photographs (two frames each) for 50 exercises, from free-exercise-db.
- No real user base, usage data, testimonials, pricing, or third-party validation exists. Future work
  must not imply any.

## Product Principles

1. **Never invent capacity.** If the kit cannot train a movement family, say so and offer a named
   alternative. A shorter, honest session beats a full-looking wrong one.
2. **The prescription is a contract.** Logging edits what happened, never what was planned; the same
   generated session must produce the same numbers on reload.
3. **No silent failure.** Storage errors, quota limits, stale tabs and unreadable data all surface,
   with a recovery path rather than a blank screen.
4. **Local-first is the product, not a limitation to apologize for.** Offline use and a portable export
   are features; nothing may quietly require a server.
5. **Progression is earned.** Load only moves on completed work inside the rep range, against the most
   recent completed session for that exercise.
