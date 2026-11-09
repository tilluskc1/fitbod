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
- Whenever work is handed back, end the reply with the link to the next dev session and the prompt it was started with (see "Sessions and models"), naming the next issue and its stop conditions. When no session could be started, give the prompt to copy instead.

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

Single-context: `docs/adr/` at the repo root (no glossary file exists yet). See `docs/agents/domain.md`.

## Issue board

The board is GitHub Project 11 ("Fitbod", owner `tilluskc1`). Its issues are the source of truth for what is being built.

- Every dev turn that touches code updates its issue before the turn ends — `Status`, plus one comment with what changed, the checks actually run, and what is still open — and every later turn repeats that until the issue is closed. No silent work. If no open issue covers the work, open one first.
- Statuses: `Todo` → `In Progress` → `Review` → `Ready to merge` → `Done`. `Done` only when every acceptance box is checked, the checks pass on the final commit, and it is merged to `main`.
- `Review` means built on a feature branch and being verified at a named SHA. `Ready to merge` means verified at that SHA; it merges under the standing merge rule below, otherwise it waits on a human.
- Never mark `Done` from a feature branch, a passing helper test, or a screenshot that has not been reproduced at 390×844 and 360×780.
- **Every UI story shows screenshots (owner, 2026-11-09).** Any story whose change can be seen on screen (copy, layout, a new state, a new step in a flow) posts screenshots on its issue before it reaches `Ready to merge`:
  - Sizes: 390×844 and 360×780, plus 390×650 when the Today screen changes.
  - Taken at the reviewed SHA. Show before and after when something already on screen changes; a new screen shows only after.
  - Linked in the PR body (edit the draft PR once they exist) and in the end-of-run report, so the owner sees them without hunting.
  - A story with nothing visible says "no UI change" in its issue comment instead, and the reviewer agent confirms that claim from the diff.
  - Check: before pushing `main`, the issue has a screenshot comment that names the reviewed SHA (or the "no UI change" line). If it does not, do not merge.
- Work left uncommitted, unmerged or unverified keeps its issue open and says so in the comment. Reopening is cheaper than a false `Done`.
- New scope found mid-task gets its own issue; do not quietly widen the one being worked.
- Every `AS-*` story also obeys `docs/agents/story-contract.md` (shared product contract, guardrails and readiness rules).

Status and field IDs are read with `gh project field-list 11 --owner tilluskc1 --format json`; update with `gh project item-edit`. `docs/agents/issue-tracker.md` covers the issue commands.

## Work board loop

`.agents/skills/orchestrate-github/` drives one issue at a time from a configured board, using `.github/work-board.json` (Project 11, `main`, `work/<issue>-<slug>` branches, `ready-for-agent` once claimed, `needs-info` when parked). It runs each Ready issue through `.agents/skills/orchestrate/` (goal in, plan on defaults, subagent build and per-task review), publishes a draft PR, and stops at `Ready to merge`; merging and `Done` stay with a human. `.agents/skills/github-work-board/` stays available as the lighter controller for single-issue moves.

Each phase runs the skill that fits it, from `.agents/skills/`:

| Phase | Skill |
| --- | --- |
| Requirements check | `grilling` (or `grill-with-docs` when ADRs decide it) |
| Goal loop | `orchestrate` (inside `orchestrate-github`; implementation and review dispatches are separate agents) |
| Implementation | `tdd`, `diagnosing-bugs` when the defect is not yet reproduced |
| Independent review | `code-review`, plus `ponytail-review` on the diff size |
| Handoff between turns | `handoff` |

Independent review means a separate agent at a named SHA. If only one agent did both, the review says so rather than claiming a pass.

## Sessions and models (owner, 2026-11-09)

Cost here is mostly a long chat re-reading itself, plus each agent's start-up. Keep chats short and send routine work to cheaper models.

- **One chat per story.** A dev chat works one story (or one small-tier batch) to merge or park, then hands off:
  1. Post the story's issue comment (status, checks, what is open). Then create the next dev session with `create_session`, in the same environment, with `model` set to Opus explicitly (it otherwise inherits this chat's model). Its first message is the next story's prompt, with stop conditions.
  2. Put that session's link and its prompt in the final report.
  3. As the very last step, archive this chat (`archive_session` with its own session id, from `get_session`), but only if `git status` is clean and every branch is pushed. Otherwise leave it open and say why. This is the one standing exception to lesson 18. It covers only the finished dev chat itself, never another chat, PR, branch or issue.
- **Model routing.** Opus is the orchestrator and does the work that needs judgment: the plan, the fix for a logic change, and the review of a large-tier change. Everything routine goes to a cheaper model, and every `Agent` dispatch names its `model`:
  - `sonnet`: screenshots (via `E2E_SHOTS=<dir> npm run e2e` or one short script), uploading them to the shots branch, merge runs (`merge/*`, checks, push, Vercel), issue and PR comments, docs, and reviews of small- and medium-tier changes.
  - `haiku`: not by default. An agent's start-up cost outweighs a tiny task; do those inline in one script.
- **Change tiers set the review.**
  - Small (docs, copy, test-only): batch several into one PR, with one `sonnet` reviewer given the diff in its prompt.
  - Medium (a logic bug in one screen): one `sonnet` reviewer at the final SHA.
  - Large (stored data, a flow, storage, cross-tab, progression or safety logic): one `opus` reviewer.
- **Before any reviewer is dispatched:**
  - Merge `main` into the branch.
  - Check the diff against every "default picked by product" line (lesson 21).
  - Run `npm test`, `npm run lint` and the full `npm run e2e`. A re-review costs a whole new agent.
- **Lean toolset.** `.claude/settings.json` turns off the plugins this repo never uses. Account connectors stay on, because the owner uses them for other work. A dev chat never loads a connector tool it does not need.
- Batch shell work: one script per step (merge, shoot, post), not one tool call per command.

## Autonomy envelope

Inside this envelope the loop acts without asking. Outside it, it parks the issue with one question, a recommended default and a safe fallback, then continues with the next issue instead of ending the run.

- May do unasked: claim the lock, `start` an issue and move it through `In Progress` and `Review`, post `[work-board]` comments, add or remove `ready-for-agent` and `needs-info`, create `work/<issue>-<slug>` branches and worktrees, commit, push them, open or update draft PRs.
- Must ask first: marking `Done`, changing the shape of stored data, adding a dependency, widening an issue's scope, a change to the agreed look or flow, and any merge outside the standing merge rule.
- **Standing merge rule (owner, 2026-11-08):** merging to `main` (a production deploy on Vercel) needs no extra ask when all of these hold: a separate reviewer agent passed the PR at its final SHA; the PR changes no stored-data shape, adds no dependency, and changes no agreed look or flow (or the owner already approved that change); on the merged result `npm test`, `npm run lint` and `npm run build` pass, plus a browser pass at 390×844 and 360×780 when screens change, with its screenshots on the issue (Every UI story shows screenshots, above); after the push the commit status shows `Vercel=success`. Merge in order on a local `merge/*` branch, push `main` once, then report the SHA, checks and what went live. If Vercel fails, say so at once with the fix. `Done` stays with the owner.
- Keep going: when an issue reaches `Review`, start the next eligible issue in the same turn. Do not ask for permission between issues.
- Park, don't stall: a decision the repository cannot answer becomes a `needs-info` park on that issue, and the next issue starts.
- **Story first, no ask (owner, 2026-11-08):** when the owner raises an idea or a problem and no open issue covers it, write the story in the same turn. Pick the recommended default for every open choice, name it in the story as "default picked by product, owner can override", and label it `ready-for-agent` when nothing else is open. A look or flow change still ends with screenshots for owner sign-off before merge. Never reply "pick one and I'll write it".
- One run reports once, at the end: issues moved with their SHAs, checks actually run, screenshot links for each UI story, what parked and why.
