# Fitbod Clone (working title)

A local-first strength-training web app: onboarding → split → generated workout → set logging → history.
React 19 + TypeScript + Vite, no backend, no accounts, no cloud.

> The name `FITBOD·CLONE` and the tagline `Train Smarter. Live Better.` are placeholders.
> “Fitbod” is a registered trademark and this branding is **not safe to ship** without a rename.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm run preview    # serve dist/ (used for the offline check)
npm test           # node --test tests/*.test.ts
npm run lint       # oxlint
```

Requires a modern browser with `localStorage`. Node 22.18+ (or 24+) is recommended for the test
runner’s built-in TypeScript support; verified on Node 26.

## What it does

- **Onboarding** — goal, experience, days per week, primary equipment, and support equipment.
- **Coverage-first generation** — a seeded, deterministic selector that must cover the day’s movement
  families (press, pull, squat, hinge, calf, core as applicable), respects exclusions, and refuses to
  pad a session with unrelated movements.
- **Honest feasibility states** — every day reports `Ready`, `Limited session`, or `Not enough
  equipment`, with the uncovered movement families and explicit alternatives such as “Add Bench” or
  “Allow Barbell Bench Press”. The app never silently adds equipment, relaxes exclusions, or invents a
  workout from core accessories.
- **Equipment capabilities** — owning dumbbells does not imply owning a bench, and a barbell does not
  imply a rack. Support gear is a separate profile field.
- **Progressive overload** — double progression. Each exercise climbs reps inside a
  movement-specific range (6–10 compound, 8–12 knee work, 10–15 accessory); when every prescribed set
  is completed at the top of the range the load moves up one step and reps restart at the bottom. The
  step comes from the recorded load inventory when one exists, otherwise from a documented default per
  equipment. An unfinished exercise repeats its load instead of jumping.
- **Logging** — prescribed sets are immutable; performed weight/reps/done are a separate record saved
  on every edit. Pause, resume after reload, finish, finish early, cancel, add/remove sets, and correct
  history afterwards.
- **History** — completed sessions, early-finish marker, per-set corrections, volume totals, delete.
- **Data tools** — JSON export, validated restore with merge/dedupe, corrupt-data download, recovery.
- **Offline reopen** — production builds register a small service worker that caches the app shell and
  any media already loaded. Uncached images fall back to a named text placeholder.

## Data and storage

Everything is stored in `localStorage` under `fitbod-clone-v1` as a versioned envelope:

```json
{
  "app": "fitbod-clone",
  "schemaVersion": 2,
  "revision": 42,
  "savedAt": "2026-10-27T23:00:00.000Z",
  "state": { "profile": {}, "plan": [], "history": [], "current": null }
}
```

- `revision` is checked on every write; a newer revision from another tab is not clobbered.
- A previous v1 blob is migrated in place and copied to `fitbod-clone-v1:legacy-backup`.
- Unreadable data is never overwritten on load; it can be downloaded first and is backed up under
  `fitbod-clone-v1:corrupt-backup` only after an explicit recovery action.
- `localStorage` is typically limited to about 5 MB per origin. Only workout data is stored, not
  images. Export a backup before clearing site data or moving browsers; there is no cloud copy.

## Tests

```bash
npm test
```

41 regression tests cover:

- kettlebell-only and bodyweight-only splits, hard-infeasible days, coverage instead of counting,
- full-kit and common home-kit sessions, exclusions, support-equipment isolation, determinism,
- double progression: first-time start with no invented load, load step at the top of the range, rep
  climb, unfinished-repeat, load-inventory steps and rounding, bodyweight hold, prescription wiring,
- planned/performed separation, set completion timestamps, add/remove sets, early finish,
- repeated Finish idempotency, stale session ids, cancel, history corrections,
- v1 migration from a real fixture, corrupt data preservation, revision/quota/verification failures,
- export round-trip, malformed restore rejection, restore dedupe, local-only and active-session merge.

## Known limitations

- **Bodyweight progression is capped at the rep ceiling.** The model has no added-load field, so
  push-ups, pull-ups, and planks hold at the top of their range instead of progressing further.
- **No load-inventory editor yet.** `loads` is read for steps and rounding but can only arrive through
  a restored/imported profile; otherwise the per-equipment defaults apply.
- **Kilograms only.** Every weight and volume figure is kg; there is no lb mode or unit conversion.
- **A PR means the heaviest logged load.** There is no volume, rep, or estimated-1RM record.
- **No deload or autoregulation.** A stalled lift repeats its load; nothing schedules a back-off week.
- **`goal` does not change programming yet.** Goal and experience only influence coaching copy and
  session length.
- **50 of 51 exercises have media.** `nordic-curl` deliberately falls back to a placeholder.
- **Offline media is best-effort.** Only media already loaded is cached; the rest shows the text
  placeholder. The service worker registers in production builds only.
- **One browser, one user.** No accounts, sync, router, or URL state. A clean tab adopts newer data;
  a tab with an unsaved change shows a conflict banner and can export before reloading.
- **Real-device and cross-browser storage limits are unverified.** Quota errors are surfaced, but the
  exact limit varies by browser and private mode.

## Provenance

Code and CSS are original. Exercise photography comes from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain / Unlicense), not from
Fitbod. No Fitbod code or assets are included. See `HANDOFF.md` for the full audit and provenance note.

## Project documents

- `AUDIT.md` — Phase 1 baseline, reproduced defects, and post-fix resolution.
- `HANDOFF.md` — current architecture, guarantees, verification results, and Phase 2 decisions.
