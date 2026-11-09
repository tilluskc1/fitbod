# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary:** one lifter training at a gym, at home with a specific, limited kit (for example dumbbells
  plus a bench, or a kettlebell only), or with nothing. Uses the app mid-session, on a phone, one hand
  free, with no patience for a setup flow that asks the same questions twice.
- **Secondary:** people reviewing the repository. They read the README and `docs/chat-handoff.md`
  before running it, and judge the documented decisions as much as the screen.

## Product Purpose

Home Strength: a phone-first, local-first strength-training app: onboarding → split → today's workout
→ set logging → progress.
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
  marketing line; media that was never loaded falls back to a placeholder named for screen readers.
- Data lives in `localStorage` under one versioned key, roughly 5 MB, with no cloud copy. Back up now
  (Share sheet or download) and JSON export are the only backups, and the app says so. On iPhone a Home
  Screen app has its own storage.
- Logged weights and reps are read after the fact in Progress, and a set logged wrong can be corrected.

## Capabilities and Constraints

Confirmed and shipped:

- Onboarding: name, units (lb default, kg available), goal, experience, days per week, session length,
  and gym or home kit (support equipment included). Exclusions live in the Library.
- Deterministic seeded generation that must cover the day's movement families (press, pull, squat,
  hinge, calf, core as applicable) and hard-stops when no required family can be performed.
- Equipment capabilities are separate from equipment types: owning dumbbells does not imply a bench; a
  barbell does not imply a rack.
- Goal and experience change programming: intermediate and advanced lifters who want muscle or
  strength get a five-set heavy lead; "Get stronger" uses strength ranges and rests.
- Double progression inside movement-specific rep ranges. Barbell, machine and cable step by documented
  per-equipment defaults; at home, dumbbells step to the next listed pair (onboarding or Settings); with no
  list a topped-out dumbbell or kettlebell lift asks the lifter to pick the next one up. An unfinished
  exercise repeats its target rather than advancing.
- Today-only changes (length, gear, switch day) and "Plan today with me", built through the same
  generator; the planned day stays next.
- Immutable `planned` sets; `performed` weight/reps/done saved on every edit; pause, resume after
  reload, finish, finish early, cancel, add/remove sets, correct history afterward.
- Versioned storage envelope with revision checks, v1 migration, validated restore with merge/dedupe,
  corrupt-data download and a recovery screen. Writes are verified, and failures are surfaced.
- Installable (manifest, icons, iOS standalone); production-only service worker that precaches the
  built app, so one online visit is enough to open offline.
- 62-exercise catalog, every exercise with two photographs from free-exercise-db (public domain).

Hard constraints:

- **Local-first today; the cloud track is parked, not dropped.** The owner recorded a Supabase /
  Vercel decision on 2026-10-29 (`docs/agents/story-contract.md`); until the owner restarts that track,
  no shipped feature may depend on a server, and offline logging plus portable export stay. Backup and
  restore are the only transfer mechanism.
- No URL router or per-screen deep links; one browser profile, one user.
- Weights are stored in kg and shown in the user's unit (lb or kg).
- No fabricated product evidence: no invented testimonials, user counts, or benchmarks.

Explicitly open (do not treat as decided):

- Bodyweight progression beyond the rep ceiling: the model has no added-load field.
- Deload or autoregulation: a stalled lift repeats its target; no back-off week is scheduled.
- Supersets (#88) and exercise videos.
- When and how the cloud track (accounts, sync, AI coach) restarts.

## Brand Commitments

- **Public name: Home Strength.** The trademarked working name was removed (#145); a further rename is
  the owner's open choice.
- The durable brand commitment is the **voice**: plain, specific, and honest about limits. The app
  states what it cannot do (missing equipment, capped progression, no cloud copy) rather than hiding
  it, and it never fixes a shortfall silently.

## Evidence on Hand

- Working app and source in this repository; `npm run dev` runs it with no configuration.
- `README.md` (capabilities, storage, known limitations), `docs/chat-handoff.md` (current product and
  tech handoff), `tests/` (unit tests, `npm test`) and `scripts/e2e/` (browser checks, `npm run e2e`).
  `AUDIT.md` and `HANDOFF.md` are Phase 1 history.
- `public/exercises/`: 122 photographs for 62 exercises (two frames each; the goblet squat pair is
  shared by its dumbbell and kettlebell versions), from free-exercise-db.
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
