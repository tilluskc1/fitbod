#!/usr/bin/env bash
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(cd "$(mktemp -d)" && pwd -P); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/stub"

cat > "$T/bin/gh" << 'EOF'
#!/usr/bin/env bash
[ -f "$STUB/fail" ] && { [ -f "$STUB/error" ] && cat "$STUB/error" >&2; echo x >> "$STUB/failed"; exit 1; }
echo "$*" >> "$STUB/calls"
case "$1 $2" in
  "auth status") ;;
  "repo view") echo acme/widget ;;
  "project view") cat "$STUB/project.json" ;;
  "project field-list") cat "$STUB/fields.json" ;;
  "project item-list") cat "$STUB/items.json" ;;
  "project item-edit") ;;
  "issue view") cat "$STUB/issue-$3.json" ;;
  "issue edit" | "issue comment") ;;
  "pr list") case "$*" in *"--state closed"*) cat "$STUB/prs-closed.json" ;; *) cat "$STUB/prs-open.json" ;; esac ;;
  "pr view") cat "$STUB/pr-$3.json" ;;
  "pr comment" | "pr ready") ;;
  "label list") cat "$STUB/labels.json" ;;
  *) echo "stub: unhandled $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$T/bin/gh"

export PATH="$T/bin:$PATH" STUB="$T/stub" GITHUB_WORK_BOARD_REPO="$T/repo" GITHUB_WORK_BOARD_CONFIG="$T/repo/.github/work-board.json" GITHUB_WORK_BOARD_LOCK="$T/lock" GITHUB_WORK_BOARD_BACKOFF="$T/backoff" GITHUB_WORK_BOARD_WT_ROOT="$T/wt"
S=$T/stub
B="bash $HERE/board.sh"
pass=0 fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL $1: expected [$3] got [$2]"; fi; }
called() { grep -c -F -- "$1" "$S/calls" 2> /dev/null || true; }
g() { git -C "$T/repo" "$@"; }

# ---- repository and configuration ----
git init -q --bare "$T/origin.git"
git clone -q "$T/origin.git" "$T/repo" 2> /dev/null
g checkout -q -b main; g config user.email test@example.test; g config user.name test
mkdir -p "$T/repo/.github" "$T/repo/src"
echo '# Test' > "$T/repo/AGENTS.md"; echo 'base' > "$T/repo/src/base.txt"
cat > "$T/repo/.github/work-board.json" << 'EOF'
{
  "version": 1,
  "repository": "acme/widget",
  "projectOwner": "acme",
  "projectNumber": 3,
  "baseBranch": "main",
  "statusField": "Status",
  "statusKey": "status",
  "priorityKey": "priority",
  "priorityOrder": ["P0", "P1", "P2"],
  "readyStatuses": ["Ready"],
  "inProgressStatus": "In progress",
  "reviewStatus": "Review",
  "readyToMergeStatus": "Ready to merge",
  "ownedLabel": "agent-run",
  "blockedLabel": "needs-owner",
  "branchPrefix": "work/",
  "uiPatterns": ["src/app/*", "*.tsx", "*.css"]
}
EOF
g add -A; g commit -q -m base; g push -q origin main 2> /dev/null
BASE=$(g rev-parse origin/main)

# ---- GitHub fixtures ----
cat > "$S/project.json" << 'EOF'
{"id":"P3","title":"Work"}
EOF
cat > "$S/fields.json" << 'EOF'
{"fields":[{"id":"F_STATUS","name":"Status","options":[{"id":"S_READY","name":"Ready"},{"id":"S_PROGRESS","name":"In progress"},{"id":"S_REVIEW","name":"Review"},{"id":"S_RTM","name":"Ready to merge"}]}]}
EOF
cat > "$S/items.json" << 'EOF'
{"items":[
 {"id":"I1","content":{"number":1},"status":"Ready","priority":"P0","labels":[]},
 {"id":"I2","content":{"number":2},"status":"Ready","priority":"P1","labels":["needs-owner"]},
 {"id":"I3","content":{"number":3},"status":"In progress","priority":"P1","labels":["agent-run"]}
]}
EOF
issue() { printf '{"number":%s,"title":"%s","body":"%s","labels":%s,"comments":%s,"state":"OPEN","url":"https://example.test/%s"}\n' "$1" "$2" "$3" "$4" "$5" "$1" > "$S/issue-$1.json"; }
issue 1 "Add login screen" "Acceptance criteria here" '[]' '[]'
issue 2 "Needs decision" "Blocked" '[{"name":"needs-owner"}]' '[]'
issue 3 "Existing work" "In progress" '[{"name":"agent-run"}]' '[{"body":"[work-board] step=build"}]'
echo '[{"name":"agent-run"},{"name":"needs-owner"}]' > "$S/labels.json"
echo '[]' > "$S/prs-open.json"; echo '[]' > "$S/prs-closed.json"

# ---- preflight and triage ----
check "doctor offline" "$($B doctor --offline --json | jq -r .ok)" "true"
check "doctor online" "$($B doctor --json | jq -r .ok)" "true"
check "triage priority and blocked filter" "$($B triage --json | jq -r 'map(.number)|join(",")')" "1"
check "triage check" "$($B triage 1 | cut -f4)" "CHECK"

g branch work/1-first "$BASE"; g branch work/1-second "$BASE"
check "ambiguous branches refused" "$($B triage 1 2>&1 | cut -d' ' -f1-3)" "error ambiguous local"
g branch -D work/1-first work/1-second > /dev/null

# ---- lock ----
check "claim free" "$($B claim A)" "claimed"
( GITHUB_WORK_BOARD_CLAIM_HOLD=1 $B claim A > "$T/claim-a" ) & claim_pid=$!
sleep 0.1
$B claim B > "$T/claim-b"
wait "$claim_pid"
check "atomic winner" "$(cat "$T/claim-a")" "claimed"
check "atomic loser" "$(cut -d' ' -f1 < "$T/claim-b")" "locked"
check "guard cleaned" "$([ ! -e "$T/lock.guard" ] && echo yes || echo no)" "yes"

# ---- start and worktree ----
: > "$S/calls"
check "start" "$($B start 1)" "started #1"
check "start label" "$(called 'issue edit 1 -R acme/widget --add-label agent-run')" "1"
check "start status" "$(called 'single-select-option-id S_PROGRESS')" "1"
check "start comment" "$(called 'issue comment 1 -R acme/widget --body [work-board] started')" "1"

WT=$($B worktree 1)
check "worktree path" "$WT" "$T/wt/1-add-login-screen"
check "worktree branch" "$(git -C "$WT" branch --show-current)" "work/1-add-login-screen"
mkdir -p "$WT/src/app"; echo ui > "$WT/src/app/login.tsx"; git -C "$WT" add -A; git -C "$WT" commit -q -m implementation
H=$(git -C "$WT" rev-parse HEAD); git -C "$WT" push -q origin work/1-add-login-screen 2> /dev/null
check "changed ui" "$($B changed --json 1 "$BASE" "$H" | jq -r '.kind+":"+(.ui|tostring)')" "code:true"

# ---- state and verification ----
sed -i.bak 's/"status":"Ready","priority":"P0","labels":\[\]/"status":"In progress","priority":"P0","labels":["agent-run"]/' "$S/items.json"
issue 1 "Add login screen" "Acceptance criteria here" '[{"name":"agent-run"}]' '[{"body":"[work-board] step=review"}]'
cat > "$S/prs-open.json" << EOF
[{"number":20,"headRefName":"work/1-add-login-screen","headRefOid":"$H","isDraft":true,"title":"Add login"}]
EOF
echo '{"comments":[]}' > "$S/pr-20.json"
check "state number" "$($B state --json | jq -r 'map(.number)|join(",")')" "1,3"
check "state head" "$($B state --json 1 | jq -r '.[0].head')" "$H"
check "verify at" "$($B verify-at 1 "$H")" "$T/wt/1-verify"
check "verify clean" "$($B verify-check 1 "$H")" "clean"
touch "$T/wt/1-verify/dirty"
check "verify dirty refused" "$($B verify-check 1 "$H" | cut -d' ' -f1-3)" "refused verifier worktree"
rm "$T/wt/1-verify/dirty"

# ---- ready gate ----
check "ready mismatched review refused" "$($B ready 1 "$BASE" "$H" | cut -d' ' -f1-4)" "refused reviewed SHA and"
: > "$S/calls"
check "ready" "$($B ready 1 "$H" "$H")" "ready #1 PR #20"
check "ready marks PR" "$(called 'pr ready 20')" "1"
check "ready status" "$(called 'single-select-option-id S_RTM')" "1"
check "never merges" "$(called merge)" "0"
check "verify remove" "$($B verify-remove 1)" "removed"

# ---- watcher backoff ----
check "release" "$($B release A)" "released"
check "watch tick" "$($B claim C > /dev/null; $B watch C --interval 1 --jitter 0 --tick 2)" "tick"
touch "$S/fail"; echo 'API rate limit exceeded' > "$S/error"; rm -f "$S/failed"
check "watch rate limit" "$($B watch C --interval 1 --jitter 0 --max 3)" "error github rate-limit"
check "backoff persisted" "$([ -f "$T/backoff" ] && echo yes || echo no)" "yes"
rm "$S/fail" "$S/error"

echo "github-work-board self-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
