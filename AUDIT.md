# Phase 1 — Repository Audit

Baseline captured before any change. Evidence is file:line plus live reproduction in the running app
(dev server on `http://localhost:5173`, Chrome via the in-app browser).

## 0. Instruction sources read

| Source | Result |
|---|---|
| `AGENTS.md` in repo | **Absent** — searched repo root, `..` and `/Users/krishna` to depth 4. No repository agent instructions exist to follow. |
| `HANDOFF.md` (293 lines) | Read in full. Claims re-verified below; several are wrong or optimistic. |
| `README.md` | Default Vite template text — no project information. |
| REA skill (`reverse-engineer-anything`) | Loaded. Its routing rule: for a **complete source repository**, use normal repository tools and do not run REA readiness/provider commands. No REA command was run for this audit. |
| `package.json` | `dev`, `build`, `lint`, `preview`. **No `test` script, no test framework installed.** |

## 1. Baseline checks (before change)

```
npm run build  → PASS   dist/index.html 0.47 kB, CSS 11.35 kB (2.89 gzip), JS 256.93 kB (77.75 gzip)
npm run lint   → 0 errors, 2 warnings
                 src/components/Dashboard.tsx:26 react(purity)         new Date() during render
                 src/components/ExerciseMedia.tsx:43 react(set-state-in-effect)
tests          → none exist, no runner configured
```

## 2. Claim verification

| Handoff claim | Verdict | Evidence |
|---|---|---|
| Five screens | **True** | `src/components/`: Onboarding, Dashboard, WorkoutView, Library, HistoryView (+ `ExerciseMedia` shared, not a screen). |
| 51 exercises | **True** | `grep -c "id: '" src/data/exercises.ts` → 51. |
| 100 images | **True, but 50 exercises** | `find public/exercises -name '*.jpg'` → 100; 50 directories × 2 frames; `media.json` has 50 entries. `nordic-curl` has none. |
| Seeded generator | **True** | `generator.ts:42-51` LCG `s=(s*9301+49297)%233280`, seed `7 + dayIndex*13` (`:60`). |
| Kettlebell-only failure | **True, cause different from the handoff** | See §3. |
| "In-progress workouts persist and can be resumed" | **Misleading** | The *generated plan* persists; logged edits do not (see §4). |
| "No migration path" | **True** | `storage.ts:5-12` parses straight into `AppState` with no validation. |
| "2 lint warnings" | **True** | Reproduced verbatim. |

## 3. Equipment feasibility — reproduced defect

Ran the **live** generator module in the page (`import('/src/lib/generator.ts')`), Intermediate profile, 3-day split:

| Kit | Push | Pull | Legs |
|---|---|---|---|
| `['Kettlebell']` | 3 exercises (wanted 6) | 6 | 6 |
| `[]` (nothing) | 3 | 6 | 6 |
| `['Bodyweight']` | 3 | 6 | 6 |
| Full kit | 6 | 6 | 6 |

Three distinct defects, none of which are an exception:

1. **Silent shortfall.** `generateWorkout` ends with `picked.slice(0, count)` (`generator.ts:73`). When the pool is smaller than the target there is **no signal at all** — a Beginner gets a 3-exercise Push day that looks like a normal workout. This is the actual "kettlebell-only failure".
2. **Wrong-day leakage.** Kettlebell-only *Pull* day contains **Goblet Squat** (and Legs contains it too) because matching is `e.muscles.some(m => day.focus.includes(m))` (`generator.ts:57`) and Goblet Squat's secondary `Core` tag intersects the Pull/Legs focus. No movement/pattern model exists to prevent a squat landing in a pull day.
3. **Count is not coverage.** Bodyweight *Legs* day returns 6 exercises of which **4 are core** (Russian Twist, Plank, Ab Wheel, Hanging Leg Raise) and 2 are legs; calves get zero work. An exercise-count threshold would call that session healthy.

Structural cause: `Exercise.equipment` is a single enum (`types.ts:13-19`, `:21-27`). There is **no bench, rack, pull-up bar, or dip-bar concept**, so "dumbbells + bench" cannot be expressed, and a user who owns a barbell but no bench is offered Barbell Bench Press. `Profile` has no exclusions and no load information (`types.ts:32-37`).

## 4. Workout integrity — reproduced defect

Live journey on the real stored session: typed `22.5` into set 1 of a Pull day and pressed the set-complete check.

```
UI after interaction : weight input "22.5"
localStorage         : {"weight":0,"reps":10,"done":false}   ← unchanged
after reload         : header "0/18 sets · 0 kg volume", weight "" , check off
```

Root cause: `WorkoutView` copies the workout into local `useState` (`WorkoutView.tsx:20`) and only emits it on Finish (`:137`). `App` persists `state.current.workout`, which is the untouched generated object (`App.tsx:37-44`). Every logged set lives only in component memory.

Consequences and related defects:

| Behaviour | Status | Evidence |
|---|---|---|
| Draft edits survive reload | **Broken** | above |
| Completed sets saved promptly | **Broken** | nothing is written until Finish |
| Prescription separated from performed values | **Missing** | one `sets: SetLog[]` (`types.ts:45-49`) |
| Repeated Finish → one session | **Broken (latent)** | `finishWorkout` prepends unconditionally, no id check (`App.tsx:47-50`) |
| Resume interrupted session | **Partial** | plan survives, work does not; reload always lands on Home (`App.tsx:18`) |
| Pause / finish-early / cancel / correct | **Missing / partial** | only Cancel and Finish; Cancel silently discards (`App.tsx:52-55`) |
| Stale revision / concurrent tab detection | **Missing** | no revision, no `storage` listener |
| Write failure surfaced | **Broken (silent)** | `saveState` swallows all errors (`storage.ts:14-20`) |

## 5. Persistence and recovery

| Capability | Status | Evidence |
|---|---|---|
| Storage used | **Implemented (localStorage)** | single blob, key `fitbod-clone-v1`, 2 419 bytes with 1 history entry + 1 active session |
| Schema version | **Missing** | envelope has no version (`types.ts:68-73`) |
| Migration | **Missing** | `loadState` casts unchecked JSON (`storage.ts:8`) |
| Validation / corruption handling | **Broken** | injected a shape-valid record with `plan` missing → app renders **blank** (`#root` children 0), `TypeError: Cannot read properties of undefined (reading 'length')` in Dashboard. No error boundary. |
| Failed-write UI | **Missing** | success is assumed |
| Export / restore | **Missing** | no code path |
| Offline reopen | **Missing** | no service worker, no manifest (`public/` = `favicon.svg`, `icons.svg` only) |
| Media fallback | **Implemented** | `ExerciseMedia.tsx` renders a text placeholder on image error — good base for uncached media |

## 6. Load progression vs exercise selection

**Separate and both absent for load.** Selection is a deterministic pool filter + seeded shuffle + compound-first pick. Load progression does not exist: sets are generated as `{weight:0,reps:10,done:false}` (`generator.ts:76`), previous weights are never read, and `history` is only used for counts and volume display. `goal` affects nothing but the Dashboard greeting (`Dashboard.tsx:41`); `experience` only changes exercise count (`generator.ts:54`).

## 7. Classification summary

**Implemented:** onboarding → split → generation → logging UI → history; seeded deterministic selection; localStorage persistence of plan/history/generated session; media with text fallback; 51-exercise catalog.

**Partial:** resume (plan only), library filters, volume display.

**Broken:** draft/completed-set persistence, silent equipment shortfall, silent write failure, unvalidated load, duplicate-finish path, reload navigation.

**Missing:** feasibility states and alternatives, movement coverage, exclusions, equipment requirements beyond one enum, prescription/performance split, schema migration, export/restore, offline shell, concurrency protection, tests.

**Unverified (baseline):** true offline behaviour (no SW existed), real-device behaviour (no device/emulator available), cross-tab conflict (no mechanism existed to test).

---

## 8. Post-audit resolution (Phase 1 complete)

The defects above were fixed without replacing the seeded generator, changing the stack, or adding a
progression policy. Current architecture and guarantees are documented in `HANDOFF.md`.

| Baseline defect | Resolution | Verified by |
|---|---|---|
| Silent shortfall (3/6 Push) | Coverage-first selection, `limited`/`infeasible` states, blocked start when infeasible | `tests/generator.test.ts` (kettlebell/bodyweight/full/home kit) |
| Goblet Squat on Pull/Legs | Relevance uses primary muscle only | generator tests; full-kit Pull/Push lists |
| Count is not coverage | Movement-family requirements; core capped at one per pattern; zero-coverage hard stop | bodyweight Legs test; live `Limited session` copy |
| No support equipment / bench implied | Capability `needs` + separate `support`; never inferred | dumbbell+bench test; onboarding and dashboard chips |
| Logged sets lost on reload | Performed sets save through `App` on every edit | live: `22.5 × 8` persisted, reload resumed, revision unchanged |
| Prescription mutated by logging | `planned` / `performed` split | session tests; live correction kept `planned` at `0 × 10` |
| Duplicate Finish | `applyFinish` requires active id and dedupes by id | session tests; live double-click → one record |
| Blank app on bad data | Strict validation, path-specific errors, recovery screen, error boundary | storage tests; live malformed/schema-invalid restore rejected |
| Silent write failure | Revision check, read-back verification, quota/stale UI | storage tests (stale, quota, unavailable, verify) |
| No migration/export/restore | v2 envelope + v1 backup, export, validated merge/dedupe | storage tests + live export/restore |
| No offline path | Production SW: shell cache, non-OK navigation fallback, 4 s asset bound, media text fallback | live preview: server stopped, reload rendered, offline logging survived |
| No tests | Node test runner; 30 tests | `npm test` 30/30 |

Final gates: `npm run build` PASS (JS 298.68 kB / 89.16 gzip, CSS 17.33 kB / 4.06 gzip),
`npm run lint` 0 errors / 0 warnings, `npm test` 30 pass.

Newly discovered during verification: a common home kit (barbell/dumbbell/machine/cable + bench/rack/
pull-up bar) could hit a 5/6 limit and offer no alternatives; selection now prefers compounds when
filling, and alternatives cover count shortfalls as well as missing coverage. A proxy 502 on
navigation and hanging image requests also exposed two offline gaps; both are handled in `sw.js`.

Remaining unverified: uncached-media failure over a truly dead origin in the in-app browser (image
requests stayed pending; the component fallback was verified via an `error` event), real mobile
browsers, and storage limits in private mode.
