# Home Strength — handoff for a fresh chat (product + tech)

State as of **2026-11-08**, verified against `main` at **`36df187`** (#229 short sessions, #230 catalog studio) plus this doc update.
Repo: `tilluskc1/fitbod`. Board: GitHub Project 11. Design system: `DESIGN.md`. Live: https://fitbod-chi.vercel.app.

> `HANDOFF.md` and `AUDIT.md` describe **Phase 1** (41 tests, kg only, 5 screens) and are kept as
> history. `README.md` and `PRODUCT.md` were brought up to date in #270 and are checked by
> `tests/readmeFacts270.test.ts`. Trust this file for process and state.

---

## 1. Product

**What it is.** A phone-first, local-first strength-training web app. It works with a full gym, a
home kit or nothing, and adapts each day to the gear and time you have. Onboard once, see today's
workout, log sets one-handed, review progress. No account, no server. Installable on iPhone and Android.
Public name: **Home Strength** (the trademarked name was removed, #145). A rename is open: owner choosing, recommended "Trueset".

**Promise.** It never invents capacity.
- Every day says `Ready`, `Limited session` or `Not enough equipment`. `Limited` only for a real gap,
  always with its reason. On a day you described yourself, `Limited` names the uncovered muscle and the
  cause: gear, skip, a twin move, the exercise cap, or time (#211, #219).
- The prescription is a contract: logging records what happened, never rewrites what was planned.
- Load only goes up on completed work. A skipped or early-finished exercise repeats its target.
  A today-only gear change never lowers home loads: progression is per setup (#188).
- Minutes are honest: every surface shows one figure from the timer's own model (`todayGlance`,
  `sessionTime.ts`); a shortened day is trimmed to fit, never over (#189, #200, #203, #197).
- Storage failures surface with a recovery path. Nothing fails silently.

**Look.** Light mint system (Today v7): mint page, white 26px cards, lime only as a fill with dark text,
black pill primary, thin large numerals, one blue week card, photo hero, floating white nav pill with a
lime Start/Resume. See `DESIGN.md`.

### What works today

| Area | State |
|---|---|
| Onboarding | Four steps. Defaults: lb, Build muscle, 3 days, **45 min, At a gym** (full gym floor). Goals in a 2×2 grid; Continue pinned on every step; fits a phone (#222). At home starts with no bench assumed. |
| Today | Greeting, pill row (length · gym · Switch), photo hero with state chip, workout card, coach, week card. **"Tell me about today"** composer (collapsed): chips Gear/Train/Skip/Time plus a text box read on-device ("legs are sore, chest and abs, 45 min"); builds a today-only day through the real generator; "pain" blocks; the planned day stays next (#193). Backup reminder when no backup in 7 days (#225). |
| Today-only changes | Length (longer rebuilds; shorter than 45 min rebuilds at that length, so it matches the same day saved there, #229; 45+ trims by the timer model), gear (Travel gym / Bodyweight / Bands rebuild the day from that kit, #188), and described days. Restore original. |
| Train (logger) | One tap per set, rest by role, first-weight step, go-heavier step, skip/swap/discard. Replace never offers a move that works a skipped area on a described day. A running described session shows its own name and "Today only" (#220). |
| Plan / Progress / Coach / Recap | Whole week with honest minutes per day (#186, #203), real-sets-only charts, recap names next targets. |
| Programming | Lead → other compounds → isolation → core. Core capped at 1 exercise / 3 sets on Pull, Legs, Lower (#190). Full Body B no longer falsely Limited (#196). Short days never promise more than their length (#197). **Under 45 min** (#229): movements before sets, nothing past 3 sets, lead floor 3 from 30 min, a day that pulls keeps ≤ 2 presses, short rests at ≤ 30 min. A 30-min gym/home day is 4–6 movements, 12–13 sets (was 3 / 9). 45/60 output is pinned to the pre-#229 fingerprint by a test. |
| Install + data | Web app manifest, icons, iOS standalone tags; storage persistence requested once installed (#214). Settings shows this device's install steps. **iPhone:** a Home Screen app has its own storage, so export first and restore inside it. **Back up now** opens the Share sheet (Files/iCloud, Drive, email), download where file sharing is unsupported (#225). |
| Accessibility | Sheets trap focus; 44px targets; dark focus ring. |
| Data safety | Versioned `localStorage` envelope, revision checks, verified writes, migration, validated export/restore, Recovery screen. |
| Catalog studio (dev only) | `npm run studio` → `/studio.html`: body parts, every exercise with frames, role, rep ranges as the app prescribes, swaps, empty video slot; muscle×kit and movement×kit coverage grid; flags (missing/broken frames, orphan media, no swap). Not in the production build (#230). |

### Not built (by design or not yet)

- No AI coach, accounts, sync or second-device restore. **Cloud track is only issues** (#8, #13, #14, #29, #42–#46), parked on the cloud vs local-first decision.
- No supersets (#88), no recovery-based day choice (#134), no deload, no −/+ weight stepper in the logger.
- No exercise videos: parked (no licensed library; ~60–190 MB offline). The studio has an empty video slot; #231 loops the two existing frames instead.
- Bodyweight-only Pull days have no exercise (no bar) and Push/Upper have only Push-Up: a catalog gap, honestly Limited / Not enough. The studio's coverage grid shows it; feeds #9 and #53.

---

## 2. Tech

| Fact | Value |
|---|---|
| Stack | Vite 8.3.5, React 19.3.1, TypeScript 7.0.2. No router, UI library or state library. No new dependencies added since. |
| Source | ~14.4k lines TS/TSX in `src/**`, plus `src/index.css`. |
| Tests | **572 passing**, 78 files in `tests/`, `node --test tests/*.test.ts`. 0 fail. |
| Build | `npm run build` passes: JS 476 kB (141 kB gzip), CSS 66 kB. |
| Lint | `npm run lint` (oxlint) exits 0. |
| Storage | `localStorage` key `fitbod-clone-v1` (kept on purpose), `schemaVersion` **2**. Optional fields added with owner approval: `WorkoutExercise.setup` (#188), `TodayOverride.focus` / `skip` (#193), `AppState.lastBackupAt` (#225). Older data loads unchanged. |
| Hosting | Vercel project `fitbod`, connected to GitHub: a push to `main` deploys production; the commit status shows `Vercel=success`. |

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build
npm run lint
npm run studio     # dev-only catalog studio
```

### Layout

```
src/
  App.tsx              state container, save orchestration, sheets, nav
  types.ts             domain types
  screens/             Today, Train, Plan, Progress, Coach, Library, Adapt, Recap, Splash, Sheets
  components/          Onboarding, Recovery, ErrorBoundary, DurationSheet, GymSheet, SwitchSheet, TodayTalk, ui/
  data/                exercises (62), flagship program, media.json (frames, optional video)
  studio/              dev-only catalog studio (studio.html entry, not built)
  lib/                 pure logic, tested without the DOM:
    generator, feasibility, capabilities, constraints, areas   selection + honest coverage
    progression, liveProgression, firstLoad, setup             prescriptions, per-setup history
    sessionTime                                                rest by role, the one minutes model, fitSets (short days)
    adapt, sequence, switchDay, replacements, preferences      today-only rebuild/trim, swaps, slots
    todayTalk                                                  described days: parse, build, status
    session, plan, feedback, restCue, focusTrap                session + program flow
    storage, validate, units, editDraft, download, backup      persistence, export, Share-sheet backup
    install                                                    install hint per device
    catalog                                                    studio data: cards, coverage, flags
public/                exercises/ (JPEG frames), hero/, icons/, manifest.webmanifest, sw.js
```

### Decisions to keep

- Domain logic lives in `src/lib` as pure functions; screens only render and dispatch.
- Capabilities are separate from equipment: dumbbells do not imply a bench.
- `planned` is immutable; `performed` is the user's record.
- A listed dumbbell rack is a shortcut, never a cap (#129); a gym kit ignores a stale stored rack (#194).
- One minutes model for the timer and every promised minute (`todayGlance` / `sessionTime.ts`).
- Progression reads same-setup history; a today-only setup follows the more recent of its own and home history, capped to its rack (#188).
- The saved setup is `savedSetup(profile)`: never a rebuild, never tagged.
- A described day has no slot link and never advances the plan (#193).
- Under 45 minutes a day is built at its length, never trimmed from a longer one, so saved and today-only agree (#229). 45+ today-only trims the saved day (#203). Restore original returns the saved-length day.
- Everything is stored in kg internally; display units convert.

---

## 3. Process

- Issues are the source of truth. Statuses: `Todo` → `In Progress` → `Review` → `Ready to merge` → `Done`.
- Work happens on `work/<issue>-<slug>` with a draft PR; a **separate reviewer agent** checks each PR at a named SHA; checks (build, tests, lint) and a browser pass at 390×844 and 360×780 before merge.
- **Merges to `main` follow the standing merge rule in `AGENTS.md`** (separate review passed, no stored-data/dependency/look change unless approved, checks green, `Vercel=success`); otherwise the owner approves. Only the owner marks `Done`. A merge to `main` is a production deploy.
- Merging: merge PRs in order on a local `merge/*` branch, run all checks after each, push `main` once, confirm `Vercel=success`. Stacked PRs are marked merged by fast-forwarding their base branch to their head (no force push).
- The cloud session cannot edit Project 11 fields (GraphQL blocked) or open `*.vercel.app`; it reads Vercel's result from the GitHub commit status.

---

## 4. Board snapshot (2026-11-08)

- **Open: 34 issues.** #229 and #230 merged today (Done stays with the owner on Project 11).
- **Next, ranked:** #232 Coach hero text unreadable (P1, waits on the owner: light or dark card); #231 photo frame loop (look change: screenshots for sign-off); #134 next day by recovery; #88 supersets; −/+ weight stepper (no issue yet).
- **Parked:** #191 muscle tags (recommend close as won't-fix).
- **Cloud/AI (owner decision):** #8, #13, #14, #29, #42–#46.
- **Backlog, needs triage** (some may already be fixed): #9–#12, #53, #68, #93, #96, #105, #106, #107, #114, #119, #127, #128, #135, #136, #137, #139, #141.
- **Not filed yet:** Plan tab during a running described session still says "Up next · Slot N of M"; a 30-min day now holds more movements than many 45-min days (45 kept unchanged on purpose; own issue if the owner wants 45 to follow); catalog studio phase 2 (edit and save via PR).

---

## 5. Open decisions (owner)

1. **#232:** light or dark Coach hero card.
2. **Cloud vs local-first.** Backup works without a server; sync and a second device need the cloud track.
3. **App name.** "Home Strength" no longer fits gym users; recommended "Trueset" after a trademark check.
4. **#191** drop or keep.
5. **Done sweep** of merged issues in Project 11 (cloud sessions cannot set Status: GraphQL is blocked).

## 6. Loose ends

- Not verified on real devices: iPhone Add to Home Screen + restore, the Share-sheet backup, Android install.
- Not verified: screen reader pass, the 5 MB `localStorage` limit.
- Two cloud sessions worked #229 at once; the other session's WIP patch (issue comment) is superseded by PR #233. One session per issue.

---

## 7. Paste this to start a product chat

```
You are helping me steer a project, not write code right now. Context below.
Home Strength: a phone-first, local-first, installable strength app (React 19, TypeScript, Vite,
localStorage, no backend). Light mint v7 design (DESIGN.md). main at 36df187+, 572 tests passing.
Vercel deploys main on every push. Promise: never invent capacity; prescriptions are immutable;
load only rises on completed work; one honest minutes figure everywhere.
Recent: 30-min days now 4-6 movements (#229), dev-only catalog studio (#230), Share-sheet backup, PWA.
Open decisions: (1) #232 light or dark Coach card, (2) cloud vs local-first, (3) app name, (4) #191, (5) Done sweep.
Next to build: #232 once decided, then #231, #134.
Help me with: <your question>. Ask one question at a time. Keep answers short, numbered, max 5 items.
```

## 8. Paste this to start a dev chat (cloud session on the fitbod repo)

```
Home Strength (tilluskc1/fitbod), main at 36df187+. Read AGENTS.md, docs/chat-handoff.md and
docs/agents/lessons.md first. ADHD mode on. Rules: issues are the source of truth; one session per
issue; branch work/<issue>-<slug>, draft PR, separate reviewer agent at a named SHA; checks npm test,
lint, build, browser at 390x844 and 360x780; merge only under the standing merge rule; Done stays
with the owner; ask before stored-data, dependency, look/flow or scope changes.
Next: #231 photo frame loop (look change: screenshots at both sizes for owner sign-off before merge).
Then #134 next day by recovery. Do not start #232 until the owner picks light or dark.
Stop when: a PR passes review and checks, or a decision only the owner can make; park with one question.
```
