# Acceptance evidence and controller commands

## Session and lease

Before a mutating command, export `GITHUB_WORK_BOARD_OWNER`, `GITHUB_WORK_BOARD_TOKEN` and `GITHUB_WORK_BOARD_ROLE`. OWNER is the stable unique session identity. TOKEN is a fresh unpredictable local coordination credential. ROLE is `manager` in the developer chat or `product-verifier` in the separate acceptance chat. Do not expose tokens in reports.

| Command | Result |
| --- | --- |
| `B claim OWNER TOKEN` | Obtain a new lease, or renew the same live owned lease. A foreign or expired lease is refused. |
| `B renew` | Renew the current live owned lease. Run between bounded waits before one third of its lifetime. |
| `B release` | Release an owned lease at a safe boundary after writers are complete/stopped. |
| `B reclaim OWNER TOKEN --workers-stopped` | Explicit stale recovery after independently establishing old writers stopped. Expiry alone is insufficient. |
| `B status` / `B state --json` / `B triage --json` | Inspect without claiming a lease or mutating GitHub. |

Reclaim does not stop host workers. The caller must reconcile/interrupt owned old workers using host tools before asserting `--workers-stopped`. If their state cannot be established, stop recovery and report the blocker. This flag is an explicit operational assertion, not proof of process termination.

## Worker lifecycle

`B worker N ID ROLE STATE SHA` records one host worker for an issue. STATE is `running`, `complete`, or `stopped`. SHA is the full assigned/delivered head, or `-` when no commit exists yet (for example requirements/initial plan). Use actual host worker IDs and the roles defined in the controller. Capture the returned ID immediately after spawn; if registration is refused, interrupt the child before it starts writing. A completed implementer record identifies the delivered head for independent reviews.

Before dispatching a writer, the manager must establish no other implementation worker is running. Worker completion means the host returned and the manager checked its result; it cannot be inferred from a quiet tab or a status comment. Records are durable coordination state, not a scheduler or a live-process API.

The product-verifier identity comes from its session actor environment and its acceptance receipt; it does not register an acceptance subagent through `B worker`. Managers cannot record final acceptance or call ready.

## Structured reviews

Use `B review N /absolute/path/report.json`. The report records the current repository, issue, full PR head and base, reviewer/implementer identities, verdict, actual checks and evidence. Supply the report from the worker whose ID is registered as complete at that head. Do not write PASS on behalf of unfinished work.

```json
{
  "repository": "owner/repository",
  "issue": 42,
  "headSha": "FULL_CURRENT_HEAD_SHA",
  "baseSha": "FULL_CURRENT_BASE_SHA",
  "role": "qa",
  "reviewerId": "actual-returned-reviewer-worker-id",
  "implementerId": "actual-returned-implementer-worker-id",
  "verdict": "PASS",
  "checks": [
    {"command": "repository test command", "exitCode": 0}
  ],
  "evidence": ["/absolute/path/to/raw-test-output.log"],
  "notVerified": []
}
```

Use FAIL for a reproduced acceptance violation, BLOCKED for missing mandatory evidence/environment. If no verifier checkout can be established, record the BLOCKED handoff with `B note N TEXT` and its raw setup evidence; do not fabricate a valid review receipt or readiness record. Every required acceptance criterion maps to evidence or a blocker in the report's linked acceptance matrix. PASS requires enough independent evidence for all mandatory criteria; passing helper tests alone is insufficient. `notVerified` names remaining nonrequired limits honestly (for example, physical devices when emulated mobile journeys meet the issue requirement). Material required gaps make the verdict BLOCKED.

The baseline required roles are QA, Standards and final acceptance. A UI diff additionally requires product review; persistence/authentication/security-sensitive paths require reliability review. `requiredReviewRoles` in repository configuration can add requirements. Requirements review may require extra human/external gates; these still apply even when a path-based classifier misses the affected behavior. Classification assists selection; it is not a substitute for tracing affected callers/readers.

Independent reviewers use identities different from the registered implementer. The acceptance reviewer is the separate product-verifier session. Its identity must match the active session actor; the developer manager cannot supply its own acceptance receipt. Local role/identity assertions are workflow checks, not a tamperproof authentication boundary.

Review records are stored under the Git common directory, outside committed application state. Evidence itself belongs in the repository's specified review directory and stays uncommitted unless requested. Keep raw results and source/served-build correspondence; the controller validates receipt consistency, not the truth of a claimed test result.

## Final readiness

After internal handoff, the product chat independently verifies one delivered issue/PR and obtains its own lease at a safe manager handoff boundary. Record `acceptance` PASS only after the review is complete. Then run:

```text
B verify-check N HEAD
B ready N HEAD HEAD
```

`ready` checks current PR head/base, base ancestry, clean developer and verifier checkouts, completed workers and all required independent PASS records for that exact revision. Any missing, failed, blocked or stale review refuses readiness. `B move` cannot set Ready to merge. Only `product-verifier` may call ready; this does not authorize merge, deployment, issue closure or Done.

If the head or base changes during review, preserve findings against the pinned version. Revalidate affected behavior and record new exact-version reports before readiness. Never relabel an old report with a new SHA. Releasing/reclaiming a lease does not transfer review authority or turn an incomplete review into PASS.
