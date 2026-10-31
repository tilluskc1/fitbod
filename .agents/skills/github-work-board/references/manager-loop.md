# Manager loop

Use a stable lock owner without whitespace. Every wake-up begins at step 0. Durable progress belongs in `[work-board]` issue/PR comments and any repository task record required by `AGENTS.md`.

## 0. Preflight and reconcile

Run `B doctor --json`, `B status`, then `B claim OWNER`. If another live owner holds the lock, stop. Run `B state --json`; reconcile its branch, worktree, PR head and latest note with repository records. A failed read is an error, never an empty board.

## 1. Resume first

Resume every in-flight issue before selecting a new one:

- active worker: wait;
- completed worker: continue its recorded step;
- worktree without worker: assign a read-only resume assessment;
- dirty, conflicting or ambiguous state: park.

Never start a second implementation worker.

## 2. Triage

Run `B triage --json`. Leave `WAIT` items untouched, report `PARK` items, and select the first `CHECK` item. The controller applies configured priority order and then board order.

## 3. Requirements check

Assign the Requirements-review role from `worker-roles.md`. It must establish testable scope, acceptance criteria, permissions, failure states, dependencies and open decisions from repository-authoritative sources. Anything unresolved parks the issue.

## 4. Start and plan

Run `B start N`, then `B worktree N`. Assign the Implementer in plan phase. Review the plan against repository instructions and the issue. Scope expansion, architectural decisions lacking authority, hosted changes or unclear behavior park the issue.

## 5. Implement

Continue the same Implementer in build phase. It writes tests where appropriate, implements the smallest approved change, runs proportionate checks, commits, pushes the exact feature branch and opens or updates a draft PR linked to the issue. `B state N` must show local head equal to PR head.

## 6. Independent verification

Set `B move N "<reviewStatus>"`, record reviewed SHA `R`, and run `B verify-at N R`.

1. Assign QA at exactly `R`; then run `B verify-check N R`.
2. Run `B changed --json N origin/<baseBranch> R`. When UI changed, assign Product review at exactly `R` using real local behavior and synthetic/test data only.
3. Assign Reliability/security review when the diff or repository policy makes it applicable.

A verdict on another SHA is void. Record findings as `[work-board]` comments without changing the reviewed branch.

## 7. Repair

Send exact defects to the Implementer. Review the new SHA from scratch for affected areas; never reuse a verdict across changed executable inputs without explaining why it remains valid. After two unsuccessful repair rounds, park.

## 8. Ready to merge

Confirm the base branch is an ancestor of the feature head, the worktree is clean, local head equals PR head, selected checks passed, all applicable reviewers passed, and all unverified areas are reported. Run `B ready N R R`; it refuses mismatched or unreviewed heads and never merges. Remove the verifier worktree and notify the user.

## 9. Repeat or finish

Return to step 0. When no eligible or in-flight issues remain, release the lock and report completed, parked and waiting issues plus checks not run. Do not keep polling unless the user explicitly asked for monitoring and the host provides a safe wake/automation mechanism.

## Dry run

Run doctor, status, state and triage only. A read-only Requirements-review worker may inspect each `CHECK` issue. Do not claim a live manager's lock, change GitHub, create worktrees, push branches, open PRs or start implementation/review workers.

