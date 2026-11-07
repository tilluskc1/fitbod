# Home Strength — handoff for a fresh chat (product + tech)

State as of **2026-11-07**, verified against `origin/main` at **`fa2e83b`** plus this doc update.
Repo: `tilluskc1/fitbod`. Board: GitHub Project 11. Design system: `DESIGN.md`.

> The older `HANDOFF.md`, `README.md`, `PRODUCT.md` and `AUDIT.md` describe **Phase 1**
> (41 tests, kg only, 5 screens). They are stale. Trust this file.

---

## 1. Product

**What it is.** A phone-first, local-first strength-training web app for one lifter training
mostly at home with limited kit (dumbbells + bench, kettlebell only, etc.). Onboard once,
see today's workout, log sets one-handed, review progress. No account, no server.
Public name: **Home Strength** (the trademarked name was removed, #145).

**Promise.** It never invents capacity.
- Every day says `Ready`, `Limited session` or `Not enough equipment`. `Limited` only for a real gap:
  a required movement is missing, a focus muscle has no exercise the kit can do, or the gear cannot
  fill half the session (#67). It names the gap and offers the fix ("Add Pull-up bar"). It never pads.
- The prescription is a contract: logging records what happened, never rewrites what was planned.
- Load only goes up on completed work. A skipped or early-finished exercise repeats its target.
  When the next load is the lifter's to choose ("go heavier" with no confirmed rack), no surface
  shows last time's load as the target; the logger asks for the pick (#165).
- Minutes are honest: the time model uses the same rest the timer runs, plus a warm-up (#132).
- Storage failures surface with a recovery path. Nothing fails silently.

**Look.** Light mint system (Today v7, #142/#143): mint page, white 26px cards, lime only as a fill
with dark text, black pill primary, thin large numerals, one blue week card, photo hero. Floating
white nav pill with a lime Start/Resume in the centre. See `DESIGN.md` for tokens and rules.

### What works today

| Area | State |
|---|---|
| Onboarding | Splash → goal, experience, days, session length, equipment, support gear. lb default; kg/lb choice. First-time load prefilled from the profile. |
| Today (v7) | Greeting, one-line pill row (length · gym · Switch), photo hero with state chip, workout card, coach card, blue week card, session and lead-lift cards. Length/gym/Switch sheets show the consequence of each choice. |
| Train (logger) | One tap per set, How-to / History / Replace pills, header shows target and **rest by role**, rest timer with sound + vibration, first-weight step, go-heavier step, skip/swap/discard. Replace lists ranked swaps that never duplicate, pair incompatible moves, or exceed the day's pattern cap (#177). |
| Plan / Progress / Coach / Recap | Weekly split, real-sets-only charts, recap names every next target and says unfinished work repeats. |
| Programming | Lead → other compounds (heavy barbell first, single-leg last) → isolation → core (#133, #174). Rep ranges by role: barbell lead 4–6 (strength 3–5), dumbbell/kettlebell lead 6–10, compounds 6–10, isolation 10–15, small muscles 12–20, bodyweight 10–20 (pull-ups/dips 6–10), Nordic 3–6, swing 12–20. Pull days back-first (2+ back moves, 1 curl), no rear-delt work on Push (#155). |
| Time model | Rest: lead 150 s (strength 180), compounds 120 s, isolation 75 s, core 60 s; under 30 min the short end of each range. Session = warm-up (5 min, 3 under 30) + 35 s work per set + rest between sets + 90 s per exercise. |
| Catalog | 62 exercises, each with two demo frames. Home basics added: Dumbbell RDL, Dumbbell Calf Raise, Dumbbell Pullover, Kettlebell Swing/Row/Press, Bodyweight Squat/Lunge (#174). |
| Basics coverage | 60-min weeks cover squat, hinge, single-leg, both pushes, both pulls, calves, arms and core with a gym **or with dumbbells + bench**. Kettlebell-only lacks vertical pull, calves and arms; bodyweight-only lacks pulls, overhead press and calves (honest Limited states). |
| Accessibility | Sheets trap focus and make the page inert, Escape returns focus (#153); dark focus ring at 15–18:1 (#168); 44px targets. |
| Data safety | Versioned `localStorage` envelope, revision checks, verified writes, migration, validated export/restore, Recovery screen. |

### Not built (by design or not yet)

- No AI coach, accounts, sync or second-device restore. **Cloud track is only issues** (#13, #14, #42–#46).
- No supersets (#88), no recovery-based day choice (#134), no deload.
- Bodyweight calf raise and pike push-up have no demo photos in the source library, so they are not in the catalog.

---

## 2. Tech

| Fact | Value |
|---|---|
| Stack | Vite 8.3.5, React 19.3.1, TypeScript 7.0.2. No router, UI library or state library. |
| Source | ~12.1k lines TS/TSX in `src/**`, plus `src/index.css`. |
| Tests | **409 passing**, 59 files in `tests/`, `node --test tests/*.test.ts`. 0 fail. |
| Build | `npm run build` passes: JS 441.04 kB (129.83 kB gzip), CSS 61.76 kB. |
| Lint | `npm run lint` (oxlint) exits 0, no findings. |
| Storage | `localStorage` key `fitbod-clone-v1`, `schemaVersion` **2** (key kept on purpose; renaming it would drop users' data). |
| Hosting | Vercel project `fitbod`, now **connected to GitHub**: a push to `main` deploys production, other branches get preview URLs. Previously deployed by CLI to https://fitbod-chi.vercel.app. |

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build
npm run lint
```

### Layout

```
src/
  App.tsx              state container, save orchestration, sheets, nav
  types.ts             domain types
  screens/             Today, Train, Plan, Progress, Coach, Library, Adapt, Recap, Splash, Sheets
  components/          Onboarding, Recovery, ErrorBoundary, DurationSheet, GymSheet, SwitchSheet, ui/
  data/                exercises (62), flagship program, media.json
  lib/                 pure logic, tested without the DOM:
    generator, feasibility, capabilities, constraints   selection + honest coverage
    progression, liveProgression, firstLoad              prescriptions
    sessionTime                                          rest by role + session minutes
    adapt, proposal, replacements, preferences, switchDay adaptation, swaps, day switching
    session, sequence, plan, feedback, restCue, focusTrap session + program flow
    storage, validate, units, editDraft, download        persistence + units
public/exercises/      JPEG frames from free-exercise-db (public domain)
public/hero/today.webp owner's hero photo
```

### Decisions to keep

- Domain logic lives in `src/lib` as pure functions; screens only render and dispatch.
- Capabilities are separate from equipment: dumbbells do not imply a bench.
- `planned` is immutable; `performed` is the user's record.
- A listed dumbbell rack is a shortcut, never a cap (#129).
- One time model for the timer and every promised minute (`sessionTime.ts`).
- Everything is stored in kg internally; display units convert.

---

## 3. Process

- Issues are the source of truth. Statuses: `Todo` → `In Progress` → `Review` → `Ready to merge` → `Done`.
- Work happens on `work/<issue>-<slug>` with a draft PR; checks (build, tests, lint) and a browser
  pass at 390×844 and 360×780 before merge.
- **Only the owner approves merges to `main` and marks `Done`.** Since Vercel is connected, a merge to
  `main` is also a production deploy.
- The cloud session cannot edit Project 11 fields (GraphQL blocked) or open `*.vercel.app`; it reads
  Vercel's result from the GitHub commit check.

---

## 4. Board snapshot (2026-11-07)

- **Merged on 2026-11-07 but still open, waiting for the owner to mark Done:** #142, #143, #145, #146,
  #147, #148, #149, #150, #155 (Today v7 stack and day balance), #67 (Ready rule), and the closed-by-merge
  #132, #133, #165, #168, #174, #177. Also the older merged-but-open set: #89, #109, #116, #118, #120,
  #125, #129, #131.
- **Todo, by theme:**
  - *Cloud/AI (parked on owner decisions and keys):* #13, #14, #42–#46, #8, #29.
  - *Programming:* #134 next day by recovery, #114 heavy lead pick, #139 Face Pull jump, #93 upper/lower, #96 third chest compound, #88 supersets, #17 extending session length.
  - *Mobile polish:* #127, #128, #135, #136, #137, #107, #141.
  - *Correctness/copy:* #105 recap vs session, #106 exclusion reshuffles the day.
  - *Later:* #68 onboarding from reference, #53 media, #119 profile photo, #9–#12.

---

## 5. Open decisions (owner)

1. **Cloud vs local-first.** `PRODUCT.md` says no backend; the board has a Supabase + Gemini track. Pick one.
2. **Done sweep** of the merged-but-open issues above.
3. **Logger weight stepper.** The v7 mockup has a big −/+ stepper that carries a new weight to later sets; the real logger does not yet.
4. **Docs refresh.** README/HANDOFF/PRODUCT/AUDIT are Phase 1; rewrite or delete.
5. **Stored-data changes** still need owner approval.

## 6. Loose ends

- `docs/specs/board-changes-draft.md` is a draft of board edits, largely applied.
- `work/22-codex-workboard-hardening` (PR #23) was closed as superseded; branch kept.
- Not verified: real iOS/Android devices, screen-reader pass, the 5 MB `localStorage` limit.

---

## 7. Paste this to start the chat

```
You are helping me steer a project, not write code right now. Context below.
Home Strength: a phone-first, local-first strength-training web app (React 19, TypeScript, Vite,
localStorage, no backend). Light mint v7 design (DESIGN.md). main at fa2e83b+, 409 tests passing.
Vercel deploys main on every push. Promise: never invent capacity; prescriptions are immutable;
load only rises on completed work; minutes match the rest timer.
Open decisions: (1) cloud vs local-first, (2) Done sweep of merged issues, (3) weight stepper in
the real logger, (4) stale Phase 1 docs.
Help me with: <your question>. Ask one question at a time. Keep answers short, numbered, max 5 items.
```
