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

It stays on until the user says "normal mode" or "stop adhd mode". Those words end it for the rest of the session.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `tilluskc1/fitbod`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
