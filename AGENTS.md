# Project instructions

## Output style: ADHD mode is always on

Every response in this repository follows `.agents/skills/i-have-adhd/SKILL.md`.
It applies to every turn and every agent, not just the turn where it was invoked.

- Lead with the next action, not context.
- Number multi-step work; one bounded action per step.
- End with one concrete next action.
- Restate state at the start of a follow-up turn.
- No preamble, no recap, no closing pleasantries.
- Errors: cause and fix, matter of fact.
- Cap visible lists at 5 items.
- Whenever work is handed back, end the reply with a copy-pasteable prompt for the dev chat, naming the next issue and its stop conditions.

It stays on until the user says "normal mode" or "stop adhd mode". Those words end it for the rest of the session.

## Lessons loop

Before planning any task, read `docs/agents/lessons.md` and copy the relevant edge cases into the brief.
When a review fails, a merge goes wrong, or the owner corrects something, add one lesson there (what
happened, the rule, how to check it) in the same PR as the fix. Turn a lesson into a test or script check
when it can be one.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `tilluskc1/fitbod`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Issue board

The board is GitHub Project 11 ("Fitbod", owner `tilluskc1`). Its issues are the source of truth for what is being built.

- Every dev turn that touches code updates its issue before the turn ends — `Status`, plus one comment with what changed, the checks actually run, and what is still open — and every later turn repeats that until the issue is closed. No silent work. If no open issue covers the work, open one first.
- Statuses: `Todo` → `In Progress` → `Review` → `Ready to merge` → `Done`. `Done` only when every acceptance box is checked, the checks pass on the final commit, and it is merged to `main`.
- `Review` means built on a feature branch and being verified at a named SHA. `Ready to merge` means verified at that SHA; it merges under the standing merge rule below, otherwise it waits on a human.
- Never mark `Done` from a feature branch, a passing helper test, or a screenshot that has not been reproduced at 390×844 and 360×780.
- Work left uncommitted, unmerged or unverified keeps its issue open and says so in the comment. Reopening is cheaper than a false `Done`.
- New scope found mid-task gets its own issue; do not quietly widen the one being worked.
- Every `AS-*` story also obeys `docs/agents/story-contract.md` (shared product contract, guardrails and readiness rules).

Status and field IDs are read with `gh project field-list 11 --owner tilluskc1 --format json`; update with `gh project item-edit`. `docs/agents/issue-tracker.md` covers the issue commands.

## Work board loop

`.agents/skills/orchestrate-github/` drives one issue at a time from a configured board, using `.github/work-board.json` (Project 11, `main`, `work/<issue>-<slug>` branches, `ready-for-agent` once claimed, `needs-info` when parked). It runs each Ready issue through `.agents/skills/orchestrate/` (goal in, plan on defaults, subagent build and per-task review), publishes a draft PR, and stops at `Ready to merge`; merging and `Done` stay with a human. `.agents/skills/github-work-board/` stays available as the lighter controller for single-issue moves.

Each phase runs the skill that fits it, from `.agents/skills/`:

| Phase | Skill |
| --- | --- |
| Requirements check | `grilling` (or `grill-with-docs` when `GLOSSARY.md`/ADRs decide it) |
| Goal loop | `orchestrate` (inside `orchestrate-github`; implementation and review dispatches are separate agents) |
| Implementation | `tdd`, `diagnosing-bugs` when the defect is not yet reproduced |
| Independent review | `code-review`, plus `ponytail-review` on the diff size |
| Handoff between turns | `handoff` |

Independent review means a separate agent at a named SHA. If only one agent did both, the review says so rather than claiming a pass.

## Autonomy envelope

Inside this envelope the loop acts without asking. Outside it, it parks the issue with one question, a recommended default and a safe fallback, then continues with the next issue instead of ending the run.

- May do unasked: claim the lock, `start` an issue and move it through `In Progress` and `Review`, post `[work-board]` comments, add or remove `ready-for-agent` and `needs-info`, create `work/<issue>-<slug>` branches and worktrees, commit, push them, open or update draft PRs.
- Must ask first: marking `Done`, changing the shape of stored data, adding a dependency, widening an issue's scope, a change to the agreed look or flow, and any merge outside the standing merge rule.
- **Standing merge rule (owner, 2026-11-08):** merging to `main` (a production deploy on Vercel) needs no extra ask when all of these hold: a separate reviewer agent passed the PR at its final SHA; the PR changes no stored-data shape, adds no dependency, and changes no agreed look or flow (or the owner already approved that change); on the merged result `npm test`, `npm run lint` and `npm run build` pass, plus a browser pass at 390×844 and 360×780 when screens change; after the push the commit status shows `Vercel=success`. Merge in order on a local `merge/*` branch, push `main` once, then report the SHA, checks and what went live. If Vercel fails, say so at once with the fix. `Done` stays with the owner.
- Keep going: when an issue reaches `Review`, start the next eligible issue in the same turn. Do not ask for permission between issues.
- Park, don't stall: a decision the repository cannot answer becomes a `needs-info` park on that issue, and the next issue starts.
- **Story first, no ask (owner, 2026-11-08):** when the owner raises an idea or a problem and no open issue covers it, write the story in the same turn. Pick the recommended default for every open choice, name it in the story as "default picked by product, owner can override", and label it `ready-for-agent` when nothing else is open. A look or flow change still ends with screenshots for owner sign-off before merge. Never reply "pick one and I'll write it".
- One run reports once, at the end: issues moved with their SHAs, checks actually run, what parked and why.
