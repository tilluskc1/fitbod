#!/usr/bin/env bash
# Generic mechanical controller for the github-work-board skill.
# Exit 0 success, 1 read/operation error, 2 usage, 3 safety refusal.
set -uo pipefail

die() { echo "error $*"; exit 1; }
refuse() { echo "refused $*"; exit 3; }
now() { date +%s; }
need() { [ "$1" -ge "$2" ] || { echo "error usage $3"; exit 2; }; }

REPO=${GITHUB_WORK_BOARD_REPO:-}
if [ -z "$REPO" ]; then REPO=$(git rev-parse --show-toplevel 2> /dev/null || pwd -P); fi
CONFIG=${GITHUB_WORK_BOARD_CONFIG:-$REPO/.github/work-board.json}
GIT_COMMON=$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir 2> /dev/null || true)
LOCK=${GITHUB_WORK_BOARD_LOCK:-${GIT_COMMON:-$REPO/.git}/github-work-board.lock}
LOCK_GUARD=${GITHUB_WORK_BOARD_LOCK_GUARD:-$LOCK.guard}
BACKOFF=${GITHUB_WORK_BOARD_BACKOFF:-$LOCK.backoff}
STALE=${GITHUB_WORK_BOARD_STALE:-1200}
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
    (.uiPatterns | type == "array" and all(type == "string" and length > 0))
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
  OPEN_STATUSES_JSON=$(jq -nc --argjson ready "$READY_JSON" --arg progress "$IN_PROGRESS" --arg review "$REVIEW" '$ready + [$progress,$review] | unique')
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

# ---------- lock ----------
read_lock() {
  L_OWNER= L_TIME=0 L_STATE=
  if [ -f "$LOCK" ]; then read -r L_OWNER L_TIME L_STATE < "$LOCK"; fi
}
write_lock() {
  local tmp="$LOCK.tmp.$$"
  (umask 077; printf '%s %s %s\n' "$1" "$(now)" "$2" > "$tmp") && mv "$tmp" "$LOCK"
}
acquire_guard() {
  local attempt=0 age modified
  while [ "$attempt" -lt 50 ]; do
    mkdir "$LOCK_GUARD" 2> /dev/null && return 0
    modified=$(stat -f %m "$LOCK_GUARD" 2> /dev/null || stat -c %Y "$LOCK_GUARD" 2> /dev/null || now)
    age=$(( $(now) - modified ))
    if [ "$age" -ge "${GITHUB_WORK_BOARD_GUARD_STALE:-30}" ]; then rmdir "$LOCK_GUARD" 2> /dev/null || true; fi
    attempt=$((attempt + 1)); sleep 0.1
  done
  return 1
}
release_guard() { rmdir "$LOCK_GUARD" 2> /dev/null; }
claim() {
  local me=$1 age
  acquire_guard || { echo "locked updating 0s"; return 3; }
  read_lock; age=$(( $(now) - ${L_TIME:-0} ))
  if [ -n "$L_OWNER" ] && [ "$L_OWNER" != "$me" ] && [ "$L_STATE" = active ] && [ "$age" -lt "$STALE" ]; then
    release_guard || die "lock guard cleanup failed"
    echo "locked $L_OWNER ${age}s"; return 3
  fi
  [ -n "${GITHUB_WORK_BOARD_CLAIM_HOLD:-}" ] && sleep "$GITHUB_WORK_BOARD_CLAIM_HOLD"
  write_lock "$me" active || { release_guard; die "lock write failed"; }
  release_guard || die "lock guard cleanup failed"
  echo claimed
}
mine_or_fail() { read_lock; [ "$L_OWNER" = "$1" ] || { echo "not owner: lock held by ${L_OWNER:-nobody}"; return 3; }; }
release_lock() {
  local me=$1
  acquire_guard || { echo "locked updating 0s"; return 3; }
  mine_or_fail "$me" || { release_guard; return 3; }
  rm -f "$LOCK" || { release_guard; die "lock release failed"; }
  release_guard || die "lock guard cleanup failed"
  echo released
}

# ---------- GitHub reads ----------
ITEMS= PRS= ISSUE= FIELDS= PROJECT_JSON=
load_items() { [ -n "$ITEMS" ] || ITEMS=$(gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --limit 500 --format json) || die "GitHub project read failed"; }
load_prs() { [ -n "$PRS" ] || PRS=$(gh pr list -R "$GH_REPO" --state open --limit 100 --json number,headRefName,headRefOid,isDraft,title) || die "GitHub PR read failed"; }
load_issue() { ISSUE=$(gh issue view "$1" -R "$GH_REPO" --json number,title,body,labels,comments,state,url) || die "GitHub issue #$1 read failed"; }
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
  local matches
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
  require_config; load_items; load_prs; fetch
  if [ "$json" = 1 ]; then
    triage_rows "$@" | jq -Rsc 'split("\n")|map(select(length>0)|split("\t"))|map({number:(.[0]|tonumber),title:.[1],priority:.[2],action:.[3],reason:.[4],question:.[5]})'
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
  local n=$1 title priority state action=CHECK reason=- question=- work= pr
  load_issue "$n"; title=$(jq -r '.title | gsub("[\\t\\n]";" ")' <<< "$ISSUE"); priority=$(item_field "$n" "$PRIORITY_KEY"); state=$(jq -r .state <<< "$ISSUE")
  if [ "$state" != OPEN ]; then action=PARK; reason="issue is $state"; question="Reopen #$n or remove it from a Ready status. Default: leave parked."; fi
  if ! issue_has_label "$OWNED_LABEL"; then
    work=$(dev_worktree "$n") || return 1
    if [ -z "$work" ]; then work=$(local_branch "$n") || return 1; fi
    if [ -z "$work" ]; then work=$(remote_branch "$n") || return 1; fi
    pr=$(open_pr_for "$n") || return 1
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
  if [ "$json" = 1 ]; then { for n in $nums; do state_one "$n" json || return 1; done; } | jq -s '.'; else for n in $nums; do state_one "$n" text || return 1; done; fi
}
state_one() {
  local n=$1 format=$2 wt branch head= dirty=false pr last status pr_num pr_branch pr_head
  load_issue "$n"; wt=$(dev_worktree "$n") || return 1; branch=$(local_branch "$n") || return 1
  if [ -n "$wt" ]; then head=$(git -C "$wt" rev-parse HEAD); [ -n "$(git -C "$wt" status --porcelain)" ] && dirty=true; fi
  pr=$(open_pr_for "$n") || return 1; pr_num=${pr%% *}; pr_branch=$(echo "$pr" | cut -s -d' ' -f2); pr_head=$(echo "$pr" | cut -s -d' ' -f3)
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
  require_config; load_issue "$1"; fetch; result=$(changed_line "$2" "$3")
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
  load_items; load_project_meta
  project_id=$(jq -r .id <<< "$PROJECT_JSON"); field_id=$(jq -r --arg field "$STATUS_FIELD" '.fields[] | select(.name==$field) | .id' <<< "$FIELDS" | sed -n '1p'); option_id=$(status_option_id "$status"); item=$(item_id "$n")
  [ -n "$project_id" ] && [ -n "$field_id" ] && [ -n "$option_id" ] && [ -n "$item" ] || refuse "cannot resolve project status '$status' for #$n"
  gh project item-edit --project-id "$project_id" --id "$item" --field-id "$field_id" --single-select-option-id "$option_id" > /dev/null || die "status edit failed for #$n"
}
comment_once() {
  local kind=$1 n=$2 body="[work-board] $3" existing
  if [ "$kind" = issue ]; then existing=$ISSUE; else existing=$(gh pr view "$n" -R "$GH_REPO" --json comments) || die "PR #$n read failed"; fi
  jq -e --arg body "$body" '[.comments[].body] | index($body)' <<< "$existing" > /dev/null && return 0
  gh "$kind" comment "$n" -R "$GH_REPO" --body "$body" > /dev/null || die "comment on $kind #$n failed"
}
start() {
  require_config; load_issue "$1"
  issue_has_label "$BLOCKED_LABEL" && refuse "#$1 has $BLOCKED_LABEL"
  issue_has_label "$OWNED_LABEL" || gh issue edit "$1" -R "$GH_REPO" --add-label "$OWNED_LABEL" > /dev/null || die "label edit failed"
  set_status "$1" "$IN_PROGRESS"; comment_once issue "$1" started; echo "started #$1"
}
move() {
  require_config
  case $2 in "$IN_PROGRESS"|"$REVIEW"|"$READY_TO_MERGE") ;; *) refuse "status '$2' is not configured for this workflow" ;; esac
  set_status "$1" "$2"; echo "moved #$1 $2"
}
note() { require_config; load_issue "$1"; comment_once issue "$1" "$2"; echo "noted #$1"; }
park() {
  require_config; load_issue "$1"
  issue_has_label "$BLOCKED_LABEL" || gh issue edit "$1" -R "$GH_REPO" --add-label "$BLOCKED_LABEL" > /dev/null || die "label edit failed"
  comment_once issue "$1" "parked: $2"; echo "parked #$1"
}
ready() {
  local n=$1 reviewed head pr pr_num pr_head pr_draft wt
  require_config; load_prs; load_issue "$n"; fetch
  reviewed=$(git -C "$REPO" rev-parse --verify -q "$2^{commit}") || refuse "unknown commit $2"
  head=$(git -C "$REPO" rev-parse --verify -q "$3^{commit}") || refuse "unknown commit $3"
  [ "$reviewed" = "$head" ] || refuse "reviewed SHA and head differ"
  pr=$(open_pr_for "$n") || return 1; [ -n "$pr" ] || refuse "no open PR for #$n"
  pr_num=${pr%% *}; pr_head=$(echo "$pr" | cut -d' ' -f3); pr_draft=$(echo "$pr" | cut -d' ' -f4)
  [ "$pr_head" = "$head" ] || refuse "PR #$pr_num head $pr_head is not $head"
  wt=$(dev_worktree "$n") || return 1
  if [ -n "$wt" ]; then
    [ "$(git -C "$wt" rev-parse HEAD)" = "$head" ] || refuse "local worktree head differs"
    [ -z "$(git -C "$wt" status --porcelain)" ] || refuse "local worktree is dirty"
  fi
  git -C "$REPO" merge-base --is-ancestor "origin/$BASE_BRANCH" "$head" || refuse "origin/$BASE_BRANCH is not an ancestor of $head"
  [ "$pr_draft" = true ] && gh pr ready "$pr_num" -R "$GH_REPO" > /dev/null || [ "$pr_draft" != true ] || die "PR ready failed"
  comment_once issue "$n" "READY TO MERGE PR #$pr_num reviewed $reviewed"
  comment_once pr "$pr_num" "READY TO MERGE reviewed $reviewed"
  set_status "$n" "$READY_TO_MERGE"; echo "ready #$n PR #$pr_num"
}

# ---------- worktrees ----------
issue_slug() { jq -r '.title' <<< "$ISSUE" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | sed 's/^-//;s/-$//' | cut -d- -f1-6; }
worktree() {
  local n=$1 wt branch remote slug path
  require_config; load_issue "$n"; wt=$(dev_worktree "$n") || return 1; [ -n "$wt" ] && { echo "$wt"; return 0; }
  fetch; mkdir -p "$WT_ROOT"; slug=$(issue_slug); path="$WT_ROOT/$n-$slug"; branch=$(local_branch "$n") || return 1
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
  if [ -d "$path" ]; then git -C "$path" checkout -q --detach "$2" || die "checkout $2 failed"; else mkdir -p "$WT_ROOT"; git -C "$REPO" worktree add -q --detach "$path" "$2" || die "verifier worktree add failed"; fi
  echo "$path"
}
verify_check() {
  require_config; local path; path=$(verify_path "$1"); [ -d "$path" ] || refuse "no verifier worktree"
  [ -z "$(git -C "$path" status --porcelain)" ] || refuse "verifier worktree is dirty"
  [ "$(git -C "$path" rev-parse HEAD)" = "$(git -C "$REPO" rev-parse "$2^{commit}")" ] || refuse "verifier worktree is not at $2"
  echo clean
}
verify_remove() { require_config; local path; path=$(verify_path "$1"); [ -d "$path" ] || { echo removed; return 0; }; git -C "$REPO" worktree remove "$path" || refuse "git refused verifier removal"; echo removed; }

# ---------- watcher ----------
fingerprint() {
  local items prs
  items=$(gh project item-list "$PROJECT_NUMBER" --owner "$PROJECT_OWNER" --limit 500 --format json) || return 1
  prs=$(gh pr list -R "$GH_REPO" --state closed --limit 100 --json number) || return 1
  { jq -r --arg sk "$STATUS_KEY" --arg blocked "$BLOCKED_LABEL" --argjson statuses "$OPEN_STATUSES_JSON" '.items[] | select(.content.number != null) | select(.[$sk] as $s | $statuses | index($s)) | select(((.labels // []) | index($blocked)) == null) | "open \(.content.number)"' <<< "$items" && jq -r '.[] | "pr \(.number)"' <<< "$prs"; } | sort
}
read_backoff() { W_FAILS=0 W_NEXT=0 W_KIND=github; [ -f "$BACKOFF" ] && read -r W_FAILS W_NEXT W_KIND < "$BACKOFF"; }
write_backoff() { local tmp="$BACKOFF.tmp.$$"; (umask 077; printf '%s %s %s\n' "$1" "$2" "$3" > "$tmp") && mv "$tmp" "$BACKOFF"; }
watch() {
  local owner=$1; shift; local tick=0 interval=600 jitter=30 max=6600 start base= have=0 raw fp fails wait elapsed end kind=github retry remaining
  require_config
  while [ $# -gt 0 ]; do case $1 in --tick) tick=$2; shift 2 ;; --interval) interval=$2; shift 2 ;; --jitter) jitter=$2; shift 2 ;; --max) max=$2; shift 2 ;; *) echo "error usage $1"; return 2 ;; esac; done
  end=$max; [ "$tick" -gt 0 ] && [ "$tick" -lt "$end" ] && end=$tick; start=$(now); read_backoff; fails=$W_FAILS; kind=$W_KIND
  if [ "$W_NEXT" -gt "$(now)" ]; then remaining=$((W_NEXT - $(now))); [ "$remaining" -gt "$end" ] && remaining=$end; sleep "$remaining"; fi
  while :; do
    claim "$owner" > /dev/null || { read_lock; echo "error locked $L_OWNER"; return 3; }
    if raw=$(fingerprint 2>&1); then
      fp=$raw; fails=0; kind=github; rm -f "$BACKOFF"; wait=$interval; [ "$jitter" -gt 0 ] && wait=$((wait + RANDOM % (jitter + 1)))
      [ "$have" = 1 ] && [ -n "$(comm -13 <(echo "$base") <(echo "$fp"))" ] && { echo changed; return 0; }; base=$fp; have=1
    else
      case $(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]') in *"rate limit"*|*"secondary rate"*|*"http 403"*) kind=rate-limit ;; *) kind=github ;; esac
      fails=$((fails + 1)); wait=$((fails > 12 ? 3600 : interval << fails)); [ "$wait" -gt 3600 ] && wait=3600; retry=$(( $(now) + wait )); write_backoff "$fails" "$retry" "$kind" || die "backoff write failed"
    fi
    elapsed=$(( $(now) - start ))
    if [ "$elapsed" -ge "$end" ]; then if [ "$fails" -gt 0 ]; then [ "$kind" = rate-limit ] && echo "error github rate-limit" || echo "error github"; elif [ "$elapsed" -ge "$max" ]; then echo idle; else echo tick; fi; return 0; fi
    [ "$wait" -gt $((end - elapsed)) ] && wait=$((end - elapsed)); sleep "$wait"
  done
}

# ---------- dispatch ----------
cmd=${1:-}; [ $# -gt 0 ] && shift
case $cmd in
  doctor) doctor "$@" ;;
  status) read_lock; if [ -n "$L_OWNER" ]; then echo "$L_OWNER $L_STATE age=$(( $(now) - ${L_TIME:-0} ))s"; else echo "none none age=0s"; fi ;;
  claim) need $# 1 "claim <owner>"; claim "$1" ;;
  release) need $# 1 "release <owner>"; release_lock "$1" ;;
  triage) triage "$@" ;;
  state) state "$@" ;;
  changed) changed "$@" ;;
  start) need $# 1 "start <issue>"; start "$1" ;;
  move) need $# 2 "move <issue> <status>"; move "$1" "$2" ;;
  note) need $# 2 "note <issue> <text>"; note "$1" "$2" ;;
  park) need $# 2 "park <issue> <question>"; park "$1" "$2" ;;
  ready) need $# 3 "ready <issue> <reviewed-sha> <head-sha>"; ready "$1" "$2" "$3" ;;
  worktree) need $# 1 "worktree <issue>"; worktree "$1" ;;
  verify-at) need $# 2 "verify-at <issue> <sha>"; verify_at "$1" "$2" ;;
  verify-check) need $# 2 "verify-check <issue> <sha>"; verify_check "$1" "$2" ;;
  verify-remove) need $# 1 "verify-remove <issue>"; verify_remove "$1" ;;
  watch) need $# 1 "watch <owner>"; watch "$@" ;;
  *) echo "error usage ${cmd:-<none>}"; exit 2 ;;
esac
