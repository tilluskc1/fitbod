#!/usr/bin/env bash
# Generic mechanical controller for the github-work-board skill.
# Exit 0 success, 1 read/operation error, 2 usage, 3 safety refusal.
set -uo pipefail

die() { echo "error $*" >&2; exit 1; }
refuse() { echo "refused $*"; exit 3; }
now() { date +%s; }
need() { [ "$1" -ge "$2" ] || { echo "error usage $3"; exit 2; }; }

REPO=${GITHUB_WORK_BOARD_REPO:-}
if [ -z "$REPO" ]; then REPO=$(git rev-parse --show-toplevel 2> /dev/null || pwd -P); fi
CONFIG=${GITHUB_WORK_BOARD_CONFIG:-$REPO/.github/work-board.json}
GIT_COMMON=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2> /dev/null || true)
LOCK=${GITHUB_WORK_BOARD_LOCK:-${GIT_COMMON:-$REPO/.git}/github-work-board.lock}
LOCK_GUARD=${GITHUB_WORK_BOARD_LOCK_GUARD:-$LOCK.guard}
STALE=${GITHUB_WORK_BOARD_STALE:-1200}
[[ "$STALE" =~ ^[1-9][0-9]*$ ]] || refuse "lease duration must be a positive integer"
STATE_ROOT=${GITHUB_WORK_BOARD_STATE_ROOT:-${GIT_COMMON:-$REPO/.git}/github-work-board}
CONFIG_ERROR=

load_config() {
  CONFIG_ERROR=
  [ -f "$CONFIG" ] || { CONFIG_ERROR="missing configuration: $CONFIG"; return 1; }
  command -v jq > /dev/null 2>&1 || { CONFIG_ERROR="missing command: jq"; return 1; }
  jq -e '
    (.version == 1) and
    ([.repository,.projectOwner,.baseBranch,.statusField,.statusKey,.priorityKey,.inProgressStatus,.reviewStatus,.readyToMergeStatus,.ownedLabel,.blockedLabel,.branchPrefix] | all(type == "string" and length > 0)) and
    (.projectNumber | type == "number" and . > 0) and
    (.readyStatuses | type == "array" and length > 0 and all(type == "string" and length > 0)) and
    (.priorityOrder | type == "array" and all(type == "string")) and
    (.uiPatterns | type == "array" and all(type == "string" and length > 0)) and
    ((.requiredReviewRoles // []) | type == "array" and all(. == "qa" or . == "standards" or . == "product" or . == "reliability" or . == "acceptance"))
  ' "$CONFIG" > /dev/null 2>&1 || { CONFIG_ERROR="invalid configuration: $CONFIG"; return 1; }

  GH_REPO=$(jq -r .repository "$CONFIG")
  PROJECT_OWNER=$(jq -r .projectOwner "$CONFIG")
  PROJECT_NUMBER=$(jq -r .projectNumber "$CONFIG")
  BASE_BRANCH=$(jq -r .baseBranch "$CONFIG")
  STATUS_FIELD=$(jq -r .statusField "$CONFIG")
  STATUS_KEY=$(jq -r .statusKey "$CONFIG")
  PRIORITY_KEY=$(jq -r .priorityKey "$CONFIG")
  READY_JSON=$(jq -c .readyStatuses "$CONFIG")
  PRIORITY_JSON=$(jq -c .priorityOrder "$CONFIG")
  IN_PROGRESS=$(jq -r .inProgressStatus "$CONFIG")
  REVIEW=$(jq -r .reviewStatus "$CONFIG")
  READY_TO_MERGE=$(jq -r .readyToMergeStatus "$CONFIG")
  OWNED_LABEL=$(jq -r .ownedLabel "$CONFIG")
  BLOCKED_LABEL=$(jq -r .blockedLabel "$CONFIG")
  BRANCH_PREFIX=$(jq -r .branchPrefix "$CONFIG")
  UI_PATTERNS=$(jq -r '.uiPatterns[]' "$CONFIG")
  local configured_root
  configured_root=$(jq -r '.worktreeRoot // empty' "$CONFIG")
  if [ -n "${GITHUB_WORK_BOARD_WT_ROOT:-}" ]; then
    WT_ROOT=$GITHUB_WORK_BOARD_WT_ROOT
  elif [ -z "$configured_root" ]; then
    WT_ROOT="$(dirname "$REPO")/$(basename "$REPO")-worktrees"
  elif [ "${configured_root#/}" != "$configured_root" ]; then
    WT_ROOT=$configured_root
  else
    WT_ROOT="$(dirname "$REPO")/$configured_root"
  fi
}
require_config() { load_config || die "$CONFIG_ERROR"; }

# ---------- owner lease and serialized mutations ----------
# These are workflow identities, not an OS/GitHub authorization boundary.
read_lock() {
  L_OWNER= L_TIME=0 L_TOKEN= L_ROLE=
  if [ -f "$LOCK" ]; then
    jq -e '.owner and .token and .role and (.time|type == "number")' "$LOCK" >/dev/null 2>&1 || refuse "malformed lock; reconcile manually"
    L_OWNER=$(jq -r .owner "$LOCK"); L_TOKEN=$(jq -r .token "$LOCK")
    L_ROLE=$(jq -r .role "$LOCK"); L_TIME=$(jq -r .time "$LOCK")
  fi
}
valid_id() { case $1 in ''|*[!a-zA-Z0-9._-]*) return 1 ;; *) return 0 ;; esac; }
write_lock() {
  local tmp="$LOCK.tmp.$$"
  (umask 077; jq -n --arg owner "$1" --arg token "$2" --arg role "$3" --argjson time "$(now)" '{owner:$owner,token:$token,role:$role,time:$time}' > "$tmp") && mv "$tmp" "$LOCK"
}
acquire_guard() {
  local attempt=0 pid
  while [ "$attempt" -lt 50 ]; do
    if mkdir "$LOCK_GUARD" 2>/dev/null; then echo $$ > "$LOCK_GUARD/pid"; return 0; fi
    # A live mutation keeps its guard even if a network request exceeds the lease.
    pid=$(cat "$LOCK_GUARD/pid" 2>/dev/null || true)
    if [[ "$pid" =~ ^[0-9]+$ ]] && ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$LOCK_GUARD/pid"; rmdir "$LOCK_GUARD" 2>/dev/null || true
    fi
    attempt=$((attempt+1)); sleep 0.1
  done
  return 1
}
release_guard() { rm -f "$LOCK_GUARD/pid"; rmdir "$LOCK_GUARD" 2>/dev/null || true; }
role() { [ "${GITHUB_WORK_BOARD_ROLE:-}" = "$1" ] || refuse "requires $1 role"; }
assert_live() {
  read_lock
  [ -n "${GITHUB_WORK_BOARD_OWNER:-}" ] && [ -n "${GITHUB_WORK_BOARD_TOKEN:-}" ] || refuse "owner and token required"
  [ "$L_OWNER" = "$GITHUB_WORK_BOARD_OWNER" ] && [ "$L_TOKEN" = "$GITHUB_WORK_BOARD_TOKEN" ] && [ "$L_ROLE" = "${GITHUB_WORK_BOARD_ROLE:-}" ] || refuse "lock ownership differs"
  [ $(( $(now)-L_TIME )) -lt "$STALE" ] || refuse "lease expired; stop workers and reclaim explicitly"
}
renew() { assert_live; write_lock "$L_OWNER" "$L_TOKEN" "$L_ROLE" || die "lease write failed"; echo renewed; }
claim() {
  local me=$1 token=$2 reclaim=${3:-}
  valid_id "$me" && valid_id "$token" || refuse "owner and token must use letters, digits, dot, dash or underscore"
  case ${GITHUB_WORK_BOARD_ROLE:-} in manager|product-verifier) ;; *) refuse "manager or product-verifier role required" ;; esac
  [ "${GITHUB_WORK_BOARD_OWNER:-}" = "$me" ] && [ "${GITHUB_WORK_BOARD_TOKEN:-}" = "$token" ] || refuse "claim must match actor environment"
  acquire_guard || refuse "another mutation is running"
  trap release_guard EXIT
  read_lock
  if [ -n "$L_OWNER" ]; then
    if [ "$reclaim" = --workers-stopped ]; then
      [ $(( $(now)-L_TIME )) -ge "$STALE" ] || refuse "live lease cannot be reclaimed"
      # Caller must first stop actual Codex workers. Mark registry stopped as the durable acknowledgement.
      if [ -d "$STATE_ROOT/workers" ]; then
        local f
        for f in "$STATE_ROOT"/workers/*/*.json; do
          [ -f "$f" ] || continue
          jq 'if .status == "running" then .status="stopped" else . end' "$f" > "$f.tmp" && mv "$f.tmp" "$f" || die "worker recovery failed"
        done
      fi
    elif [ "$L_OWNER" = "$me" ] && [ "$L_TOKEN" = "$token" ] && [ "$L_ROLE" = "$GITHUB_WORK_BOARD_ROLE" ]; then
      [ $(( $(now)-L_TIME )) -lt "$STALE" ] || refuse "lease expired; reclaim requires --workers-stopped"
    else refuse "lock held by $L_OWNER; expiry never grants automatic takeover"
    fi
  elif [ -n "$reclaim" ]; then refuse "no expired lease to reclaim"
  fi
  [ -n "${GITHUB_WORK_BOARD_CLAIM_HOLD:-}" ] && sleep "$GITHUB_WORK_BOARD_CLAIM_HOLD"
  write_lock "$me" "$token" "$GITHUB_WORK_BOARD_ROLE" || die "lock write failed"
  echo claimed
}
release_lock() {
  assert_live
  no_running_workers || refuse "stop or complete registered workers before release"
  rm -f "$LOCK" || die "lock release failed"
  echo released
}
mutate() {
  require_config
  acquire_guard || refuse "another mutation is running"
  trap release_guard EXIT
  assert_live
  write_lock "$L_OWNER" "$L_TOKEN" "$L_ROLE" || die "lease write failed"
  assert_repository
  "$@"
}
no_running_workers() {
  local f
  for f in "$STATE_ROOT"/workers/*/*.json; do
    [ -f "$f" ] || continue
    jq -e '.status != "running"' "$f" >/dev/null || return 1
  done
}

# ---------- GitHub reads ----------
ITEMS= PRS= ISSUE= FIELDS= PROJECT_JSON=
assert_repository() {
  local actual
  actual=$(cd "$REPO" && gh repo view --json nameWithOwner --jq .nameWithOwner) || die "repository identity read failed"
  [ "$actual" = "$GH_REPO" ] || refuse "checkout repository differs from configuration"
}
load_items() {
  [ -n "$ITEMS" ] && return 0
  ITEMS=$(gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --limit 500 --format json) || die "GitHub project read failed"
  jq -e '.items|type == "array"' <<< "$ITEMS" >/dev/null || die "invalid project response"
  jq -e '(.totalCount|type == "number") and (.totalCount <= (.items|length))' <<< "$ITEMS" >/dev/null || die "project response truncated or lacks totalCount"
  ITEMS=$(jq --arg repo "$GH_REPO" '.items |= map(select(.content.type == "Issue" and .content.repository == $repo))' <<< "$ITEMS") || die "project filtering failed"
}
load_prs() {
  [ -n "$PRS" ] && return 0
  PRS=$(gh pr list -R "$GH_REPO" --state open --limit 100 --json number,headRefName,headRefOid,isDraft,title,baseRefName,isCrossRepository) || die "GitHub PR read failed"
  jq -e 'type == "array" and length < 100' <<< "$PRS" >/dev/null || die "invalid or possibly truncated PR response"
}
load_issue() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]] || refuse "issue must be a positive number"
  ISSUE=$(gh issue view "$1" -R "$GH_REPO" --json number,title,body,labels,comments,state,url) || die "GitHub issue #$1 read failed"
  jq -e --argjson n "$1" '.number == $n and (.body|type == "string") and (.labels|type == "array") and (.comments|type == "array") and (.state == "OPEN" or .state == "CLOSED")' <<< "$ISSUE" >/dev/null || die "invalid issue response"
}
# Native dependencies are authoritative. The supported legacy form is a Blocked by: line with local #numbers.
open_dependencies() {
  local n=$1 native body lines refs ref remote result open=
  native=$(gh api --paginate --slurp "repos/$GH_REPO/issues/$n/dependencies/blocked_by") || die "dependency read failed for #$n"
  jq -e 'type == "array" and all(.[]; type == "array" and all(.[]; .state == "open" or .state == "closed"))' <<< "$native" >/dev/null || die "invalid dependency response"
  open=$(jq -r 'flatten[] | select(.state == "open") | .html_url // ("#"+(.number|tostring))' <<< "$native")
  lines=$(jq -r '.body | split("\n")[] | select(test("(?i)^\\s*\\**blocked by"))' <<< "$ISSUE") || die "dependency declaration read failed"
  if [ -n "$lines" ]; then
    # Full URLs are supported only for this configured repository; cross-repo declarations use native edges.
    remote=$(printf '%s' "$lines" | grep -Eo 'https://github.com/[^ /]+/[^ /]+/issues/[0-9]+' || true)
    while IFS= read -r ref; do
      [ -z "$ref" ] && continue
      case $ref in "https://github.com/$GH_REPO/issues/"*) ;; *) refuse "use native dependencies for cross-repository blocker $ref" ;; esac
    done <<< "$remote"
    lines=$(printf '%s' "$lines" | sed -E 's#https://github.com/[^ /]+/[^ /]+/issues/([0-9]+)#\#\1#g')
    refs=$(printf '%s' "$lines" | grep -Eo '#[0-9]+' | tr -d '#' | sort -nu || true)
    if [ -z "$refs" ]; then
      printf '%s' "$lines" | grep -Eiq 'blocked by[^a-z]*(none|no blockers|n/a)' || refuse "unsupported Blocked by declaration"
    fi
    for ref in $refs; do
      result=$(gh api "repos/$GH_REPO/issues/$ref") || die "declared blocker #$ref read failed"
      jq -e '.state == "open" or .state == "closed"' <<< "$result" >/dev/null || die "invalid blocker response"
      [ "$(jq -r .state <<< "$result")" = open ] && open="${open}${open:+$'\n'}#$ref"
    done
  fi
  printf '%s' "$open"
}
load_project_meta() {
  [ -n "$PROJECT_JSON" ] || PROJECT_JSON=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json) || die "GitHub project metadata read failed"
  [ -n "$FIELDS" ] || FIELDS=$(gh project field-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json) || die "GitHub project fields read failed"
}
fetch() { git -C "$REPO" fetch -q origin || die "git fetch failed"; }
item_field() { jq -r --argjson n "$1" --arg key "$2" '.items[] | select(.content.number == $n) | .[$key] // empty' <<< "$ITEMS" | sed -n '1p'; }
item_id() { jq -r --argjson n "$1" '.items[] | select(.content.number == $n) | .id // empty' <<< "$ITEMS" | sed -n '1p'; }
issue_has_label() { jq -e --arg label "$1" '.labels | map(.name) | index($label)' <<< "$ISSUE" > /dev/null; }

one_or_none() {
  local kind=$1 matches=$2 count
  count=$(printf '%s\n' "$matches" | grep -c .)
  if [ "$count" -gt 1 ]; then echo "error ambiguous $kind: $(printf '%s' "$matches" | tr '\n' ',')" >&2; return 1; fi
  printf '%s\n' "$matches" | sed -n '1p'
}
open_pr_for() {
  local matches invalid
  invalid=$(jq -r --arg prefix "$BRANCH_PREFIX$1-" --arg base "$BASE_BRANCH" '.[] | select(.headRefName | startswith($prefix)) | select(.baseRefName != $base or .isCrossRepository != false) | .number' <<< "$PRS") || return 1
  [ -z "$invalid" ] || { echo "refused PR target base or head repository differs" >&2; return 3; }
  matches=$(jq -r --arg prefix "$BRANCH_PREFIX$1-" '.[] | select(.headRefName | startswith($prefix)) | "\(.number) \(.headRefName) \(.headRefOid) \(.isDraft)"' <<< "$PRS")
  one_or_none "open PRs for #$1" "$matches"
}
dev_worktree() {
  local matches
  matches=$(git -C "$REPO" worktree list --porcelain | sed -n 's/^worktree //p' | grep -F "$WT_ROOT/$1-" | grep -v -- '-verify$')
  one_or_none "worktrees for #$1" "$matches"
}
local_branch() {
  local matches
  matches=$(git -C "$REPO" for-each-ref --format='%(refname:short)' "refs/heads/$BRANCH_PREFIX$1-*")
  one_or_none "local branches for #$1" "$matches"
}
remote_branch() {
  local matches
  matches=$(git -C "$REPO" for-each-ref --format='%(refname:short)' "refs/remotes/origin/$BRANCH_PREFIX$1-*" | sed 's#^origin/##')
  one_or_none "remote branches for #$1" "$matches"
}

# ---------- doctor ----------
doctor() {
  local offline=0 json=0 failures= tool result ok=true lock_desc repo_name labels status
  while [ $# -gt 0 ]; do
    case $1 in --offline) offline=1 ;; --json) json=1 ;; *) echo "error usage doctor [--offline] [--json]"; return 2 ;; esac
    shift
  done
  for tool in git gh jq; do command -v "$tool" > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}missing command: $tool"; done
  git -C "$REPO" rev-parse --is-inside-work-tree > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}not a git worktree: $REPO"
  git -C "$REPO" remote get-url origin > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}missing origin remote"
  if ! load_config; then
    failures="${failures}${failures:+$'\n'}$CONFIG_ERROR"
  elif [ "$offline" = 0 ]; then
    gh auth status -h github.com > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}GitHub authentication failed"
    repo_name=$(cd "$REPO" && gh repo view --json nameWithOwner --jq .nameWithOwner 2> /dev/null || true)
    [ "$repo_name" = "$GH_REPO" ] || failures="${failures}${failures:+$'\n'}checkout is $repo_name, configuration is $GH_REPO"
    PROJECT_JSON=$(gh project view "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json 2> /dev/null || true)
    FIELDS=$(gh project field-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --format json 2> /dev/null || true)
    ITEMS=$(gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --limit 1 --format json 2> /dev/null || true)
    jq -e '.id | type == "string" and length > 0' <<< "$PROJECT_JSON" > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}GitHub project metadata read failed"
    jq -e '.fields | type == "array"' <<< "$FIELDS" > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}GitHub project fields read failed"
    jq -e '.items | type == "array"' <<< "$ITEMS" > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}GitHub project item read failed"
    while IFS= read -r status; do
      jq -e --arg field "$STATUS_FIELD" --arg status "$status" '.fields[] | select(.name == $field) | .options[]? | select(.name == $status)' <<< "$FIELDS" > /dev/null 2>&1 \
        || failures="${failures}${failures:+$'\n'}missing status option: $status"
    done < <(jq -r '.readyStatuses[],.inProgressStatus,.reviewStatus,.readyToMergeStatus' "$CONFIG")
    labels=$(gh label list -R "$GH_REPO" --limit 300 --json name 2> /dev/null || true)
    for result in "$OWNED_LABEL" "$BLOCKED_LABEL"; do
      jq -e --arg label "$result" 'map(.name) | index($label)' <<< "$labels" > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}missing label: $result"
    done
    git -C "$REPO" rev-parse -q --verify "origin/$BASE_BRANCH" > /dev/null 2>&1 || failures="${failures}${failures:+$'\n'}missing origin/$BASE_BRANCH"
  fi
  [ -z "$failures" ] || ok=false
  read_lock; if [ -n "$L_OWNER" ]; then lock_desc="$L_OWNER $L_STATE age=$(( $(now) - ${L_TIME:-0} ))s"; else lock_desc=none; fi
  if [ "$json" = 1 ]; then
    jq -n --argjson ok "$ok" --argjson offline "$([ "$offline" = 1 ] && echo true || echo false)" --arg repo "$REPO" --arg config "$CONFIG" --arg lock "$lock_desc" --arg failures "$failures" \
      '{ok:$ok,offline:$offline,repository:$repo,configuration:$config,lock:$lock,failures:($failures|split("\n")|map(select(length>0)))}'
  elif [ "$ok" = true ]; then echo "ok repository=$REPO lock=$lock_desc"; else printf 'error doctor: %s\n' "$(printf '%s' "$failures" | tr '\n' ';')"; fi
  [ "$ok" = true ]
}

# ---------- triage and state ----------
triage() {
  local json=0
  [ "${1:-}" = --json ] && { json=1; shift; }
  require_config; assert_repository; load_items; load_prs; fetch
  if [ "$json" = 1 ]; then
    local rows; rows=$(triage_rows "$@") || return $?
    printf '%s\n' "$rows" | jq -Rsc 'split("\n")|map(select(length>0)|split("\t"))|map({number:(.[0]|tonumber),title:.[1],priority:.[2],action:.[3],reason:.[4],question:.[5]})'
  else triage_rows "$@"; fi
}
triage_rows() {
  local nums n
  if [ $# -gt 0 ]; then nums=$*; else
    nums=$(jq -r --arg sk "$STATUS_KEY" --arg pk "$PRIORITY_KEY" --arg blocked "$BLOCKED_LABEL" --argjson ready "$READY_JSON" --argjson order "$PRIORITY_JSON" '
      [.items[] | select(.content.number != null) | select(.[$sk] as $s | $ready | index($s)) | select(((.labels // []) | index($blocked)) == null)]
      | sort_by(. as $item | (($order | index($item[$pk])) // 999)) | .[].content.number' <<< "$ITEMS")
  fi
  for n in $nums; do triage_one "$n" || return 1; done
}
triage_one() {
  local n=$1 title priority state action=CHECK reason=- question=- work= pr dependencies
  load_issue "$n"; title=$(jq -r '.title | gsub("[\\t\\n]";" ")' <<< "$ISSUE"); priority=$(item_field "$n" "$PRIORITY_KEY"); state=$(jq -r .state <<< "$ISSUE")
  if [ "$state" != OPEN ]; then action=PARK; reason="issue is $state"; question="Reopen #$n or remove it from a Ready status. Default: leave parked."; fi
  if issue_has_label "$BLOCKED_LABEL"; then action=WAIT; reason="has $BLOCKED_LABEL"; fi
  dependencies=$(open_dependencies "$n") || return $?
  if [ -n "$dependencies" ] && [ "$action" = CHECK ]; then action=WAIT; reason="open dependencies: $(printf '%s' "$dependencies" | tr '\n' ',')"; fi
  if ! issue_has_label "$OWNED_LABEL"; then
    work=$(dev_worktree "$n") || return 1
    if [ -z "$work" ]; then work=$(local_branch "$n") || return 1; fi
    if [ -z "$work" ]; then work=$(remote_branch "$n") || return 1; fi
    pr=$(open_pr_for "$n") || return $?
    [ -n "$pr" ] && work="${work:+$work, }PR #${pr%% *}"
    if [ -n "$work" ] && [ "$action" = CHECK ]; then action=PARK; reason="existing work: $work"; question="Adopt existing work for #$n or leave it parked? Recommendation: review before adopting. Default: parked."; fi
  fi
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$n" "$title" "${priority:--}" "$action" "$reason" "$question"
}

state() {
  local json=0 nums n
  [ "${1:-}" = --json ] && { json=1; shift; }
  require_config; load_items; load_prs
  if [ $# -gt 0 ]; then nums=$*; else
    nums=$(jq -r --arg sk "$STATUS_KEY" --arg owned "$OWNED_LABEL" --arg blocked "$BLOCKED_LABEL" --arg progress "$IN_PROGRESS" --arg review "$REVIEW" '
      .items[] | select(.content.number != null) | select(.[$sk] == $progress or .[$sk] == $review) | select(((.labels // []) | index($owned)) != null) | select(((.labels // []) | index($blocked)) == null) | .content.number' <<< "$ITEMS")
  fi
  if [ -z "$nums" ]; then [ "$json" = 1 ] && echo '[]' || echo none; return 0; fi
  if [ "$json" = 1 ]; then local rows; rows=$(for n in $nums; do state_one "$n" json || return 1; done) || return $?; printf '%s\n' "$rows" | jq -s '.'; else for n in $nums; do state_one "$n" text || return 1; done; fi
}
state_one() {
  local n=$1 format=$2 wt branch head= dirty=false pr last status pr_num pr_branch pr_head
  load_issue "$n"; wt=$(dev_worktree "$n") || return 1; branch=$(local_branch "$n") || return 1
  if [ -n "$wt" ]; then head=$(git -C "$wt" rev-parse HEAD); [ -n "$(git -C "$wt" status --porcelain)" ] && dirty=true; fi
  pr=$(open_pr_for "$n") || return $?; pr_num=${pr%% *}; pr_branch=$(echo "$pr" | cut -s -d' ' -f2); pr_head=$(echo "$pr" | cut -s -d' ' -f3)
  last=$(jq -r '[.comments[] | select(.body | startswith("[work-board]")) | .body] | last // "" | split("\n")[0] | .[0:180]' <<< "$ISSUE")
  status=$(item_field "$n" "$STATUS_KEY")
  if [ "$format" = json ]; then
    jq -n --argjson number "$n" --arg status "$status" --arg branch "$branch" --arg worktree "$wt" --arg head "$head" --argjson dirty "$dirty" --arg pr "$pr_num" --arg prBranch "$pr_branch" --arg prHead "$pr_head" --arg last "$last" \
      'def optional: if length>0 then . else null end; {number:$number,status:$status,branch:($branch|optional),worktree:($worktree|optional),head:($head|optional),dirty:$dirty,pr:($pr|optional),prBranch:($prBranch|optional),prHead:($prHead|optional),last:$last}'
  else echo "#$n status=$status branch=${branch:-none} worktree=${wt:-none} head=${head:-none} dirty=$dirty pr=${pr:+#${pr%% *}} pr_head=${pr_head:-none} last=\"$last\""; fi
}

# ---------- change classification ----------
is_ui_file() { local file=$1 pattern; while IFS= read -r pattern; do case $file in $pattern) return 0 ;; esac; done <<< "$UI_PATTERNS"; return 1; }
changed_line() {
  local files file ui=no count=0 list=
  files=$(git -C "$REPO" diff --name-only "$1...$2") || die "git diff $1...$2 failed"
  [ -n "$files" ] || { echo none; return 0; }
  while IFS= read -r file; do [ -n "$file" ] || continue; count=$((count + 1)); [ "$count" -le 20 ] && list="$list,$file"; is_ui_file "$file" && ui=yes; done <<< "$files"
  echo "code ui=$ui files=$count: ${list#,}"
}
changed() {
  local json=0 result ui count list files_json
  [ "${1:-}" = --json ] && { json=1; shift; }
  [ $# -ge 3 ] || { echo "error usage changed [--json] <issue> <shaA> <shaB>"; return 2; }
  require_config; load_issue "$1"; fetch; result=$(changed_line "$2" "$3") || return $?
  if [ "$json" = 0 ]; then echo "$result"; return 0; fi
  if [ "$result" = none ]; then echo '{"kind":"none","ui":false,"fileCount":0,"files":[],"truncated":false}'; return 0; fi
  ui=$(printf '%s' "$result" | sed -n 's/^code ui=\([^ ]*\).*/\1/p'); count=$(printf '%s' "$result" | sed -n 's/^code ui=[^ ]* files=\([0-9]*\):.*/\1/p'); list=${result#*: }
  files_json=$(printf '%s' "$list" | jq -R 'if length==0 then [] else split(",") end')
  jq -n --arg ui "$ui" --argjson count "$count" --argjson files "$files_json" '{kind:"code",ui:($ui=="yes"),fileCount:$count,files:$files,truncated:($count>($files|length))}'
}

# ---------- writes ----------
status_option_id() { jq -r --arg field "$STATUS_FIELD" --arg status "$1" '.fields[] | select(.name==$field) | .options[]? | select(.name==$status) | .id' <<< "$FIELDS" | sed -n '1p'; }
set_status() {
  local n=$1 status=$2 project_id field_id option_id item
  assert_live; load_items; load_project_meta
  project_id=$(jq -r .id <<< "$PROJECT_JSON"); field_id=$(jq -r --arg field "$STATUS_FIELD" '.fields[] | select(.name==$field) | .id' <<< "$FIELDS" | sed -n '1p'); option_id=$(status_option_id "$status"); item=$(item_id "$n")
  [ -n "$project_id" ] && [ -n "$field_id" ] && [ -n "$option_id" ] && [ -n "$item" ] || refuse "cannot resolve project status '$status' for #$n"
  assert_live
  gh project item-edit --project-id "$project_id" --id "$item" --field-id "$field_id" --single-select-option-id "$option_id" > /dev/null || die "status edit failed for #$n"
}
comment_once() {
  local kind=$1 n=$2 body="[work-board] $3" existing
  if [ "$kind" = issue ]; then existing=$ISSUE; else existing=$(gh pr view "$n" -R "$GH_REPO" --json comments) || die "PR #$n read failed"; fi
  jq -e --arg body "$body" '[.comments[].body] | index($body)' <<< "$existing" > /dev/null && return 0
  assert_live
  gh "$kind" comment "$n" -R "$GH_REPO" --body "$body" > /dev/null || die "comment on $kind #$n failed"
}
start() {
  role manager; require_config; load_issue "$1"
  [ "$(jq -r .state <<< "$ISSUE")" = OPEN ] || refuse "issue is not open"
  local dependencies; dependencies=$(open_dependencies "$1") || return $?
  [ -z "$dependencies" ] || refuse "open dependencies: $dependencies"
  load_items
  jq -ne --arg status "$(item_field "$1" "$STATUS_KEY")" --argjson ready "$READY_JSON" '$ready | index($status)' >/dev/null || refuse "issue is not in a configured ready status"
  assert_live
  issue_has_label "$BLOCKED_LABEL" && refuse "#$1 has $BLOCKED_LABEL"
  issue_has_label "$OWNED_LABEL" || gh issue edit "$1" -R "$GH_REPO" --add-label "$OWNED_LABEL" > /dev/null || die "label edit failed"
  set_status "$1" "$IN_PROGRESS"; comment_once issue "$1" started; echo "started #$1"
}
move() {
  role manager; require_config
  case $2 in "$IN_PROGRESS"|"$REVIEW") ;; *) refuse "status '$2' is not configured for this workflow" ;; esac
  set_status "$1" "$2"; echo "moved #$1 $2"
}
note() { require_config; load_issue "$1"; comment_once issue "$1" "$2"; echo "noted #$1"; }
park() {
  role manager; require_config; load_issue "$1"
  assert_live
  issue_has_label "$BLOCKED_LABEL" || gh issue edit "$1" -R "$GH_REPO" --add-label "$BLOCKED_LABEL" > /dev/null || die "label edit failed"
  comment_once issue "$1" "parked: $2"; echo "parked #$1"
}
# ---------- registered workers and exact-commit evidence ----------
worker() {
  role manager
  local n=$1 id=$2 assigned=$3 status=$4 head=$5 dir file other
  load_issue "$n"; valid_id "$id" || refuse "invalid worker id"
  case $assigned in implementer|qa|standards|product|reliability|requirements) ;; *) refuse "unknown worker role" ;; esac
  case $status in running|complete|stopped) ;; *) refuse "unknown worker status" ;; esac
  if [ "$head" != - ]; then head=$(git -C "$REPO" rev-parse --verify "$head^{commit}") || refuse "unknown worker commit"; fi
  [ "$status" != complete ] || [ "$assigned" = requirements ] || [ "$head" != - ] || refuse "completed worker needs commit"
  dir="$STATE_ROOT/workers/$n"; file="$dir/$id.json"
  if [ -f "$file" ]; then
    [ "$(jq -r .role "$file")" = "$assigned" ] || refuse "worker id cannot change roles"
  fi
  if [ "$status" = complete ]; then
    [ -f "$file" ] && jq -e --arg owner "$GITHUB_WORK_BOARD_OWNER" '.status == "running" and .owner == $owner' "$file" >/dev/null || refuse "worker must be dispatched and running before completion"
    if [ "$assigned" != implementer ] && [ "$assigned" != requirements ]; then
      [ "$(jq -r .headSha "$file")" = "$head" ] || refuse "reviewer completion commit differs from assignment"
    fi
  fi
  if [ "$status" = running ] && [ "$assigned" != implementer ] && [ "$assigned" != requirements ]; then
    [ "$head" != - ] || refuse "reviewer dispatch needs pinned commit"
  fi
  if [ "$assigned" = implementer ] && [ "$status" = running ]; then
    for other in "$STATE_ROOT"/workers/*/*.json; do
      [ -f "$other" ] && [ "$other" != "$file" ] || continue
      jq -e '.role != "implementer" or .status != "running"' "$other" >/dev/null || refuse "another implementer is running"
    done
  fi
  assert_live; mkdir -p "$dir"
  jq -n --argjson issue "$n" --arg id "$id" --arg role "$assigned" --arg status "$status" --arg head "$head" --arg owner "$L_OWNER" '{issue:$issue,id:$id,role:$role,status:$status,headSha:$head,owner:$owner}' > "$file.tmp" && mv "$file.tmp" "$file" || die "worker state write failed"
  echo "worker $id $status"
}
required_roles() {
  local base=$1 head=$2 files file ui=no risk=no
  files=$(git -C "$REPO" diff --name-only "$base...$head") || die "review diff read failed"
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    is_ui_file "$file" && ui=yes
    case $(printf '%s' "$file" | tr '[:upper:]' '[:lower:]') in *storage*|*persist*|*auth*|*security*|*migration*|*schema*|*supabase*|*secret*) risk=yes ;; esac
  done <<< "$files"
  printf '%s\n' qa standards acceptance
  [ "$ui" = no ] || echo product
  [ "$risk" = no ] || echo reliability
  jq -r '.requiredReviewRoles // [] | .[]' "$CONFIG"
}
review() {
  local n=$1 input=$2 head base r reviewer implementer file registered
  load_issue "$n"; [ -f "$input" ] || refuse "review file missing"
  jq -e --arg repo "$GH_REPO" --argjson n "$n" '
    .repository == $repo and .issue == $n and
    (.headSha|test("^[0-9a-f]{40}$")) and (.baseSha|test("^[0-9a-f]{40}$")) and
    (.role == "qa" or .role == "standards" or .role == "product" or .role == "reliability" or .role == "acceptance") and
    (.reviewerId|type == "string" and length > 0) and (.implementerId|type == "string" and length > 0) and
    .reviewerId != .implementerId and
    (.verdict == "PASS" or .verdict == "FAIL" or .verdict == "BLOCKED") and
    (.checks|type == "array") and (.evidence|type == "array" and length > 0 and all(.[];type == "string" and length > 0)) and
    (.notVerified|type == "array") and
    (if .verdict == "PASS" then (.checks|length > 0 and all(.[];(.command|type == "string" and length > 0) and .exitCode == 0)) else true end)
  ' "$input" >/dev/null 2>&1 || refuse "invalid, self-reviewed or unsupported review report"
  head=$(jq -r .headSha "$input"); base=$(jq -r .baseSha "$input"); r=$(jq -r .role "$input")
  reviewer=$(jq -r .reviewerId "$input"); implementer=$(jq -r .implementerId "$input")
  valid_id "$reviewer" && valid_id "$implementer" || refuse "invalid reviewer identity"
  registered="$STATE_ROOT/workers/$n/$implementer.json"
  [ -f "$registered" ] && jq -e --arg head "$head" '.role == "implementer" and .status == "complete" and .headSha == $head' "$registered" >/dev/null || refuse "missing completed implementer for this commit"
  if [ "$r" = acceptance ]; then
    role product-verifier
    [ "$reviewer" = "$GITHUB_WORK_BOARD_OWNER" ] || refuse "acceptance reviewer must be this product-verifier session"
    [ "$reviewer" != "$(jq -r .owner "$registered")" ] || refuse "implementing manager cannot provide product acceptance"
  else
    role manager
    registered="$STATE_ROOT/workers/$n/$reviewer.json"
    [ -f "$registered" ] && jq -e --arg r "$r" --arg head "$head" '.role == $r and .status == "complete" and .headSha == $head' "$registered" >/dev/null || refuse "missing completed reviewer provenance"
  fi
  fetch; load_prs
  local pr; pr=$(open_pr_for "$n") || return $?; [ -n "$pr" ] || refuse "no open PR"
  [ "$(echo "$pr" | cut -d' ' -f3)" = "$head" ] || refuse "review is not for current PR head"
  [ "$(git -C "$REPO" rev-parse "origin/$BASE_BRANCH")" = "$base" ] || refuse "review base changed"
  verify_check "$n" "$head" >/dev/null || return $?
  assert_live; mkdir -p "$STATE_ROOT/reviews/$n/$head"
  file="$STATE_ROOT/reviews/$n/$head/$r.json"
  (umask 077; cp "$input" "$file.tmp") && mv "$file.tmp" "$file" || die "review receipt write failed"
  echo "review recorded $r $(jq -r .verdict "$input")"
}
ready() {
  role product-verifier
  local n=$1 reviewed head pr pr_num pr_head pr_draft wt base roles r receipt implementer= registered
  require_config; load_prs; load_issue "$n"; fetch
  [ "$(jq -r .state <<< "$ISSUE")" = OPEN ] || refuse "issue is not open"
  issue_has_label "$BLOCKED_LABEL" && refuse "issue remains blocked"
  reviewed=$(git -C "$REPO" rev-parse --verify -q "$2^{commit}") || refuse "unknown commit $2"
  head=$(git -C "$REPO" rev-parse --verify -q "$3^{commit}") || refuse "unknown commit $3"
  [ "$reviewed" = "$head" ] || refuse "reviewed SHA and head differ"
  pr=$(open_pr_for "$n") || return $?; [ -n "$pr" ] || refuse "no open PR for #$n"
  pr_num=${pr%% *}; pr_head=$(echo "$pr" | cut -d' ' -f3); pr_draft=$(echo "$pr" | cut -d' ' -f4)
  [ "$pr_head" = "$head" ] || refuse "PR #$pr_num head $pr_head is not $head"
  wt=$(dev_worktree "$n") || return 1; [ -n "$wt" ] || refuse "developer worktree missing"
  [ "$(git -C "$wt" rev-parse HEAD)" = "$head" ] || refuse "local worktree head differs"
  clean_tree "$wt" || refuse "local worktree is dirty"
  verify_check "$n" "$head" >/dev/null || return $?
  no_running_workers || refuse "registered workers are still running"
  base=$(git -C "$REPO" rev-parse "origin/$BASE_BRANCH") || refuse "base missing"
  git -C "$REPO" merge-base --is-ancestor "$base" "$head" || refuse "base is not an ancestor of head"
  roles=$(required_roles "$base" "$head") || return $?
  for r in $roles; do
    case $r in qa|standards|product|reliability|acceptance) ;; *) refuse "unsupported required review role $r" ;; esac
    receipt="$STATE_ROOT/reviews/$n/$head/$r.json"
    [ -f "$receipt" ] || refuse "missing $r PASS evidence"
    jq -e --arg head "$head" --arg base "$base" --arg repo "$GH_REPO" --argjson n "$n" --arg role "$r" '.repository == $repo and .issue == $n and .role == $role and .verdict == "PASS" and .headSha == $head and .baseSha == $base and .reviewerId != .implementerId and (.checks|length > 0 and all(.[];.exitCode == 0)) and (.evidence|length > 0)' "$receipt" >/dev/null || refuse "failed, blocked or stale $r receipt"
    [ -z "$implementer" ] && implementer=$(jq -r .implementerId "$receipt")
    [ "$implementer" = "$(jq -r .implementerId "$receipt")" ] || refuse "reviewed implementers differ"
    registered="$STATE_ROOT/workers/$n/$implementer.json"
    [ -f "$registered" ] && jq -e --arg head "$head" '.status == "complete" and .role == "implementer" and .headSha == $head' "$registered" >/dev/null || refuse "implementer is not complete at head"
    if [ "$r" = acceptance ]; then
      [ "$(jq -r .reviewerId "$receipt")" = "$GITHUB_WORK_BOARD_OWNER" ] || refuse "acceptance belongs to another product session"
      [ "$GITHUB_WORK_BOARD_OWNER" != "$(jq -r .owner "$registered")" ] || refuse "implementing manager cannot provide product acceptance"
    else
      registered="$STATE_ROOT/workers/$n/$(jq -r .reviewerId "$receipt").json"
      [ -f "$registered" ] && jq -e --arg r "$r" --arg head "$head" '.status == "complete" and .role == $r and .headSha == $head' "$registered" >/dev/null || refuse "reviewer provenance changed"
    fi
  done
  # Re-read the moving external reference immediately before status mutations.
  PRS=; load_prs; pr=$(open_pr_for "$n") || return $?; [ "$(echo "$pr" | cut -d' ' -f3)" = "$head" ] || refuse "PR head changed during readiness"
  assert_live
  [ "$pr_draft" = true ] && gh pr ready "$pr_num" -R "$GH_REPO" >/dev/null || [ "$pr_draft" != true ] || die "PR ready failed"
  comment_once issue "$n" "READY TO MERGE PR #$pr_num reviewed $reviewed"
  comment_once pr "$pr_num" "READY TO MERGE reviewed $reviewed"
  set_status "$n" "$READY_TO_MERGE"; echo "ready #$n PR #$pr_num"
}

# ---------- worktrees ----------
issue_slug() { jq -r '.title' <<< "$ISSUE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//' | cut -d- -f1-6; }
worktree() {
  local n=$1 wt branch remote slug path
  role manager; require_config; load_issue "$n"; wt=$(dev_worktree "$n") || return 1; [ -n "$wt" ] && { echo "$wt"; return 0; }
  fetch; mkdir -p "$WT_ROOT"; slug=$(issue_slug); path="$WT_ROOT/$n-$slug"; branch=$(local_branch "$n") || return 1
  assert_live
  if [ -n "$branch" ]; then git -C "$REPO" worktree add -q "$path" "$branch"
  else
    remote=$(remote_branch "$n") || return 1
    if [ -n "$remote" ]; then branch=$remote; git -C "$REPO" worktree add -q -b "$branch" "$path" "origin/$branch"
    else branch="$BRANCH_PREFIX$n-$slug"; git -C "$REPO" worktree add -q --no-track -b "$branch" "$path" "origin/$BASE_BRANCH"
    fi
  fi || die "worktree add failed for #$n"
  echo "$path"
}
verify_path() { echo "$WT_ROOT/$1-verify"; }
verify_at() {
  require_config; local path; path=$(verify_path "$1"); fetch
  git -C "$REPO" rev-parse --verify "$2^{commit}" >/dev/null || refuse "unknown verifier commit"
  if [ -d "$path" ]; then
    clean_tree "$path" || refuse "verifier worktree is dirty"
    assert_live; git -C "$path" checkout -q --detach "$2" || die "checkout $2 failed"
  else assert_live; mkdir -p "$WT_ROOT"; git -C "$REPO" worktree add -q --detach "$path" "$2" || die "verifier worktree add failed"; fi
  echo "$path"
}
clean_tree() {
  [ -z "$(git -C "$1" status --porcelain)" ] || return 1
  # Generated dependencies/build output are expected; ignored source additions are not.
  local ignored
  ignored=$(git -C "$1" ls-files --others --ignored --exclude-standard) || return 1
  ignored=$(printf '%s\n' "$ignored" | grep -Ev '^(node_modules/|dist/|build/|\.vite/)|(^|/)[^/]*\.tsbuildinfo$|^$' || true)
  [ -z "$ignored" ]
}
verify_check() {
  require_config; local path; path=$(verify_path "$1"); [ -d "$path" ] || refuse "no verifier worktree"
  clean_tree "$path" || refuse "verifier worktree is dirty"
  [ "$(git -C "$path" rev-parse HEAD)" = "$(git -C "$REPO" rev-parse "$2^{commit}")" ] || refuse "verifier worktree is not at $2"
  echo clean
}
verify_remove() { require_config; assert_live; local path; path=$(verify_path "$1"); [ -d "$path" ] || { echo removed; return 0; }; git -C "$REPO" worktree remove "$path" || refuse "git refused verifier removal"; echo removed; }

# ---------- legacy watcher ----------
watch() {
  echo "refused use Codex bounded waits and renew; background shell polling is unsupported"
  return 3
}

# ---------- dispatch ----------
cmd=${1:-}; [ $# -gt 0 ] && shift
case $cmd in
  doctor) doctor "$@" ;;
  status) read_lock; if [ -n "$L_OWNER" ]; then echo "$L_OWNER $L_ROLE age=$(( $(now)-L_TIME ))s"; else echo "none none age=0s"; fi ;;
  claim) need $# 2 "claim <owner> <token>"; claim "$1" "$2" ;;
  reclaim) need $# 3 "reclaim <owner> <token> --workers-stopped"; [ "$3" = --workers-stopped ] || refuse "worker-stop acknowledgement required"; claim "$1" "$2" "$3" ;;
  renew) mutate renew ;;
  release) mutate release_lock ;;
  triage) triage "$@" ;;
  state) state "$@" ;;
  changed) changed "$@" ;;
  start) need $# 1 "start <issue>"; mutate start "$1" ;;
  move) need $# 2 "move <issue> <status>"; mutate move "$1" "$2" ;;
  note) need $# 2 "note <issue> <text>"; mutate note "$1" "$2" ;;
  park) need $# 2 "park <issue> <question>"; mutate park "$1" "$2" ;;
  worker) need $# 5 "worker <issue> <id> <role> <running|complete|stopped> <sha|->"; mutate worker "$@" ;;
  review) need $# 2 "review <issue> <report.json>"; mutate review "$1" "$2" ;;
  ready) need $# 3 "ready <issue> <reviewed-sha> <head-sha>"; mutate ready "$1" "$2" "$3" ;;
  worktree) need $# 1 "worktree <issue>"; mutate worktree "$1" ;;
  verify-at) need $# 2 "verify-at <issue> <sha>"; mutate verify_at "$1" "$2" ;;
  verify-check) need $# 2 "verify-check <issue> <sha>"; verify_check "$1" "$2" ;;
  verify-remove) need $# 1 "verify-remove <issue>"; mutate verify_remove "$1" ;;
  watch) watch "$@" ;;
  *) echo "error usage ${cmd:-<none>}"; exit 2 ;;
esac
