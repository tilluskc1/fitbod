# Codex orchestration

Use the actual tools exposed by the current Codex host. This workflow uses child agents of the developer chat, not new sidebar chats. `create_thread` is for a user-requested separate chat and is not the dispatch mechanism here. External chat messaging requires explicit user authorization; otherwise publish the GitHub/evidence handoff and let the owner bring it to the product chat.

## Manager startup

Set a unique session ID, unpredictable session token, and the `manager` role using the controller commands in the manager loop. Keep tokens out of issue comments, evidence and worker reports. Record the run/session ID and GitHub references durably. Tokens are local coordination credentials, not GitHub credentials.

Inspect available subagent tools before dispatch. In this host they are `collaboration.spawn_agent`, `followup_task`, `send_message`, `list_agents`, `interrupt_agent`, and `wait_agent`. Another host may expose equivalents: use only advertised capabilities. Do not invent tool names, install infrastructure or change model settings to manufacture support. If no independent worker is available, stop verification at Review and hand off the blocker.

## Dispatch contract

Each prompt includes: issue and current brief; role and phase; absolute isolated worktree path; branch; full base/head SHAs; allowed files/actions; applicable repository instructions; acceptance/evidence location; and stop condition. Reference a durable brief rather than copying unrelated chat history. Prefer a clean child context when sufficient raw material exists. Keep the user's configured model unless they or applicable instructions require a supported override.

1. Spawn a requirements reviewer with read-only authority. Wait for READY or a blocking decision before implementation.
2. Spawn one implementer in plan phase. Inspect the returned plan against authorized scope; continue the same worker in build phase with `followup_task` or the host's resume equivalent.
3. Record the actual returned worker ID and assignment in the controller. If registration fails, interrupt the child before it writes; reconcile before dispatching another implementer.
4. When a worker returns, inspect its raw evidence and actual branch/PR state, then record completed/stopped state. A message alone does not establish tests passed or a commit was pushed.
5. Dispatch independent QA and Standards reviewers at the pinned head. Add product/mobile and reliability review when required. Each reviewer has a different identity from the implementer and inspects unchanged affected callers as well as the diff.

Requirements workers and read-only reviewers may overlap where the work is independent. Keep one implementer running. Do not dispatch duplicate implementers after a quiet interval or a failed tool call whose outcome is unknown.

## Waiting, repairs and interruption

Use long event waits only as supported by the host; the controller lease still needs renewal before expiry. Choose bounded waits shorter than one third of the lease lifetime, renew between waits, and give the user progress updates at the host's required cadence. Prefer event/cursor-based waits over repeated source/chat reads. A wait timeout is not worker completion.

Send defects back to the same implementer with the reviewed SHA, reproduction, violated acceptance requirement and narrow correction. Every repair returns a new head and invalidates old head-bound approvals. After two unsuccessful repair rounds, park that issue with a concrete next action and continue an independent unblocked issue.

On interrupted/compacted sessions, read durable run state, controller state and actual live-worker inventory. Reuse a live worker; assess a completed worker's result. If a worker cannot be found, establish its checkout/PR state before replacing it. If its status cannot be established, park the issue rather than starting a second implementer.

A lost lease pauses the manager and its writers. A replacement manager must establish that old writers are stopped before explicit reclaim. Expiry alone never proves a worker stopped. Do not kill unrelated agents or remove their worktrees.

## Product-chat handoff

Once internal checks/reviews pass, deliver the issue at Review with PR/head/base and reproducible evidence. Waiting for product acceptance is a handoff state, not an active implementation worker; continue the next unblocked issue. Do not add `needs-info` merely because ordinary product verification is pending.

The product chat can verify read-only while the manager runs. It acquires its own lease as `product-verifier` before recording acceptance or readiness. Release the global manager lease at a safe batch boundary or requested handoff after pausing/stopping any writers; never steal another chat's lease. Product acceptance authorizes only Ready to merge, not merge or deployment.
