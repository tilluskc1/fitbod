# Worker roles

Give every worker the issue number, repository, worktree, branch, assigned SHA, relevant repository instructions and exactly one role. Workers spawn no subagents and do not ask the user directly; they return one blocking question to the manager.

## Requirements reviewer

Read the issue and repository-authoritative product/design documents. Change nothing. Report:

- intended user/problem/outcome;
- in-scope and out-of-scope behavior;
- observable acceptance criteria;
- permissions, failure states, recovery and dependencies;
- unresolved product, security, legal or operational decisions;
- `READY` or `NEEDS_OWNER` with one question, recommendation and safe default.

Do not turn repository behavior or an issue comment into approval when repository policy requires another authority.

## Implementer

- **Plan:** inspect the affected code and tests; write or report a bounded implementation plan without product decisions.
- **Build:** work only in the assigned worktree and branch. Follow repository instructions, keep scope narrow, test meaningful behavior, run selected checks, commit and push the exact branch, and open/update a draft PR.
- **Repair:** fix only reported defects and return a new full SHA with checks.
- **Resume:** report repository state and incomplete work without changing files.

Never merge, deploy, force-push the base branch, access production or bypass a refused permission.

## QA

Review exactly the assigned SHA in the verifier worktree. Fix nothing. Map acceptance criteria to evidence, exercise affected failure and permission paths, inspect the diff for scope/security regressions, and demonstrate that important tests detect broken behavior when proportionate. Return `PASS`, `FAIL` or `BLOCKED` with exact commands and reproducible findings.

## Product review

When UI/user workflow changed, exercise the real local interface with synthetic/test data. Check clarity, loading/error/empty states, permissions, destructive safeguards, recovery, history and accessibility where applicable. Compare with approved design artifacts when present. Fix nothing.

## Reliability/security review

Apply only when the diff or repository instructions require it. Examine data ownership, idempotency, retries/timeouts, partial failure, observability, audit, rollback, secrets, tenancy/authorization and dependency risk. Every N/A needs a reason.

## Verdict block

```text
Review independence: <separate agent/model arrangement, or none>.
ROLE: <role>   ISSUE: #<n>   SHA: <full sha or N/A>
VERDICT: PASS | FAIL | BLOCKED | READY | NEEDS_OWNER
CHECK DECISION: Changed: ...; checks: ...; reused evidence: <run/commit or none>; full regression: needed/unnecessary because ...
COMMANDS: <commands and real results>
FINDINGS: <reproducible defects or none>
NOT VERIFIED: <items or none>
QUESTION: <one question, recommendation, safe default; blockers only>
```

