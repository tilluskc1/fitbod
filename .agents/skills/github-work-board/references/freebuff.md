# Freebuff usage

Freebuff loads skills from `.agents/skills/<name>/SKILL.md` and `.claude/skills/<name>/SKILL.md`. The interactive CLI also loads global skills from `~/.agents/skills` and `~/.claude/skills`; project-level `.agents` has highest precedence.

This installation is global for the local Freebuff CLI:

```text
~/.agents/skills/github-work-board/
```

Start Freebuff in the target repository, then invoke:

```text
/skill:github-work-board
```

You may also ask naturally to inspect or run the configured GitHub work board; model invocation is enabled.

Freebuff Cloud does not read a server's home skills. For Cloud or a team-shared setup, copy this skill directory into the target repository at `.agents/skills/github-work-board/` and commit it through the repository's normal review process.

The skill uses ordinary `git`, `gh` and `jq` through the host terminal tool. It does not require executable `.agents` code or `mcp.json`, so installing it as Markdown plus shell scripts does not trigger Freebuff's executable-agent trust gate.

When `spawn_agents` is available, create only one role worker at a time. If no suitable separate worker is available, continue serially but report `Review independence: none; same agent implemented and reviewed`, and do not present that review as equivalent to an independent pass.

