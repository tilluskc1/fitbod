# Manager loop

## 0. Establish a run and reconcile

Read `AGENTS.md`, current product decisions and configuration. Run `B doctor --json`, `B status`, `B state --json`, then `B triage --json`. Read failures stop selection. These inspections do not claim a lease or mutate GitHub.

Use a unique `GITHUB_WORK_BOARD_OWNER`, unpredictable `GITHUB_WORK_BOARD_TOKEN` and `GITHUB_WORK_BOARD_ROLE=manager` for this developer-chat session. `B claim OWNER TOKEN` begins the lease; it never takes over an expired foreign lease automatically. `B renew` refreshes a live owned lease. Keep tokens local and renew between bounded worker waits before one third of the configured lease duration elapses.

Reconcile actual worker IDs, worktrees, PR heads and durable issue notes. An expired lease stops writes, not proof that old workers finished. Explicit recovery requires established stopped writers; use the controller's reclaim command only after that reconciliation. A lost/unknown worker or conflicting checkout parks its issue. A quiet worker is not a reason to spawn a replacement.

## 1. Resume before selecting

For each in-flight issue distinguish:

- Running worker: resume/wait for the same worker; no second implementer.
- Returned worker: inspect its result, checkout and PR before recording completion.
- Delivered to Review awaiting product acceptance: leave Review, expose the handoff, then select another unblocked issue.
- Dirty/conflicting/ambiguous work: assess read-only, park with a bounded next action if unresolved.

The worker registry records role, actual host worker ID, assigned head and lifecycle. Before dispatch and after completion, reconcile it with actual host tools; it is not a process supervisor. Keep durable run notes sufficient to find these workers after interruption.

## 2. Select and establish requirements

Run `B triage --json`. Priority order comes from configuration, then board order. `WAIT` means open dependencies: leave it unstarted and continue. `PARK` needs a bounded decision or recovery. Select the first eligible `CHECK` issue.

Dispatch a read-only Requirements reviewer. READY requires testable scope, current brief revision, relevant failure/recovery paths, required checks/review roles, dependencies and any approved product decisions. An unresolved decision gets one question, a recommended default and safe fallback in the issue; continue other eligible work.

If a separate Requirements worker is unavailable, leave the unstarted issue in its configured Todo/ready status, record/park the capability blocker and continue only work whose prerequisites can be met. Do not move unbuilt work to Review or self-approve Requirements.

Immediately before implementation, `B start N` rechecks eligibility and dependencies. Then `B worktree N` creates/reuses only that issue's isolated checkout. A dependency or GitHub error stops that issue; a failed read never authorizes a start.

## 3. Plan and implement

Dispatch one Implementer in plan phase with a bounded scope and absolute checkout. Approve its plan against the issue; product decisions or new dependencies/data changes lacking approval park the issue.

Continue the same Implementer in build phase. It performs meaningful tests, commits and pushes the feature branch, and opens/updates a draft PR linked to the issue. Attach every created PR through the Codex app's artifact tool when available. The implementer reports exact head, checks and incomplete criteria. Manager independently reads local/PR state before accepting the result.

## 4. Internal verification at one head

Move the issue to the configured Review status using `B move N STATUS`. Pin full PR head R and base B. Prepare a clean verifier checkout with `B verify-at N R`. Never repoint a dirty verifier or overwrite evidence.

Dispatch separate QA and Standards workers. Product/mobile review is required when UI or affected user journeys require it; reliability review covers persistence, authentication, authorization and other relevant failure risks. Repository policy can require more, never fewer mandatory acceptance checks. Record actual worker lifecycle and reports using the controller evidence contract.

Run `B verify-check N R` after verification. Inspect raw command results and acceptance evidence, not only a worker's PASS. Browser evidence must correspond to R and the served source. For Fitbod, affected mobile journeys run at 390×844 and 360×780; source probes do not substitute for browser checks.

Missing subagent capability, mandatory checks or usable environments keeps Review with BLOCKED evidence. Same-agent self-review can provide findings but cannot produce independent readiness.

## 5. Repair or hand off

FAIL returns a bounded correction to the same implementer: source location, reproduction, expected/actual, violated requirement and reviewed head. Re-run affected checks and reviewers at its new SHA; old PASS records do not transfer. After two unsuccessful repair rounds, park with a concrete next correction and safe fallback. Continue unrelated eligible work.

If internal checks and reviews pass, post a concise GitHub delivery comment: issue/brief, PR, base/head, raw evidence locations, actual commands/results, incomplete areas and exact product acceptance steps. Keep status Review and the PR draft while final acceptance is pending. Waiting for ordinary product acceptance is not a `needs-info` park.

## 6. Continue or yield

After delivery or park, return to reconciliation and select the next unblocked issue. Before ending a bounded run, establish stopped/completed writers, record the next step and release the manager lease. On explicit stop, interrupt only owned workers, record their real stopped state and release. Never leave a writer running while releasing merely to give another manager access.

When the product chat needs the lease, yield at this same safe boundary. It may perform read-only acceptance earlier. Do not send another chat a message unless the user explicitly authorized that messaging.

When no eligible issues remain, report delivered heads, parked reasons and checks not run. Do not poll indefinitely. Monitoring requires a user request and a supported scheduler; a skill invocation alone does not keep a chat awake.

## 7. Product acceptance

Only the separate product-verifier session follows [acceptance evidence](acceptance-evidence.md) to record final acceptance and request readiness. Recheck current PR head/base, checks, reviewer independence, worker completion and clean checkouts. The controller refuses missing/stale/failed evidence and the developer manager role.

A product FAIL produces a correction brief and leaves Review. A product BLOCKED names missing evidence/environment. PASS permits Ready to merge only; no merge, deployment, issue close or Done.
