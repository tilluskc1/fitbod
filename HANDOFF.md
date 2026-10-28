# Fitbod Clone — Engineering Handoff (Phase 1 complete)

A current, verified reference for anyone picking this project up. Phase 1 was an audit plus
reliability work: equipment feasibility, workout integrity, persistence, offline behaviour, tests,
and documentation. Phase 2 has started with the progression policy: sets now carry a load and rep
target derived from the last completed session (double progression). **No AI coach, deload model,
load-inventory editor, or redesign has been added.**

---

## 0. Snapshot

| Fact | Value |
|---|---|
| What it is | Local-first strength-training web app, Fitbod-style workflow, original code |
| Location | `/Users/krishna/Downloads/Projects/Fitbod` |
| Stack | Vite 8.3.5, React 19.3.1, TypeScript 7.0.2; no UI library, router, or state library |
| Runtime used | Node 26.12.0, npm 11.20.0, macOS arm64 |
| Source size | 5,702 lines across `src/**/*.{ts,tsx,css}` (23 files) |
| Exercise DB | 51 exercises, 10 muscle groups, 6 primary equipment types, 6 support types |
| Media | 100 JPEGs in 50 directories; 50/51 exercises have demos (`nordic-curl` has none) |
| Build output | JS 302.93 kB (90.74 kB gzip), CSS 17.43 kB (4.08 kB gzip), HTML 0.47 kB |
| Build status | `npm run build` passes (`tsc -b && vite build`) |
| Lint status | `npm run lint` → **0 errors, 0 warnings** |
| Tests | **41 passing**, `node --test` |
| Persistence | `localStorage` key `fitbod-clone-v1`, versioned envelope, single user, no backend |
| Dev | `npm run dev` → http://localhost:5173 |

```bash
npm install
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build
npm run preview    # serve dist/ (required for the service-worker/offline check)
npm test           # node --test tests/*.test.ts
npm run lint       # oxlint
node scripts/fetch-media.mjs   # re-fetch/refresh exercise media (manual)
```

`public/sw.js` registers only in production builds (`import.meta.env.PROD`). It is not active during
`npm run dev`.

---

## 1. What Phase 1 fixed (root causes, not symptoms)

| Original defect | Root cause | Fix |
|---|---|---|
| Kettlebell-only Push silently returned 3/6 exercises | `picked.slice(0, count)` with no shortfall signal and no coverage model | Coverage-first selection; explicit `limited`/`infeasible` states; zero-exercise hard stop |
| Goblet Squat appeared on Pull and Legs | Relevance matched **any** muscle tag, so secondary `Core` leaked a quad exercise into other days | Relevance uses the **primary** muscle only |
| Bodyweight Legs returned 6 exercises, 4 of them core, calves uncovered | Selection counted exercises, never movement families | Day requirements are movement families; core is capped; calf gap is reported |
| “Dumbbells + bench” could not be expressed; bench/rack/pull-up bar/dip bars did not exist | One `equipment` enum per exercise and no support model | `needs: Capability[]` + separate `support` profile field; bench/rack/bar/dips/box/ab-wheel |
| Typed/logged sets were lost on reload | `WorkoutView` kept a local draft and only emitted on Finish; `App` persisted the untouched generated object | Logging writes through to `AppState.current`, which saves on every change |
| Prescription and performance were the same data | One `sets: SetLog[]` array mutated by the logger | `planned` (immutable) + `performed` (editable) per exercise |
| Repeated Finish could prepend duplicates | `finishWorkout` prepended unconditionally | `applyFinish` accepts only the active session id and dedupes by workout id |
| Malformed saved state blanked the app | `loadState` cast unchecked JSON; no validation or error boundary | Strict schema validation, path-specific errors, recovery screen, error boundary |
| Write failures were silent | `saveState` swallowed all exceptions | Revision check, write verification, quota/stale/unavailable errors, retry/export UI |
| No migration, export, restore, or conflict handling | None existed | v1→v2 migration with backup, export/restore with validation + merge/dedupe, revisioned saves |
| No offline path | No service worker | Production SW caches shell + loaded media; uncached media uses the text placeholder |

The v1 storage key was kept stable; schema v2 lives **inside** the envelope, so existing data was not
reset. The real legacy blob used for testing is preserved at `tests/fixtures/v1-state.json`.

---

## 2. Current behaviour

### Screens

1. **Onboarding** — goal, experience, days/week, primary equipment, support equipment.
2. **Home** — weekly/lifetime stats, next workout with feasibility preview and alternatives, full
   split, editable training setup, recent activity, data tools.
3. **Workout** — a prescribed load and rep target per exercise (with a one-line reason), prescribed vs
   performed sets, per-set weight/reps/done, add/remove set, live volume and progress, pause, cancel,
   finish, finish early.
4. **Library** — 51 exercises, search, muscle filters, instructions, per-exercise exclusion.
5. **History** — completed sessions, early-finish marker, per-set corrections, delete.

### Day coverage requirements

Derived from the day name (`src/lib/feasibility.ts`), not from an exercise count:

| Day | Must cover |
|---|---|
| Push | press, triceps extension |
| Pull | pull, biceps flexion |
| Legs | squat/lunge, hinge/hip extension, calf raise |
| Upper | press, pull, triceps extension |
| Lower | squat/lunge, hinge/hip extension, calf raise |
| Full Body A | press, pull, squat/lunge, hinge/hip extension |
| Full Body B | press, pull, hinge/hip extension, core |

A day with **zero** covered requirements is `infeasible` and returns **zero** exercises. Core-only
accessory lists never count as a workout.

### Selection

`generateWorkout(profile, day, dayIndex)`:

1. Pool = exercises whose complete `needs` are provided, are not excluded, and whose **primary**
   muscle is in the day’s focus.
2. Deterministic seeded shuffle (`seed = 7 + dayIndex * 13`, LCG `s = (s * 9301 + 49297) % 233280`).
3. Cover each required movement family first.
4. Fill with compound movements first (stable sort preserves seeded order as the tiebreaker), using
   movement patterns not already used.
5. If slots remain, allow a second variation of an already-used pattern.
6. Limits: at most **2 per primary muscle**, at most **2 per pattern**, and at most **1** of each core
   pattern. This is what prevents “six exercises, four of them core”.
7. Target count: Beginner 5, Intermediate 6, Advanced 7.

`feasibility.status`:

- `ok` — all required families covered and target count met.
- `limited` — viable but incomplete; the reason names the missing families or the count shortfall.
- `infeasible` — no covered requirement (or no exercise at all); start is blocked.

`limited`/`infeasible` always carries alternatives when a constraint can be changed: allow an excluded
exercise, add a capability (equipment or support), or both. Alternatives are recommendations only —
the app never applies them itself. When coverage is already complete but the count is short, the
alternatives describe exercises the change would **add**, not coverage it would restore.

### Progression (`src/lib/progression.ts`)

Double progression was chosen over linear load+reps and RPE/autoregulation because it needs no RPE
input and works for both fixed dumbbells and plate loading.

| Rep range | Movement class |
|---|---|
| 6–10 | compound: presses, pulls, squat, lunge, hinge, hip extension |
| 8–12 | knee extension / knee flexion |
| 10–15 | accessories: arms, delts, calves, core |

Rules, in order:

1. **No history** → weight `0`, reps `range.min + 2`, note says the load was not prescribed. The app
   never guesses a starting weight.
2. **Every planned set done at ≥ `range.max`** → add one step, reps restart at `range.min`.
3. **All sets done but below `range.max`** → same load, one more rep (capped at `range.max`).
4. **Sets missing, or no set logged** → same load, same or lowest completed reps. An unfinished
   exercise is never rewarded with more weight.

The load step is the smallest gap in `Profile.loads[equipment]` when an inventory exists, otherwise a
documented default: barbell 2.5 kg, dumbbell 2.5 kg, kettlebell 4 kg, machine 5 kg, cable 2.5 kg,
bodyweight 0. With an inventory the prescription snaps up to the next selectable load and holds at the
heaviest one; without one it rounds up to the step grid, never down.

The most recent **completed** session containing the exercise is the only source; active sessions and
unrelated workouts are ignored. The heaviest completed set supplies the working weight. The result is
stored in `planned` exactly like Phase 1, so logging still cannot mutate the prescription, and the
Workout screen shows why the numbers are what they are. History marks **PR** when an exercise’s top
logged load beats every earlier record for that exercise.

Deliberately not implemented here: deloads, RPE, per-exercise custom steps, added load for bodyweight
work, lb units, and a load-inventory editor.

### Logging semantics

- `planned` is written once and never mutated by logging.
- `performed` edits save immediately; `completedAt` is recorded when a set is marked done and cleared
  when unmarked.
- **Pause** keeps the session active and returns Home; reload auto-resumes into the Workout tab.
- **Finish** files the session once. With incomplete sets it confirms first and records
  `completedEarly: true`.
- **Finish Early** is an explicit confirmation path to the same outcome.
- **Cancel** discards the active session after confirmation; history is untouched.
- **Corrections** in History edit `performed` only; the prescription is shown, not rewritten.
- Add/remove set keeps `planned` and `performed` the same length; the last set cannot be removed.

### Persistence and recovery

- Envelope: `{ app, schemaVersion: 2, revision, savedAt, state }`.
- Every save takes the expected revision; a newer stored revision is refused (`stale`) instead of
  clobbered. The write is read back and verified.
- `storage` events adopt newer data in a clean tab. If this tab has an unsaved change, a conflict
  banner offers “Reload latest” or “Export this tab”.
- v1 data is migrated in place, preserving workout ids, dates and values. The original is copied to
  `fitbod-clone-v1:legacy-backup`.
- Unreadable data is never overwritten on load. The Recovery screen can download the original, restore
  a backup, or explicitly start fresh (original copied to `fitbod-clone-v1:corrupt-backup`).
- Export writes `{ app, schemaVersion, exportedAt, state }`.
- Restore validates first, then merges: history dedupes by workout id, local-only workouts are kept,
  profile/plan come from the file, and an unrelated active session is never discarded. Restoring the
  same file twice is a no-op for history.
- `loads` (the loads actually selectable per equipment) is stored, validated and exported, and now
  supplies both the progression step and the snap target. Without it the per-equipment defaults apply.

### Offline

`public/sw.js`:

- Caches `/`, `/index.html`, `/favicon.svg` on install.
- Navigation: network first, cached shell on failure **or any non-OK response** (a proxy 502 is
  treated as offline).
- Subresources: cache first, then network with a 4 s bound; successful images/scripts/styles/fonts are
  added to the cache.
- Uncached media returns a failure, and `ExerciseMedia` renders a named placeholder.

---

## 3. File map

```
Fitbod/
├─ index.html
├─ public/
│  ├─ sw.js                       # production-only offline shell
│  └─ exercises/<id>/0.jpg,1.jpg  # 100 images in 50 dirs
├─ scripts/fetch-media.mjs        # manual media pipeline
├─ tests/
│  ├─ fixtures/v1-state.json      # real legacy blob
│  ├─ generator.test.ts
│  ├─ progression.test.ts
│  ├─ session.test.ts
│  └─ storage.test.ts
└─ src/
   ├─ main.tsx                    # root + ErrorBoundary + PROD SW registration
   ├─ App.tsx                     # state container, save orchestration, recovery, nav
   ├─ index.css                   # full design system (~1,490 lines)
   ├─ types.ts                    # v2 domain types
   ├─ data/exercises.ts           # 51 exercises with pattern/needs; options; lookup
   ├─ data/media.json             # exerciseId → { frames, source }
   ├─ lib/
   │  ├─ capabilities.ts          # equipment/support → capability sets
   │  ├─ feasibility.ts           # requirements, coverage, alternatives
   │  ├─ generator.ts             # seeds, selection, planned/performed creation
   │  ├─ progression.ts           # rep ranges, load steps, next prescription
   │  ├─ session.ts               # pure session transitions + idempotent finish
   │  ├─ storage.ts               # envelope, migration, revisioned saves, export/merge
   │  ├─ validate.ts              # strict v2 validation + v1 migration
   │  └─ download.ts              # browser download helper
   └─ components/
      ├─ Onboarding.tsx
      ├─ Dashboard.tsx
      ├─ WorkoutView.tsx
      ├─ Library.tsx
      ├─ HistoryView.tsx
      ├─ ExerciseMedia.tsx
      ├─ FeasibilityPanel.tsx
      ├─ DataTools.tsx
      ├─ Recovery.tsx
      └─ ErrorBoundary.tsx
```

No router: `tab` is a `useState` union. No context: state is owned by `App` and passed one level.
`ErrorBoundary` wraps the app at the root.

---

## 4. Data model (`src/types.ts`)

```ts
type Equipment = 'Barbell'|'Dumbbell'|'Machine'|'Cable'|'Kettlebell'|'Bodyweight';
type SupportEquipment = 'Bench'|'Rack'|'Pull-up bar'|'Dip bars'|'Box'|'Ab wheel';
type Capability = 'barbell'|'dumbbell'|'machine'|'cable'|'kettlebell'
                | 'bench'|'rack'|'pull-up-bar'|'dip-bars'|'box'|'ab-wheel';

interface Exercise {
  id; name; muscles: MuscleGroup[]; equipment: Equipment;
  pattern: MovementPattern; secondaryPatterns?: MovementPattern[];
  needs: Capability[]; instructions: string;
}

interface Profile {
  goal; experience; daysPerWeek;
  equipment: Equipment[]; support: SupportEquipment[];
  exclusions: string[]; loads: Partial<Record<Equipment, number[]>>;
}

interface WorkoutExercise {
  exerciseId; name;
  planned: { weight; reps }[];           // immutable prescription
  performed: { weight; reps; done; completedAt }[];
}

interface WorkoutRecord {
  id; date; name; dayIndex;
  status: 'active'|'completed';
  completedEarly: boolean; endedAt: string|null;
  exercises: WorkoutExercise[];
}

interface AppState { profile: Profile|null; plan: PlanDay[]; history: WorkoutRecord[]; current: WorkoutRecord|null }
```

Primary muscle is `muscles[0]`; the UI and relevance logic both rely on that order. `name` is
denormalized into records so history survives catalog edits.

---

## 5. Verification (Phase 1)

### Commands and results

```
npm test        → 41 pass, 0 fail (Node test runner)
npm run build   → PASS, 36 modules, JS 302.93 kB (90.74 gzip), CSS 17.43 kB (4.08 gzip)
npm run lint    → 0 errors, 0 warnings
```

### Regression coverage

- Equipment: kettlebell-only Push `limited` with 2 bodyweight presses; kettlebell-only Pull
  `infeasible` with a Pull-up bar alternative; bodyweight Pull `infeasible`; bodyweight Legs does not
  pad with four core movements and reports the calf gap; full kit and common home kit both reach 6/6.
- Constraints: exclusions respected and surfaced; no barbell/rack needs leak into a dumbbell+bench
  profile; deterministic output for the same seed; limited/infeasible days always offer an alternative.
- Progression: first prescription invents no load; one step after finishing at the top of the range;
  rep climb below the top; unfinished/no-set sessions repeat; the newest completed session wins (an
  active session with a bigger weight is ignored); inventory steps and snapping; bodyweight holds;
  generation copies the prescription into `planned` and pre-fills `performed`.
- Session: immutability of planned data, timestamps, add/remove, progress, early flag, repeated Finish,
  stale id, cancel, history correction.
- Storage: real v1 fixture migration, corrupt preservation, stale revision refusal, quota failure,
  unavailable storage, export round-trip, malformed restore rejection, restore dedupe, local-only and
  active-session merge, forced recovery with forward revision.

### Live browser checks (desktop Chromium, dev server and preview)

- Full onboarding with Barbell/Dumbbell/Machine/Cable + Bench/Rack/Pull-up bar → Push reads `Ready`.
- Start → type `22.5 kg × 8` → mark done: header `1/22 sets · 180 kg volume`, storage at revision 7,
  and `planned` unchanged (logging never rewrites the prescription).
- Reload: lands on Workout, same six exercises, same values, revision unchanged → resume, no
  regeneration.
- Finish twice back-to-back: exactly one history record, `status: completed`, `completedEarly: true`,
  `current: null`.
- History correction `25 kg` saves immediately and does not touch `planned`.
- Bodyweight-only Pull → `Not enough equipment`, start disabled, “Add Pull-up bar / Barbell / Cable /
  Dumbbell” alternatives. Applying one flips the day to `Limited session` and enables start.
- Malformed restore (`{not json`) → “Not valid JSON. Nothing was changed.”; schema-invalid restore
  (missing `plan`) → `state.plan: expected an array`; storage revision and history unchanged.
- Valid re-import → “0 new workouts · 1 already present”, one unique id.
- Two tabs: a change in either tab is adopted by the other without a reload (revisions 16/17 verified).
- Production preview: SW installs, shell + JS/CSS cached, server stopped, reload renders the app from
  cache; offline logging (`30 kg × 10`) persists and survives another offline reload.
- Progression round-trip (dev server, seeded state): a completed Push with Barbell Bench Press at
  4 × 10 @ 60 kg produced `Prescribed: 4 × 6 reps @ 62.5 kg` with inputs pre-filled at 62.5/6 and the
  note “Oct 20: 4 sets at 10 reps, 60 kg. One step up (+2.5 kg); reps restart at 6.” Logging those four
  sets (header `4/22 sets · 1500 kg volume`) and finishing marked `1 PR`; starting Push again produced
  `4 × 7 reps @ 62.5 kg` with “lowest set 6 reps. Add a rep before adding load.” No console errors.

### Environment-limited checks

- **Uncached media fallback over a dead origin.** The in-app browser leaves image requests pending when
  the origin is down (direct `fetch` returns 502 in ~7 ms, but image loads never settle). The fallback
  handler was verified by dispatching an image `error` event: the card switches to the named
  placeholder. A real browser with a rejected image request follows the same path, but that exact
  network transition was not observable here.
- Real iOS/Android browsers, Safari private mode, and true 3G/airplane-mode behaviour.
- Screen-reader and contrast audit (roles and labels exist; no formal audit).
- Long-history behaviour at the 5 MB localStorage boundary.

---

## 6. Remaining defects and limitations

1. **Bodyweight progression stops at the rep ceiling.** There is no added-load field, so push-ups,
   pull-ups, and planks hold at `range.max` forever.
2. **No load-inventory editor.** `loads` drives steps and rounding, but only a restored/imported
   profile can supply it; otherwise the per-equipment defaults apply. Units (kg only), whether the
   list means available loads or increments, and the input UX are still undecided.
3. **No deload or autoregulation.** A stalled lift repeats its load; nothing backs off.
4. **PR means heaviest logged load.** Volume, rep, and estimated-1RM records are not tracked.
5. **`goal` is cosmetic.** It does not alter rep ranges, rest, or volume.
6. **Media coverage is 50/51**; `nordic-curl` always shows the placeholder.
7. **Offline media is best-effort** and only caches what was already loaded. The SW is production-only.
8. **No router/deep links.** Refresh returns to the active session or Home, not an arbitrary tab.
9. **Cross-tab handling is last-writer-wins with refusal**, not a merge UI. A clean tab auto-adopts;
   a tab with a failed write shows a banner and must export/reload.
10. **`navigator.storage.estimate()` can report `0 B`** for localStorage in some Chromium states; it is
   informational only. The app’s own byte estimate is the reliable number.
11. **No CI.** Gates are manual commands.
12. **Branding must change** before any public deployment; “Fitbod” is a registered trademark.

---

## 7. Phase 2 decisions needed

1. ~~**Progression policy (blocking).**~~ **Decided and implemented:** double progression with
   movement-class rep ranges, success = every prescribed set completed at the top of the range,
   failure/partial = repeat the load, per-equipment steps from `loads` or documented defaults.
   Still open inside this decision: deloads, RPE/autoregulation, and added load for bodyweight work.
2. **Load calibration and inventory.** `loads` is now consumed, but there is no UI. Decide unit
   support (kg/lb), whether the list means selectable loads or increments, and how the user enters a
   dumbbell rack or machine stack without typing 30 numbers.
3. **Goal-driven programming.** Decide how `goal` changes rep ranges, volume, rest, and exercise
   selection without building a large rules engine. Phase 1 deliberately leaves this untouched.
4. **Supported equipment catalog.** Decide whether to add bands, specialty bars, Smith machines,
   benches with limited incline, etc., and whether support gear is ever inferred. The current rule is
   strict: never infer support equipment.
5. **Session experience.** Rest timer, warm-ups, supersets, and RPE are absent. Choose what belongs in
   Phase 2 versus later.
6. **Storage scale.** localStorage is fine for a long single-user history but not for media or
   multi-device. Decide whether IndexedDB, a backend, or export-only is acceptable.
7. **Branding and distribution.** Rename, replace the tagline, and confirm media licensing before
   publishing. No Fitbod assets or code are used; media is free-exercise-db (public domain).
8. **Verification harness.** Decide whether to add Playwright (or similar) for the browser journey that
   the in-app browser could not fully cover (offline image failure, real device, CI).

---

## 8. Provenance and constraints

- **Code/CSS:** original for this project.
- **Media:** [free-exercise-db](https://github.com/yuhonas/free-exercise-db), public domain / Unlicense.
  Not Fitbod media.
- **Fitbod reference:** only the installed app’s bundle metadata/module names informed the feature
  list; no code, nibs, strings, `.car` assets, or API data were copied. Further native internals are not
  recoverable here (no decompiler/Xcode).
- **Naming:** `FITBOD·CLONE` and `Train Smarter. Live Better.` are placeholders and not safe to ship.
- **Stack constraints:** client-side only; no account, server, database, or CI. Web target is
  deliberate.

---

## 9. One-line summary

A verified, local-first strength-training app with honest equipment feasibility, double-progression
prescriptions derived from logged history, immediate and idempotent workout logging, validated
migration/restore, and a working offline shell — still without an AI coach, deload policy, or rebrand.
