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
  "api --paginate") [ ! -f "$STUB/fail-deps" ] || exit 1; path=${@: -1}; n=$(echo "$path" | sed -n 's#.*issues/\([0-9]*\)/dependencies/blocked_by#\1#p'); [ -f "$STUB/deps-$n.json" ] && cat "$STUB/deps-$n.json" || echo '[[]]' ;;
  "api repos/acme/widget/issues/99") echo '{"state":"open"}' ;;
  "label list") cat "$STUB/labels.json" ;;
  *) echo "stub: unhandled $*" >&2; exit 1 ;;
esac
EOF
chmod +x "$T/bin/gh"

export PATH="$T/bin:$PATH" STUB="$T/stub" GITHUB_WORK_BOARD_REPO="$T/repo" GITHUB_WORK_BOARD_CONFIG="$T/repo/.github/work-board.json" GITHUB_WORK_BOARD_LOCK="$T/lock" GITHUB_WORK_BOARD_BACKOFF="$T/backoff" GITHUB_WORK_BOARD_WT_ROOT="$T/wt" GITHUB_WORK_BOARD_OWNER=A GITHUB_WORK_BOARD_TOKEN=token-A GITHUB_WORK_BOARD_ROLE=manager
S=$T/stub
B="bash $HERE/board.sh"
pass=0 fail=0
check() { if [ "$2" = "$3" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "FAIL $1: expected [$3] got [$2]"; fi; }
code() { $B "$@" > "$T/last-output" 2>&1; echo $?; }
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
 {"id":"I1","content":{"number":1,"repository":"acme/widget","type":"Issue"},"status":"Ready","priority":"P0","labels":[]},
 {"id":"I2","content":{"number":2,"repository":"acme/widget","type":"Issue"},"status":"Ready","priority":"P1","labels":["needs-owner"]},
 {"id":"I3","content":{"number":3,"repository":"acme/widget","type":"Issue"},"status":"In progress","priority":"P1","labels":["agent-run"]}
],"totalCount":3}
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
touch "$S/fail-deps"
check "dependency read failure propagates through JSON" "$(code triage --json 1)" "1"
rm "$S/fail-deps"
cp "$S/items.json" "$S/items-original.json"
jq '.totalCount=501' "$S/items.json" > "$S/items-temp"; mv "$S/items-temp" "$S/items.json"
check "truncated board refuses" "$(code triage --json)" "1"
cp "$S/items-original.json" "$S/items.json"
jq '.items += [{id:"FOREIGN",content:{number:1,repository:"other/repo",type:"Issue"},status:"Ready",priority:"P0",labels:[]}] | .totalCount=4' "$S/items.json" > "$S/items-temp"; mv "$S/items-temp" "$S/items.json"
check "foreign issue numbers ignored" "$($B triage --json | jq -r 'map(.number)|join(",")')" "1"
cp "$S/items-original.json" "$S/items.json"

g branch work/1-first "$BASE"; g branch work/1-second "$BASE"
check "ambiguous branches refused" "$($B triage 1 2>&1 | cut -d' ' -f1-3)" "error ambiguous local"
g branch -D work/1-first work/1-second > /dev/null

# ---- lock ----
check "claim free" "$($B claim A token-A)" "claimed"
check "doctor succeeds with live lease" "$(code doctor --offline --json)" "0"
check "doctor live lease output" "$($B doctor --offline --json | jq -r .lock | cut -d' ' -f1-2)" "A manager"
( GITHUB_WORK_BOARD_CLAIM_HOLD=1 $B claim A token-A > "$T/claim-a" ) & claim_pid=$!
sleep 0.1
GITHUB_WORK_BOARD_OWNER=B GITHUB_WORK_BOARD_TOKEN=token-B $B claim B token-B > "$T/claim-b"
wait "$claim_pid"
check "atomic winner" "$(cat "$T/claim-a")" "claimed"
check "atomic loser" "$(cut -d' ' -f1 < "$T/claim-b")" "refused"
check "guard cleaned" "$([ ! -e "$T/lock.guard" ] && echo yes || echo no)" "yes"
check "lease renewal" "$($B renew)" "renewed"
check "token hidden from status" "$($B status | grep -c token-A || true)" "0"
check "lock file private" "$(stat -f %Lp "$T/lock" 2>/dev/null || stat -c %a "$T/lock")" "600"
cp "$T/lock" "$T/lock-original"
jq '.time=0' "$T/lock" > "$T/old-lock"; mv "$T/old-lock" "$T/lock"
check "expired owner cannot renew" "$(code renew)" "3"
check "stale lease never automatically stolen" "$(GITHUB_WORK_BOARD_OWNER=B GITHUB_WORK_BOARD_TOKEN=token-B $B claim B token-B | cut -d' ' -f1)" "refused"
check "reclaim needs worker-stop acknowledgment" "$(code reclaim A token-A missing)" "3"
check "explicit stale recovery" "$($B reclaim A token-A --workers-stopped)" "claimed"
check "reclaim refuses live lease" "$(code reclaim A token-A --workers-stopped)" "3"

# ---- start and worktree ----
: > "$S/calls"
touch "$S/fail-deps"
check "failed dependency prevents start writes" "$(code start 1)" "1"
check "failed dependency made no issue edit" "$(called 'issue edit')" "0"
rm "$S/fail-deps"
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
[{"number":20,"headRefName":"work/1-add-login-screen","headRefOid":"$H","isDraft":true,"baseRefName":"main","isCrossRepository":false,"title":"Add login"}]
EOF
echo '{"comments":[]}' > "$S/pr-20.json"
check "state number" "$($B state --json | jq -r 'map(.number)|join(",")')" "1,3"
check "state head" "$($B state --json 1 | jq -r '.[0].head')" "$H"
MANAGED="$T/managed-checkout/Fitbod"
mkdir -p "$(dirname "$MANAGED")"
g worktree move "$WT" "$MANAGED"
WT=$MANAGED
check "state finds managed worktree by branch" "$($B state --json 1 | jq -r '.[0].worktree')" "$WT"
check "state finds managed worktree head" "$($B state --json 1 | jq -r '.[0].head')" "$H"
check "worktree reuses managed checkout" "$($B worktree 1)" "$WT"
g worktree add -q -b work/1-other "$T/another-managed/Fitbod" "$H"
check "multiple issue worktrees refuse" "$(code state --json 1)" "1"
g worktree remove "$T/another-managed/Fitbod"
g branch -D work/1-other >/dev/null
check "verify at" "$($B verify-at 1 "$H")" "$T/wt/1-verify"
check "verify clean" "$($B verify-check 1 "$H")" "clean"
check "unknown verifier commit refused" "$(code verify-at 1 nonexistent-commit)" "3"
touch "$T/wt/1-verify/dirty"
check "verify dirty refused" "$($B verify-check 1 "$H" | cut -d' ' -f1-3)" "refused verifier worktree"
check "verify-at never carries dirty source" "$(code verify-at 1 "$BASE")" "3"
rm "$T/wt/1-verify/dirty"

# ---- ready gate ----
check "manager ready requires product role" "$($B ready 1 "$BASE" "$H" | cut -d' ' -f1)" "refused"
: > "$S/calls"
check "manager ready refused" "$($B ready 1 "$H" "$H" | cut -d' ' -f1)" "refused"
check "move ready refused" "$($B move 1 'Ready to merge' | cut -d' ' -f1)" "refused"
check "missing owner mutation refused" "$(GITHUB_WORK_BOARD_TOKEN=wrong $B move 1 Review | cut -d' ' -f1)" "refused"
issue 1 "Add login screen" "Blocked by: #99" '[{"name":"agent-run"}]' '[]'
check "text dependency waits" "$($B triage 1 | cut -f4)" "WAIT"
check "start rechecks dependency" "$($B start 1 | cut -d' ' -f1)" "refused"
issue 1 "Add login screen" "Acceptance criteria here" '[{"name":"agent-run"}]' '[]'
echo '[[{"state":"open","number":99}]]' > "$S/deps-1.json"
check "native dependency waits" "$($B triage 1 | cut -f4)" "WAIT"
echo '[[]]' > "$S/deps-1.json"
check "reviewer cannot complete without dispatch" "$(code worker 1 never-dispatched qa complete "$H")" "3"
$B worker 1 /root/controller22 implementer running - >/dev/null
check "second implementer refused" "$(code worker 3 implementer-2 implementer running -)" "3"
check "running worker blocks release" "$(code release)" "3"
$B worker 1 /root/controller22 implementer complete "$H" >/dev/null
STATE_DIR="$(g rev-parse --path-format=absolute --git-common-dir)/github-work-board"
check "raw canonical worker identity retained" "$(jq -r .id "$STATE_DIR/workers/1/id-%2Froot%2Fcontroller22.json" 2>/dev/null)" "/root/controller22"
$B worker 1 '../../escape' requirements running - >/dev/null
check "opaque identity cannot escape registry" "$([ -f "$STATE_DIR/workers/1/id-..%2F..%2Fescape.json" ] && [ ! -e "$STATE_DIR/escape.json" ] && echo safe)" "safe"
$B worker 1 '../../escape' requirements stopped - >/dev/null
COMPLETE_BEFORE=$(cat "$STATE_DIR/workers/1/id-%2Froot%2Fcontroller22.json")
jq '.time=0' "$T/lock" > "$T/expired-lock"; mv "$T/expired-lock" "$T/lock"
$B reclaim A token-A --workers-stopped >/dev/null
check "reclaim preserves completed worker record" "$(cat "$STATE_DIR/workers/1/id-%2Froot%2Fcontroller22.json")" "$COMPLETE_BEFORE"
for role in qa standards product; do
  $B worker 1 "/root/reviewer-$role" "$role" running "$H" >/dev/null
  $B worker 1 "/root/reviewer-$role" "$role" complete "$H" >/dev/null
  jq -n --arg role "$role" --arg head "$H" --arg base "$BASE" '{repository:"acme/widget",issue:1,headSha:$head,baseSha:$base,role:$role,reviewerId:("/root/reviewer-"+$role),implementerId:"/root/controller22",verdict:"PASS",checks:[{command:"test",exitCode:0}],evidence:["https://example.test/evidence"],notVerified:[]}' > "$T/review-$role.json"
  $B review 1 "$T/review-$role.json" >/dev/null
done
jq '.role="acceptance" | .reviewerId="A"' "$T/review-qa.json" > "$T/manager-acceptance.json"
check "manager cannot submit acceptance" "$(code review 1 "$T/manager-acceptance.json")" "3"
jq '.reviewerId=.implementerId' "$T/review-qa.json" > "$T/self-review.json"
check "self-review refused" "$(code review 1 "$T/self-review.json")" "3"
jq '.checks[0].exitCode=1' "$T/review-qa.json" > "$T/red-check.json"
check "PASS with failed command refused" "$(code review 1 "$T/red-check.json")" "3"
jq '.checks=[]' "$T/review-qa.json" > "$T/no-check.json"
check "PASS without commands refused" "$(code review 1 "$T/no-check.json")" "3"
jq '.evidence=[]' "$T/review-qa.json" > "$T/no-evidence.json"
check "review without evidence refused" "$(code review 1 "$T/no-evidence.json")" "3"
jq '.reviewerId="unknown"' "$T/review-qa.json" > "$T/unknown-reviewer.json"
check "unregistered reviewer refused" "$(code review 1 "$T/unknown-reviewer.json")" "3"
jq --arg base "$BASE" '.headSha=$base' "$T/review-qa.json" > "$T/stale-review.json"
check "stale reviewer commit refused" "$(code review 1 "$T/stale-review.json")" "3"
cp "$S/prs-open.json" "$T/prs-correct.json"
jq '.[0].baseRefName="other-base"' "$T/prs-correct.json" > "$S/prs-open.json"
check "review refuses wrong PR base" "$(code review 1 "$T/review-qa.json")" "3"
cp "$T/prs-correct.json" "$S/prs-open.json"
check "release manager" "$($B release)" "released"
export GITHUB_WORK_BOARD_OWNER=product-chat GITHUB_WORK_BOARD_TOKEN=product-token GITHUB_WORK_BOARD_ROLE=product-verifier
$B claim product-chat product-token >/dev/null
check "missing acceptance refused" "$($B ready 1 "$H" "$H" | cut -d' ' -f1)" "refused"
jq -n --arg head "$H" --arg base "$BASE" '{repository:"acme/widget",issue:1,headSha:$head,baseSha:$base,role:"acceptance",reviewerId:"product-chat",implementerId:"/root/controller22",verdict:"PASS",checks:[{command:"acceptance",exitCode:0}],evidence:["https://example.test/acceptance"],notVerified:[]}' > "$T/acceptance.json"
jq '.reviewerId="different-product-chat"' "$T/acceptance.json" > "$T/other-acceptance.json"
check "acceptance actor must match product session" "$(code review 1 "$T/other-acceptance.json")" "3"
$B review 1 "$T/acceptance.json" >/dev/null
touch "$T/wt/1-verify/dirty"
check "ready refuses dirty verifier" "$(code ready 1 "$H" "$H")" "3"
rm "$T/wt/1-verify/dirty"
jq '.verdict="BLOCKED"' "$T/acceptance.json" > "$T/blocked-acceptance.json"
$B review 1 "$T/blocked-acceptance.json" >/dev/null
check "BLOCKED acceptance refuses" "$(code ready 1 "$H" "$H")" "3"
$B review 1 "$T/acceptance.json" >/dev/null
jq '.[0].baseRefName="other-base"' "$T/prs-correct.json" > "$S/prs-open.json"
check "ready refuses wrong PR base" "$(code ready 1 "$H" "$H")" "3"
jq '.[0].isCrossRepository=true' "$T/prs-correct.json" > "$S/prs-open.json"
check "ready refuses fork head" "$(code ready 1 "$H" "$H")" "3"
cp "$T/prs-correct.json" "$S/prs-open.json"
check "ready" "$($B ready 1 "$H" "$H")" "ready #1 PR #20"
check "ready marks PR" "$(called 'pr ready 20')" "1"
check "ready status" "$(called 'single-select-option-id S_RTM')" "1"
check "never merges" "$(called merge)" "0"
check "verify remove" "$($B verify-remove 1)" "removed"

# ---- Codex heartbeat replaces shell watcher ----
check "release" "$($B release)" "released"
check "watch is not a background manager" "$($B watch C | cut -d' ' -f1)" "refused"
echo "github-work-board self-test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
