# Fitbod clone — handoff for a fresh chat (product + tech)

State as of **2026-11-06**, verified against `origin/main` at **`a22da52`**
(same SHA as the live deploy). Repo: `tilluskc1/fitbod`. Board: GitHub Project 11.

> The older `HANDOFF.md`, `README.md`, `PRODUCT.md` and `AUDIT.md` describe **Phase 1**
> (41 tests, kg only, 5 screens). They are stale. Trust this file.

---

## 1. Product

**What it is.** A phone-first, local-first strength-training web app for one lifter training
mostly at home with limited kit (dumbbells + bench, kettlebell only, etc.). Onboard once,
see today's workout, log sets one-handed, review progress. No account, no server.

**Promise.** It never invents capacity.
- Every day says `Ready`, `Limited session` or `Not enough equipment`, names what is missing,
  and offers explicit alternatives ("Add Bench"). It never pads a session.
- The prescription is a contract: logging records what happened, never rewrites what was planned.
- Load only goes up on completed work. A skipped or early-finished exercise repeats its target.
- Storage failures surface with a recovery path. Nothing fails silently.

**Who.** Primary: one lifter, mid-session, one hand free, flaky gym wifi. Secondary: people
reading the repo as a work sample.

### What works today

| Area | State |
|---|---|
| Onboarding | Splash → goal, experience, days, **session length (30/45/60)**, equipment, support gear. **lb is the default unit**; kg/lb choice. No equipment pre-selected. Owned dumbbell loads entered in the chosen unit. First-time load prefilled from the profile. |
| Today | Next workout with feasibility state, one **Start / Resume** action (also centered in the bottom nav) with Preview, coach-voice copy. |
| Plan | Weekly split, program continues through missed days, Limited/Not-enough states shown. |
| Train (logger) | One tap per set, typed load/reps, prescribed vs performed, rest timer with **audible + haptic cue**, skip remaining work (restorable), swap exercises (completed sets stay under their exercise), discard via an in-app consent sheet (no `window.confirm`). |
| Exercise sheet | Instructions, history, workout controls, preferences (more/less often, don't recommend again) stored on device. |
| Adapt | Deterministic **proposal → approve → apply**, today-only: change minutes/equipment, see original vs proposed, reasons, undo. Truthful "unavailable" states. |
| Progress | Charts one real completed set per session, never a prescription. Per-hand labels. |
| Recap | Leads with the win, weekly goal, workout-fit feedback saved with the workout. |
| Progression | Double progression, explained as previous → actual → next. Earned step goes to the **next owned load**. Early finish repeats the target. Heavy top set on the lead compound. Main lifts ranked and prescribed; time-trimming drops isolation first. |
| Library / Coach | 53 exercises with media; Coach screen exists. |
| Data safety | Versioned `localStorage` envelope, revision checks, verified writes, v1 → v2 migration, validated export/restore with merge/dedupe, Recovery screen, error boundary. Loader rejects loads above 2000 kg and reps above 1000; the logger refuses them too. |
| Offline | Production-only service worker caches the shell and already-loaded media. |

### Not built (by design or not yet)

- No AI coach, no accounts, no sync, no second-device restore. **Cloud track is only issues.**
- No deload/autoregulation. Bodyweight progression stops at the rep ceiling.
- No rest-time model (flat 75 s), no recovery-based day choice, no goal-driven programming.
- Media is not distinct for every exercise (#53). No profile photo (#119).
- **Branding is a placeholder** (`FITBOD·CLONE`). "Fitbod" is a registered trademark.

---

## 2. Tech

| Fact | Value |
|---|---|
| Stack | Vite 8.3.5, React 19.3.1, TypeScript 7.0.2. No router, UI library or state library. |
| Source | ~11.1k lines TS/TSX across `src/**`, plus `src/index.css` (large, hand-written design system). |
| Tests | **368 passing**, 49 files in `tests/`, `node --test tests/*.test.ts`. 0 fail. |
| Build | `npm run build` passes (`tsc -b && vite build`): JS 416.57 kB (123.64 kB gzip), CSS 55.27 kB. |
| Lint | `npm run lint` (oxlint) ran with no findings printed. Summary line not captured. |
| Storage | `localStorage` key `fitbod-clone-v1`, `schemaVersion` **2**, `revision` checked on every write. |
| Hosting | Vercel project `fitbod`. Public prod: **https://fitbod-chi.vercel.app**, deployed from `a22da52` (bundle `index-CnMlHPLi.js`). |

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
  App.tsx              state container, save orchestration, recovery, nav (~1k lines)
  types.ts             domain types
  screens/             Today, Train, Plan, Progress, Coach, Library, Adapt, Recap, Splash, Sheets
  components/          Onboarding, Recovery, ErrorBoundary, ui/ (Chrome, Sheet, Photo, Demo, Icons…)
  data/                exercises, flagship program, media.json
  lib/                 pure logic, tested without the DOM:
    generator, feasibility, capabilities, constraints   selection + honest coverage
    progression, liveProgression, firstLoad              prescriptions
    adapt, proposal, replacements, preferences           adaptation + swaps
    session, sequence, plan, feedback, restCue           session + program flow
    storage, validate, units, editDraft, download        persistence + units
public/sw.js           production-only offline shell
public/exercises/      JPEG frames from free-exercise-db (public domain)
```

### Decisions to keep

- Domain logic lives in `src/lib` as pure functions; screens only render and dispatch.
- Capabilities are separate from equipment: dumbbells do not imply a bench.
- `planned` is immutable; `performed` is the user's record.
- A listed dumbbell rack is a shortcut, never a cap (#129).
- Contradictory input is refused whole, not half-applied.
- Everything is stored in kg internally; display units convert.

---

## 3. Process

- Issues are the source of truth. Statuses: `Todo` → `In Progress` → `Review` → `Ready to merge` → `Done`.
- A work-board loop (`.agents/skills/orchestrate-github/`, config `.github/work-board.json`) builds one
  issue at a time on `work/<issue>-<slug>`, opens a draft PR and stops at `Ready to merge`.
- **Only the owner merges to `main`, marks `Done`, and deploys.** Never mark `Done` without 390×844
  and 360×780 screenshots.
- Deploys are manual: clean detached worktree of `origin/main`, `npx vercel link --project fitbod`,
  then `vercel deploy` (`--prod` only with the owner's go-ahead). Pushes do not deploy.

---

## 4. Board snapshot

- **Done:** about 44 issues. Includes all P0s (#1–#4), progression, program sequence, adaptation
  engine, preferences, fast logger, rest cue, recap, feedback, units, duration-first onboarding.
- **Board is stale on 14 items.** These show `Ready to merge` but their PRs are already merged into
  `main`: #59, #89, #97, #101, #102, #103, #104, #109, #116, #118, #120, #125, #129, #131.
  Owner action: confirm each issue's acceptance boxes, then move to `Done`.
- **In Progress:** #67 slot-based exercise selection (slot table merged; selection work open).
- **Todo, by theme:**
  - *Cloud/AI (parked on owner keys and decisions):* #13 sign-in on local Supabase, #14 upload workouts,
    #45 Vercel + Supabase config, #46 second-device restore, #42/#43/#44 adaptation intent, endpoint, Gemini,
    #8 AI-proposed preferences, #29 focus areas (storage design awaiting approval).
  - *Programming quality:* #132 rest per set, #133 compounds first and rep ranges, #134 next day by
    recovery, #114 heavy lead pick, #139 Face Pull 8 → 12 jump, #93 upper/lower, #96 third chest compound, #88 supersets.
  - *Mobile polish:* #127 Restore-backup overflow at 360px, #128 "Return to exercise" wrap,
    #135 pill family, #136 labels wrap and tap targets under 44px, #137 destructive actions and native confirms, #107.
  - *Correctness/copy:* #105 recap disagrees with session, #106 exclusion reshuffles the day silently.
  - *Later:* #68 onboarding from reference, #53 media, #119 profile photo, #9–#12.

---

## 5. Open decisions (owner)

1. **Cloud vs local-first.** `PRODUCT.md` says "no backend, no accounts — permanently". The board has a
   Supabase + Gemini track (#13, #14, #42–#46). One of them must change. Decide before more cloud work.
2. **Public name.** The live URL serves placeholder branding with a trademarked name. Rename or take it down.
3. **Stored-data changes** need owner approval (#29's design, preferences migration if any).
4. **Merge/Done sweep** of the 14 stale `Ready to merge` items above.
5. **Docs refresh.** Rewrite README/HANDOFF/PRODUCT/AUDIT to match the app, or delete the stale parts.

## 6. Loose ends in the checkout

- Untracked, not committed: `docs/specs/` (slot-based selection, onboarding-from-reference),
  `fitbod-board-changes.md` (draft board edits, now largely applied), `.cloud-attachments/`, and this file.
- The primary checkout is a detached HEAD at `d4b53a9`, 172 commits behind `origin/main`. Work from a
  fresh worktree of `origin/main`.
- Not verified here: real iOS/Android devices, screen-reader/contrast audit, behaviour at the 5 MB
  `localStorage` limit, live Vercel bundle vs a local build.

---

## 7. Paste this to start the chat

```
You are helping me steer a project, not write code right now. Context below.
Fitbod clone: a phone-first, local-first strength-training web app (React 19, TypeScript, Vite,
localStorage, no backend). Live at fitbod-chi.vercel.app, main at a22da52, 368 tests passing.
Promise: never invent capacity; prescriptions are immutable; load only rises on completed work.
Open decisions: (1) PRODUCT.md says no backend forever but the board has a Supabase + Gemini track,
(2) placeholder branding with a trademarked name is live, (3) 14 merged issues still show
"Ready to merge", (4) docs are stale.
Help me with: <your question>. Ask one question at a time. Keep answers short, numbered, max 5 items.
```
