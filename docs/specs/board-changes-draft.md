# Fitbod board — proposed changes (DRAFT, nothing posted)

Repo: `tilluskc1/fitbod` · Board: Project 11

## 0. Corrections to my first read

- **Labels are not contradictory.** Your loop uses `ready-for-agent` = claimed and `needs-info` = parked (AGENTS.md). Leave them.
- **#7, #8, #13, #14, #29 are parked on you, not on agents.** The loop's own comments say so:
  - #13/#14/#7 need a test Supabase project, credentials and a Gemini key.
  - #29 has a storage design waiting for your approval in its last comment.

## 1. Split #8 — take local preferences off the AI/auth chain

This is the change that unblocks #30.

### New issue: `[P1] AS-P1-04a — Save exercise preferences and exclusions on this device`

```markdown
**Blocked by:** None.
**Unblocks:** #30 (more often / less often / don't recommend again).

## Summary
Let a user mark an exercise variant "more often", "less often" or "don't recommend again" and review, edit or remove those choices. Local profile only: no AI, no account, no natural-language input.

## Acceptance criteria
- [ ] More often / less often / neutral are mutually exclusive. "Don't recommend again" is an exclusion.
- [ ] Each change previews its future scope and needs confirmation. Cancelling changes nothing.
- [ ] Confirmed choices survive reload and are listed on one review/edit/delete surface.
- [ ] The deterministic generator uses them: an exclusion removes the variant, more/less adjusts eligibility or emphasis. A preference never silently defeats an explicit exclusion; a conflict shows a clarification.
- [ ] Repeated skips do not create permanent settings.
- [ ] Reset clears preferences without touching workout records. Existing local export/restore includes them.
- [ ] Stored-data change is presented for owner approval before implementation (AGENTS.md autonomy rule).

## Out of scope
Natural-language preference capture, dated travel context, account sync (all stay in #8).
```

### Edit #8 → `[P1] AS-P1-04b — AI-proposed preferences and dated travel context`

- Change "Blocked by" to: **#7, #13, AS-P1-04a**.
- Remove the first and fourth acceptance criteria: the "Prefer floor press permanently" preview, and "Temporary equipment never overwrites… A preference cannot silently defeat an explicit exclusion… Repeated skips…". Replace them with one line: *"Reuses AS-P1-04a's preference store and conflict rules; adds natural-language proposal via #7."*
- Keep the travel-context, expiry, raw-conversation, account-switch and Observe→Propose→Confirm criteria.

### Edit #30

- Change the "Blocked by" line to `AS-P1-04a, #26` (drop #8). Update the native GitHub dependency the same way: it currently lists 8 and 26.

## 2. Split #7 — separate what can be built here from what needs your keys

### `[P1] AS-P1-03a — Adaptation intent contract and engine integration`

```markdown
**Blocked by:** #5, #6 (merged).

## Summary
Define the strict intent/constraints/scope/clarification schema and wire a validated intent into the existing deterministic proposal → approve → apply path. Quick controls and a parsed intent must converge on one proposal.

## Acceptance criteria
- [ ] '20 minutes, dumbbells only' as a fixture intent and the equivalent quick controls produce the same executable proposal, with preview of original/proposed exercises, working sets, duration, load changes, reasons and today-only scope.
- [ ] Unknown exercise/equipment IDs, extra properties and out-of-schema values are rejected; valid JSON shape is not treated as semantic correctness.
- [ ] Ambiguous/contradictory intents produce one focused clarification; impossible equipment/duration shows limits; pain input offers stop/exclude/manual without diagnosis.
- [ ] Accept/edit/reject/undo use #3's revision checks. Manual adjustment stays available.
- [ ] UI shows a truthful "AI unavailable" state; no live provider is called.

## Out of scope
Network endpoint, auth, rate limits, live model (AS-P1-03b/c).
```

### `[P1] AS-P1-03b — Authenticated adaptation endpoint with limits`

```markdown
**Blocked by:** AS-P1-03a, AS-INF-01a.

## Summary
One Vercel function that verifies Supabase identity server-side and returns a validated intent from a provider stub behind a single function boundary.

## Acceptance criteria
- [ ] Ownership derived from verified identity, never a submitted owner ID. Provider/privileged keys never reach the browser bundle.
- [ ] Atomic per-user limits (10/min, 50/day), 2,000-character input bound, 10-second deadline, max output size, server-side AI disable switch.
- [ ] Timeout, 429, invalid output, auth expiry, outage and offline apply nothing silently. Duplicate request IDs are idempotent and cannot bypass limits.
- [ ] Anonymized outcome/latency/usage logging with no raw prompts, emails, tokens or medical details.
- [ ] Verified against the local Supabase stack (`supabase start`).
```

### `[P1] AS-P1-03c — Configure Gemini Flash-Lite and run the live smoke suite` — label `ready-for-human`

```markdown
**Blocked by:** AS-P1-03b. Needs owner: Gemini API key, Vercel project, data-use decision.

## Acceptance criteria
- [ ] Exact GEMINI_MODEL configured at deployment; structured output verified with a live synthetic smoke test (supported, ambiguous, contradictory, unsupported inputs).
- [ ] Free/unpaid tier used with synthetic non-personal prompts only. Before real pilot requests, owner confirms a deployment whose data-use terms permit the actual input.
- [ ] No hard-coded unverified model ID; no latency/accuracy claims from mocks.
```

Close #7 as "split into 03a/03b/03c" with links.

## 3. Split #13 — make it verifiable without a cloud project

The loop parked #13 because it had no test Supabase project. The Supabase CLI's local stack (`supabase start`, Docker) runs Postgres, Auth and a local inbox for email codes. That makes the code and the two-user RLS tests verifiable in-repo.

### `[P1] AS-INF-01a — Sign-in, local mode and isolated profile (local Supabase stack)`

All current #13 acceptance criteria **except** the Vercel preview line, verified against `supabase start` with two test users and anonymous direct requests. Add:
- [ ] `supabase/` config and versioned migrations committed; README documents `supabase start` and the test command.

### `[P1] AS-INF-01b — Vercel preview and production Supabase configuration` — label `ready-for-human`

- [ ] Vercel preview uses the test Supabase project and allowed auth redirect URLs; production is separate.
- [ ] Deploy/rollback runbook. No production migration without owner sign-off.

Edit #13 to become 01a (keep its number); open 01b.

## 4. Split #14 into two reviewable PRs

### Edit #14 → `AS-INF-02a — Upload completed workouts once, offline-safe`

Blocked by #6, AS-INF-01a. Keep criteria 1, 4, 5 and 6 (offline finish → reconnect uploads once; preview before first link; pending/error status; malformed records and cross-account isolation).

### New `AS-INF-02b — Restore on a second device and resolve correction conflicts`

Blocked by AS-INF-02a. Criteria 2, 3, 7 and 8 (second-device restore, offline correction conflicts, active session labelled device-local, sequence/progression metadata preserved).

## 5. Remove repeated boilerplate

Every AS-* issue repeats the same three sections (about 25 lines each). Proposal:

1. Add `docs/agents/story-contract.md` holding **Product contract**, **Implementation guardrails** and **Verification and readiness** verbatim.
2. Add one line under "Issue board" in AGENTS.md: *"Every AS-* story also obeys `docs/agents/story-contract.md`."*
3. In each issue, replace the three sections with: `Shared contract: docs/agents/story-contract.md (revision AS-2026-10-29-r2).`

Risk: if the orchestrator gives a worker the issue body only, the worker won't see the contract. The AGENTS.md line covers this because workers read AGENTS.md.

## 6. Things only you can do (no issue change needed)

1. Review/merge PRs #37 (progression) and #39 (program sequence). Everything else builds on them.
2. Approve or reject the storage design in #29's last comment.
3. Approve the AS-P1-04a stored-data change once drafted.
4. Decide whether the cloud work (#13 → #14 → #7) starts before the pilot or after.
