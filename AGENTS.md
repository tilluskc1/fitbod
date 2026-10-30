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
- `Todo` → `In Progress` when work starts and the issue is assigned. `In Progress` → `Done` only when every acceptance box is checked, the checks pass on the final commit, and it is merged to `main`.
- Never mark `Done` from a feature branch, a passing helper test, or a screenshot that has not been reproduced at 390×844 and 360×780.
- Work left uncommitted, unmerged or unverified keeps its issue open and says so in the comment. Reopening is cheaper than a false `Done`.
- New scope found mid-task gets its own issue; do not quietly widen the one being worked.

Status and field IDs are read with `gh project field-list 11 --owner tilluskc1 --format json`; update with `gh project item-edit`. `docs/agents/issue-tracker.md` covers the issue commands.
