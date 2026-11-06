---
name: orchestrate
description: Use when given a development or design goal, feature, spec or task list to take from idea to a reviewed result with subagents, with one human approval at the plan. Use for "orchestrate", "run this goal", "build this end to end", or a spec or design artifact to implement without GitHub.
---

# Orchestrate

Take a goal to a reviewed local result with exactly one human stop: plan approval. This skill routes to existing skills; it adds no build or review logic of its own.

## Precedence

- Invoking this skill with a goal is the user's request to run it this way. For this goal, the Clarify step and the plan stop replace the brainstorming question round entirely, any "ask before work" rule, and every sub-skill consent or "ask your human partner" step. "go" at the plan stop is consent for the worktree, the branch and the commits. Tiny goals need no extra approval.
- A sub-skill step that would need the human after the plan stop: decide from the plan and its defaults; if that is not possible, park the task and report it.
- Every other rule in the project's instruction files (`AGENTS.md`, `CLAUDE.md`, `HANDOFF.md` at the repo root) and any user-level instructions still apply and beat this skill.

## Flow

1. **Read.** Instruction files above, then the code the goal touches. Look up every fact instead of asking.
2. **Size.** Tiny = one file, one obvious change, no visual change. Tiny goals: create a feature branch, build it yourself following `ponytail` (failing test first where logic changes, via the `tdd` skill), dispatch one QA subagent against the goal, then steps 7-8. No plan stop.
3. **Clarify and pick the design mode** ([design-modes.md](design-modes.md)). List only missing decisions, at most 3, each with a recommendation and a default. Plan on the defaults; the questions ride in the plan-stop message. If a decision has no safe default, send it alone before planning, in one message, and wait.
4. **Plan.** **REQUIRED:** write a plan file in the scratchpad (see below) so the tree stays clean. Every task names its files and ends with a `Done when:` line. The plan also lists global constraints, per-task briefs and a task ledger seeded empty. Create mode: build the mockup now.
5. **Stop for approval.** One message: questions with defaults, task list, design mode, mockup screenshot if any, rough time. Wait for "go". This is the only stop.
6. **Build and review** with the plan as the single source of truth:
   - Worktree: plain `git worktree add` under the configured worktree path (`.worktrees/` only when nothing is configured, excluded via `.git/info/exclude`, never committed to the base branch). Run `npm install` or similar only when the project has dependencies.
   - Ledger, briefs and review packages live in the scratchpad next to the plan. Pass explicit paths; keep them after the run.
   - Dispatch one **implementer** subagent per task. Every brief includes the plan's global constraints and: "Follow ponytail: smallest complete change. Where code logic changes, write the failing test first (tdd skill)."
   - After each task, dispatch one **reviewer** subagent with the task brief and the diff. Reviewers report defects; they never fix. Send defects back to the implementer; up to 5 fix rounds per task.
   - Final review Minor findings: fix the ones that take a few lines in one fix dispatch; report the rest.
   - Then run the design check if a design mode applies.
7. **Verify.** Run the full check set from scratch (typecheck, lint, tests, build; browser pass at the project's required viewports when UI changed). Commit anything left uncommitted on the feature branch. Never commit to the base branch, push, open a PR or merge.
8. **Report.** What now works; branch and commits (or changed files); checks run with results; each reviewer's verdict; design check result; what was not checked; subagent used per role.

## Scratchpad

Keep plan, ledger and briefs under `.scratch/orchestrate/<slug>/`. Confirm `.scratch/` is excluded from tracking (`git check-ignore .scratch` or add it to `.git/info/exclude`); commits never pick it up. Keep the files after the run — after compaction they are the truth.

## Agents

Name the agent on every subagent dispatch. Record what ran for the report. If the named agent is unavailable on this Freebuff host, fall back to the default worker spawn and say so in the report.

| Role | Agent |
|---|---|
| Manager, planner, tiny-job builder | this session |
| Implementer, plan holds the complete code, or 1-2 files with complete spec | spawned `gpt-5-agent` |
| Implementer, 3+ files needing judgment, or design work | spawned `opus-agent` |
| Task reviewer, tiny-job QA | spawned `gpt-5-agent` |
| Final branch review, design check | spawned `opus-agent` |
| Read-only search | `researcher-web` or `code-searcher` |
| Fix rounds 4-5 | `opus-agent` |

Never use a read-only search agent to implement: cheap agents take 2-3x the turns on multi-step work.

## When blocked

- Missing decision mid-build: park that task with one question, recommendation and default; continue independent tasks.
- A subagent reports BLOCKED: stop and report.
- Refused permission, dirty tree you did not create, ambiguous branch: blocker. Never try another route.
- After compaction: the ledger file is the truth. Do not redo completed tasks.
- Not a git repo: work in place, say so at the plan stop, list changed files in the report.

## Common mistakes

| Mistake | Fix |
|---|---|
| Asking questions before the plan when defaults exist | Plan on defaults, ask in the plan-stop message |
| Checking in between tasks | The plan stop is the only stop |
| Saving the plan inside the tracked tree | Scratchpad under `.scratch/orchestrate/`; a dirty tree blocks the build |
| Calling a CSS or layout tweak tiny | Any visual change gets a design mode |
| Passing a design check without seeing it | No preview = "design not visually checked" |
| Implementer reviewing its own task | Reviewer is a separate dispatch |
| Omitting the agent on a dispatch | Always name it |
