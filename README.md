# Home Strength

A phone-first, local-first strength-training web app. It works with a full gym, a home kit or nothing,
and adapts each day to the gear and time you have: onboard once, see today's workout, log sets
one-handed, review progress. No account and no server; installable on iPhone and Android.
React 19 + TypeScript + Vite. Live: https://fitbod-chi.vercel.app

The current product and tech handoff is `docs/chat-handoff.md`; the design system is `DESIGN.md`.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
npm run preview    # serve dist/ (used for the offline check)
npm test           # node --test tests/*.test.ts
npm run lint       # oxlint
npm run e2e        # build, then the browser checks in scripts/e2e (needs Playwright installed)
npm run studio     # dev-only catalog studio at /studio.html
```

Requires a modern browser with `localStorage`. Node 22.18+ (or 24+) for the test runner's built-in
TypeScript support.

## What it does

- **Onboarding**: name, units (lb by default, kg available), goal, experience, days per week, session
  length, and where you train (a gym, or the exact kit you have at home, benches and racks included).
- **Today**: today's workout from your split, with its honest length; change the length, the gear for
  today only, or switch days. **Plan today with me** asks four questions (time, what's sore, what to
  train, gear) or reads a sentence, and builds a today-only day; pain stops it.
- **Honest feasibility**: every day reports `Ready`, `Limited session` or `Not enough equipment`, and
  a limited day names its reason. The app never adds equipment you don't own, and owning dumbbells
  never implies a bench, nor a barbell a rack.
- **Programming**: lead lift, other compounds, isolation, core. Goal and experience change the work:
  intermediate and advanced lifters who want muscle or strength get a five-set heavy lead, with
  strength rep ranges and rests for "Get stronger" (`src/lib/progression.ts`).
- **Progression**: double progression inside each movement's rep range. Load moves up one step only
  when every set is completed at the top of the range; an unfinished or skipped exercise repeats its
  target. Steps come from your listed dumbbells when you give them, otherwise from per-equipment
  defaults.
- **Logging**: one tap per set, rest by role, swap, skip, add or remove sets, finish early; the
  prescription is never rewritten by what you log. History can be corrected afterwards.
- **Progress, Plan, Coach, Recap**: the week with honest minutes per day, charts from real sets only,
  your review and what the app knows about you, and a recap that names the next targets.
- **Data tools**: Back up now (Share sheet, or a download where sharing files is unsupported), JSON
  export, validated restore with merge and dedupe, a recovery screen for unreadable data.
- **Install and offline**: web app manifest and icons; production builds register a service worker
  that precaches the built app, so one online visit is enough to open it offline. Exercise photos seen
  online stay cached; others fall back to a labelled placeholder.

## Data and storage

Everything is stored in this browser's `localStorage` under `fitbod-clone-v1` as a versioned envelope
(`schemaVersion` 2) with a revision number checked on every write, so a newer tab is never clobbered.
Unreadable data is never overwritten on load; it can be downloaded first. Weights are stored in kg and
shown in your chosen unit.

There is no cloud copy. On iPhone, a Home Screen app has its own storage, separate from Safari: back up
before clearing site data, changing phones or moving into the installed app.

## Catalog

62 exercises across gym, home and bodyweight kits, each with two photographs from
[free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain / Unlicense).
`tests/readmeFacts270.test.ts` checks this count against `src/data/exercises.ts`.

## Known limitations

- **Bodyweight moves progress by reps only.** There is no added-load field, so push-ups and pull-ups
  hold at the top of their range.
- **A PR is the heaviest completed set.** There is no volume, rep or estimated-1RM record.
- **No deload or autoregulation.** A stalled lift repeats its target; nothing schedules a back-off week.
- **No supersets, no exercise videos.**
- **One browser, one user.** No accounts, sync or URL routes. A tab with an unsaved change shows a
  conflict banner and can export before reloading.
- **Storage limits vary by browser** (typically about 5 MB per origin); quota errors are surfaced.

## Provenance

Code and CSS are original. Exercise photography comes from free-exercise-db (public domain). No
third-party app code or assets are included.

## Project documents

- `docs/chat-handoff.md`: current product, tech and process handoff. Trust it over older docs.
- `DESIGN.md`: the approved look and voice.
- `PRODUCT.md`: purpose, users, principles.
- `AGENTS.md` and `docs/agents/`: how agents work on this repo (board, lessons, story contract).
- `AUDIT.md`, `HANDOFF.md`: Phase 1 history, kept for the record.
