# Repository configuration

The controller reads `${GITHUB_WORK_BOARD_CONFIG}` when set, otherwise `<repo>/.github/work-board.json`. Configuration is repository-owned because board fields, labels and branch conventions are product decisions.

Use [the example configuration](../assets/work-board.example.json) as the starting point. Required meanings:

| Field | Meaning |
|---|---|
| `repository` | Exact GitHub `owner/repo`; must match the checkout. |
| `projectOwner` / `projectNumber` | User or organization and GitHub Project v2 number. |
| `baseBranch` | Branch from which new feature worktrees start. |
| `statusField` / `statusKey` | Display name of the Project single-select field and the key emitted by `gh project item-list`. Usually `Status` and `status`. |
| `priorityKey` / `priorityOrder` | Item-list key and desired selection order. Empty order means preserve board order. |
| `readyStatuses` | Statuses eligible for selection. |
| `inProgressStatus` | Status set when work starts. |
| `reviewStatus` | Status set before independent review. |
| `readyToMergeStatus` | Final status set by this workflow. It must not imply merged or deployed. |
| `ownedLabel` | Issue label marking work owned by this workflow. |
| `blockedLabel` | Issue label used when a human decision or external action is required. |
| `branchPrefix` | Prefix before `<issue>-<slug>`, such as `work/` or `feature/`. |
| `uiPatterns` | Shell-style paths that make product/UI review applicable. |

Optional `worktreeRoot` may be absolute or relative to the repository parent. Without it, the controller uses `<repo-parent>/<repo-name>-worktrees`.

## Onboarding procedure

1. Read repository instructions and detect the exact GitHub repository from `origin`.
2. List accessible GitHub Projects and inspect the selected project's fields read-only.
3. Show the proposed status mapping, labels, base branch and branch prefix. Do not infer semantic equivalence from names alone when several choices are plausible.
4. Confirm that `readyToMergeStatus` is a pre-merge status and that the two labels already exist, or explicitly include label creation as separate setup work.
5. Write `.github/work-board.json`, run `B doctor --json`, and stop. Do not start issue work unless the user also requested it.

Never commit credentials, project tokens, field IDs or option IDs. The controller resolves mutable GitHub IDs from the configured names each run.

