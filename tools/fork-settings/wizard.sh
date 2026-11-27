#!/usr/bin/env bash
# shellcheck disable=SC2317  # chk_*, app_*, title_* are called dynamically
# Checklist and wizard for the server fork's settings that only a person can change.
# See README.md in this folder. Needs: bash, gh (logged in, admin on the repo to change
# settings), jq. Reading is always safe; changing happens only with --apply, one
# confirmed step at a time.
# `set -e` is deliberately off: every check records a state (PASS, TODO, WAITING, UNKNOWN) and its error text
# instead of stopping, so one unreadable setting never hides the others, and failed `gh` calls are expected input.
set -uo pipefail

REPO="printminion-co/mk-nc-server"
MODE=""
DRY=0
LIVE_LINE=""
DEV_BRANCH=""
SIGNED_RULESET="ncw-signed-commits"
SNAPSHOT_BRANCH_RULESET="ncw-snapshot-branches"
SNAPSHOT_TAG_RULESET="ncw-snapshot-tags"
MIRROR_RULESET="ncw-pristine-mirrors"

usage() {
  cat <<USAGE
Usage: wizard.sh (--check | --apply [--dry-run]) [--repo owner/name]
                 [--live-line NN] [--dev-branch BRANCH]

  --check            Read-only. Prints PASS, TODO, WAITING or UNKNOWN per setting with the
                     evidence. Exit code 0 only when no setting is TODO.
  --apply            Interactive. For each TODO setting shows what it does and the exact
                     gh api command, then asks y/n before running it.
  --dry-run          With --apply: print the commands, run none, ask nothing.
  --repo owner/name  Target repository (default: $REPO).
  --live-line NN     Cutover: the live line, for example 33. Turns the default-branch
                     setting from WAITING into a checked and applicable one.
  --dev-branch NAME  Branch whose recent commits are listed for the signing check
                     (default: the default branch if it is ionos-dev-v*, else the
                     highest ionos-dev-v* branch).
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE=check ;;
    --apply) MODE=apply ;;
    --dry-run) DRY=1 ;;
    --repo) REPO="${2:-}"; shift ;;
    --live-line) LIVE_LINE="${2:-}"; shift ;;
    --dev-branch) DEV_BRANCH="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[ -n "$MODE" ] || { usage >&2; exit 2; }
if [ "$DRY" = 1 ] && [ "$MODE" != apply ]; then echo "--dry-run needs --apply" >&2; exit 2; fi
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || { echo "--repo must look like owner/name" >&2; exit 2; }
if [ -n "$DEV_BRANCH" ] && ! [[ "$DEV_BRANCH" =~ ^ionos-dev-v[0-9]+$ ]]; then echo "--dev-branch must look like ionos-dev-v33" >&2; exit 2; fi
if [ -n "$LIVE_LINE" ] && ! [[ "$LIVE_LINE" =~ ^[0-9]+$ ]]; then echo "--live-line must be a number" >&2; exit 2; fi
command -v gh >/dev/null || { echo "gh is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

# ---------------------------------------------------------------- helpers
OUT=""
# get PATH [gh api args...]: read-only call; OUT holds the body or the error text.
get() {
  OUT=$(gh api "$@" 2>&1) && return 0
  return 1
}

STATE=""; EVID=(); FIX=()
set_state() { STATE="$1"; shift; EVID=("$@"); }
fix() { FIX+=("$1"); }

# plan helpers: PLAN_CMD holds each command as its arguments joined by the unit separator (so an argument can
# hold any other character and is never parsed by a shell), PLAN_BODY the JSON piped in for each (empty when
# none). PLAN_INTERACTIVE=1 lets the command talk to the person (a prompt) instead of discarding its output.
US=$'\x1f'
PLAN_DESC=""; PLAN_CMD=(); PLAN_BODY=(); PLAN_INTERACTIVE=0
plan_reset() { PLAN_DESC=""; PLAN_CMD=(); PLAN_BODY=(); PLAN_INTERACTIVE=0; }
plan_add() { # plan_add BODY args...
  local body="$1"; shift
  PLAN_BODY+=("$body")
  local IFS="$US"
  PLAN_CMD+=("$*")
}
plan_argv() { # plan_argv K -> ARGV holds the arguments of command K
  IFS="$US" read -r -a ARGV <<<"${PLAN_CMD[$1]}"
}

R_JSON=""; RULESETS=""; RULESETS_ERR=""
load_repo() { [ -n "$R_JSON" ] || { get "repos/$REPO" && R_JSON="$OUT"; }; }
load_rulesets() {
  [ -n "$RULESETS" ] || [ -n "$RULESETS_ERR" ] && return 0
  if ! get "repos/$REPO/rulesets"; then RULESETS_ERR="$OUT"; return 0; fi
  local ids id acc="[]"
  ids=$(printf '%s' "$OUT" | jq -r '.[].id')
  for id in $ids; do
    if get "repos/$REPO/rulesets/$id"; then acc=$(printf '%s' "$acc" | jq --argjson d "$OUT" '. + [$d]'); fi
  done
  RULESETS="$acc"
}

# covers_target TARGET PATTERN RULE...: succeed when an active ruleset of TARGET (branch or tag) includes PATTERN
# with all RULEs.
covers_target() {
  local target="$1" pat="$2"; shift 2
  local rules; rules=$(printf '%s\n' "$@" | jq -R . | jq -s .)
  printf '%s' "$RULESETS" | jq -e --arg p "$pat" --arg t "$target" --argjson r "$rules" '
    any(.[]; .enforcement=="active" and .target==$t
      and ((.conditions.ref_name.include // []) | any(.==$p))
      and ((.rules // [] | map(.type)) as $t | all($r[]; . as $x | $t | any(.==$x))))' >/dev/null
}
# covers PATTERN RULE...: the same for a branch ruleset.
covers() { local pat="$1"; shift; covers_target branch "$pat" "$@"; }
ruleset_id() { printf '%s' "$RULESETS" | jq -r --arg n "$1" '[.[]|select(.name==$n)|.id][0] // empty'; }

pick_dev_branch() {
  [ -n "$DEV_BRANCH" ] && { echo "$DEV_BRANCH"; return; }
  load_repo
  local db; db=$(printf '%s' "$R_JSON" | jq -r '.default_branch // empty')
  if [[ "$db" =~ ^ionos-dev-v[0-9]+$ ]]; then echo "$db"; return; fi
  get "repos/$REPO/branches" -X GET -f per_page=100 || return 0
  printf '%s' "$OUT" | jq -r '.[].name' | grep -E '^ionos-dev-v[0-9]+$' | sort -V | tail -1
}

# ---------------------------------------------------------------- settings
IDS=(default_branch signed_commits pristine_mirrors token_permissions fork_pr_approval signing_keys upstream_workflows sync_token snapshot_refs)

title_default_branch()    { echo "Default branch is the live line's dev branch (ionos-dev-v<nn>)"; }
title_signed_commits()    { echo "Signed commits required on ionos-dev-v* and rc/*"; }
title_pristine_mirrors()  { echo "Mirrors master and stable* protected from force push and deletion"; }
title_token_permissions() { echo "Workflow token: read and write permissions"; }
title_fork_pr_approval()  { echo "Fork pull request workflows need approval from all outside collaborators"; }
title_signing_keys()      { echo "Every developer has a signing key on GitHub"; }
title_upstream_workflows(){ echo "Upstream's workflows stay disabled"; }
title_sync_token()        { echo "Repository secret IONOS_SYNC_TOKEN exists (token with workflow scope)"; }
title_snapshot_refs()     { echo "Snapshots never rewritten: rc/* branches and ncw-v* tags protected from force push and deletion"; }

chk_default_branch() {
  load_repo || { set_state UNKNOWN "cannot read the repository: $OUT"; return; }
  local db; db=$(printf '%s' "$R_JSON" | jq -r '.default_branch')
  if [ -n "$LIVE_LINE" ]; then
    local want="ionos-dev-v$LIVE_LINE"
    if [ "$db" = "$want" ]; then set_state PASS "default branch is $db"
    else
      set_state TODO "default branch is $db, the live line $LIVE_LINE wants $want"
      fix "Settings > Branches: https://github.com/$REPO/settings/branches"
    fi
  elif [[ "$db" =~ ^ionos-dev-v[0-9]+$ ]]; then
    set_state PASS "default branch is $db"
  else
    set_state WAITING "default branch is $db; nothing is live yet" \
      "MUST WAIT for cutover. Then run with --live-line <nn> (for example --live-line 33)."
  fi
}
app_default_branch() {
  plan_reset
  [ -n "$LIVE_LINE" ] || return 0
  PLAN_DESC="Switch the default branch to ionos-dev-v$LIVE_LINE. Scheduled and manual workflows run only from the default branch, so this is the cutover step. Do it only when the live line really moves."
  plan_add "" gh api -X PATCH "repos/$REPO" -f "default_branch=ionos-dev-v$LIVE_LINE"
}

chk_signed_commits() {
  load_rulesets
  [ -z "$RULESETS_ERR" ] || { set_state UNKNOWN "cannot read rulesets (needs admin): $RULESETS_ERR"; return; }
  local missing=() p
  for p in 'refs/heads/ionos-dev-v*' 'refs/heads/rc/*'; do
    covers "$p" required_signatures || missing+=("$p")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    set_state PASS "active ruleset requires signed commits on ionos-dev-v* and rc/*"
  else
    set_state TODO "no active ruleset with required_signatures for: ${missing[*]}" \
      "Classic branch protection is not looked at; use a repository ruleset."
    fix "Settings > Rules > Rulesets: https://github.com/$REPO/settings/rules"
  fi
}
app_signed_commits() {
  plan_reset
  local body id
  body='{"name":"'"$SIGNED_RULESET"'","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/ionos-dev-v*","refs/heads/rc/*"],"exclude":[]}},"rules":[{"type":"required_signatures"}]}'
  PLAN_DESC="Create the ruleset '$SIGNED_RULESET': signed commits required on ionos-dev-v* and rc/*. Candidate branches stay unsigned (they are not covered); promoting one needs a re-signed series."
  id=$(ruleset_id "$SIGNED_RULESET")
  if [ -n "$id" ]; then plan_add "$body" gh api -X PUT "repos/$REPO/rulesets/$id" --input -
  else plan_add "$body" gh api -X POST "repos/$REPO/rulesets" --input -; fi
}

chk_pristine_mirrors() {
  load_rulesets
  [ -z "$RULESETS_ERR" ] || { set_state UNKNOWN "cannot read rulesets (needs admin): $RULESETS_ERR"; return; }
  local missing=() p
  for p in 'refs/heads/master' 'refs/heads/stable*'; do
    covers "$p" non_fast_forward deletion || missing+=("$p")
  done
  if [ ${#missing[@]} -eq 0 ]; then
    set_state PASS "active ruleset blocks force push and deletion on master and stable*"
  else
    set_state TODO "no active ruleset blocking force push and deletion for: ${missing[*]}" \
      "Only the sync automation should push to the mirrors (fast-forward)."
    fix "Settings > Rules > Rulesets: https://github.com/$REPO/settings/rules"
  fi
}
app_pristine_mirrors() {
  plan_reset
  local body id
  body='{"name":"'"$MIRROR_RULESET"'","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/master","refs/heads/stable*"],"exclude":[]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}'
  PLAN_DESC="Create the ruleset '$MIRROR_RULESET': no force push and no deletion on master and stable*. The mirror sync only fast-forwards. If upstream ever rewrites history, add a bypass for the sync in the ruleset."
  id=$(ruleset_id "$MIRROR_RULESET")
  if [ -n "$id" ]; then plan_add "$body" gh api -X PUT "repos/$REPO/rulesets/$id" --input -
  else plan_add "$body" gh api -X POST "repos/$REPO/rulesets" --input -; fi
}

chk_token_permissions() {
  get "repos/$REPO/actions/permissions/workflow" || { set_state UNKNOWN "cannot read workflow permissions (needs admin): $OUT"; return; }
  local dwp car
  dwp=$(printf '%s' "$OUT" | jq -r '.default_workflow_permissions')
  car=$(printf '%s' "$OUT" | jq -r '.can_approve_pull_request_reviews')
  local info="can_approve_pull_request_reviews=$car (not needed while the sync token opens pull requests)"
  if [ "$dwp" = write ]; then
    set_state PASS "default_workflow_permissions=$dwp" "$info"
  else
    set_state TODO "default_workflow_permissions=$dwp (want write)" "$info" \
      "Write: the sync and snapshot workflows push branches, create issues and disable workflows. Commit-lint declares its own minimal permissions."
    fix "Settings > Actions > General: https://github.com/$REPO/settings/actions"
  fi
}
app_token_permissions() {
  plan_reset
  PLAN_DESC="Set the workflow token default to read and write. If an organization policy caps this, GitHub rejects it; change the org setting first."
  plan_add "" gh api -X PUT "repos/$REPO/actions/permissions/workflow" -f default_workflow_permissions=write
}

chk_fork_pr_approval() {
  get "repos/$REPO/actions/permissions/fork-pr-contributor-approval" || { set_state UNKNOWN "cannot read the approval policy (needs admin): $OUT"; return; }
  local pol; pol=$(printf '%s' "$OUT" | jq -r '.approval_policy')
  if [ "$pol" = all_external_contributors ]; then set_state PASS "approval_policy=$pol"
  else
    set_state TODO "approval_policy=$pol (want all_external_contributors)"
    fix "Settings > Actions > General > Fork pull request workflows: https://github.com/$REPO/settings/actions"
  fi
}
app_fork_pr_approval() {
  plan_reset
  PLAN_DESC="Require approval before workflows run for pull requests from all outside collaborators."
  plan_add "" gh api -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" -f approval_policy=all_external_contributors
}

chk_signing_keys() {
  local br; br=$(pick_dev_branch)
  if [ -z "$br" ]; then set_state UNKNOWN "no ionos-dev-v* branch found to inspect" "Keys per person cannot be read through the API."; return; fi
  if ! get "repos/$REPO/commits" -X GET -f "sha=$br" -f per_page=100; then set_state UNKNOWN "cannot list commits of $br: $OUT"; return; fi
  local rows n bad
  rows=$(printf '%s' "$OUT" | jq -r '[.[]|select(.commit.message|startswith("IONOS("))][:10][]
    | [.sha[0:8], (.author.login // .commit.author.name), (.commit.verification.verified|tostring), .commit.verification.reason, (.commit.message|split("\n")[0])] | @tsv')
  if [ -z "$rows" ]; then
    set_state UNKNOWN "no IONOS( commits on $br yet; nothing to show" "UNKNOWN by nature: GitHub's API does not list people's signing keys."
    return
  fi
  n=$(printf '%s\n' "$rows" | wc -l)
  bad=$(printf '%s\n' "$rows" | awk -F'\t' '$3!="true"' | wc -l)
  local ev=() line
  ev+=("UNKNOWN by nature: the API cannot list people's signing keys. Evidence: the last $n IONOS( commits on $br, $bad not verified.")
  while IFS= read -r line; do ev+=("$(printf '%s' "$line" | awk -F'\t' '{printf "%s  %-20s verified=%s (%s)  %s", $1,$2,$3,$4,$5}')"); done <<<"$rows"
  [ "$bad" -eq 0 ] || fix "A developer with unverified commits needs a key: https://github.com/settings/keys"
  set_state UNKNOWN "${ev[@]}"
}
app_signing_keys() {
  plan_reset
  PLAN_DESC="Manual, per developer (no command changes this for them):
    1. gpg --list-secret-keys --keyid-format=long        (find your key id)
    2. gpg --armor --export <KEYID>                      (paste at https://github.com/settings/keys, New GPG key)
       SSH signing works too: git config gpg.format ssh; add the key as a Signing key.
    3. git config --global user.signingkey <KEYID>
    4. git config --global commit.gpgsign true
    5. Commit, push, open the commit on GitHub: it must show the green Verified badge.
    6. Rerun: wizard.sh --check --repo $REPO   (the commit list above shows verified=true)."
}

UPSTREAM_ACTIVE=""
chk_upstream_workflows() {
  if ! get "repos/$REPO/actions/workflows" --paginate; then set_state UNKNOWN "cannot list workflows: $OUT"; return; fi
  local all; all=$(printf '%s' "$OUT" | jq -s '[.[].workflows[]]')
  UPSTREAM_ACTIVE=$(printf '%s' "$all" | jq -r '.[]|select((.path|startswith(".github/workflows/ionos-")|not) and .state=="active")|[.id,.path]|@tsv')
  local total up_off ionos
  total=$(printf '%s' "$all" | jq 'length')
  ionos=$(printf '%s' "$all" | jq '[.[]|select(.path|startswith(".github/workflows/ionos-"))]|length')
  if [ -z "$UPSTREAM_ACTIVE" ]; then
    up_off=$((total - ionos))
    set_state PASS "all $up_off non-ionos workflows are disabled; $ionos ionos-* workflow(s) present"
  else
    local ev=() line
    ev+=("$(printf '%s\n' "$UPSTREAM_ACTIVE" | wc -l) upstream workflow(s) still active:")
    while IFS= read -r line; do ev+=("  ${line#*$'\t'} (id ${line%%$'\t'*})"); done <<<"$UPSTREAM_ACTIVE"
    set_state TODO "${ev[@]}" "The sync automation will keep them disabled once it exists; until then do it once here."
    fix "Actions tab: https://github.com/$REPO/actions"
  fi
}
app_upstream_workflows() {
  plan_reset
  PLAN_DESC="Disable each upstream workflow that is still active (files stay untouched, so rebases do not conflict)."
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    plan_add "" gh api -X PUT "repos/$REPO/actions/workflows/${line%%$'\t'*}/disable"
  done <<<"$UPSTREAM_ACTIVE"
}

chk_sync_token() {
  if get "repos/$REPO/actions/secrets/IONOS_SYNC_TOKEN"; then
    set_state PASS "secret IONOS_SYNC_TOKEN exists; its scope and expiry cannot be verified by the API"
  elif [[ "$OUT" == *"HTTP 404"* ]]; then
    set_state TODO "secret IONOS_SYNC_TOKEN does not exist" \
      "The sync and snapshot workflows push branches that contain workflow files, which the default workflow token may not do, and they open the pull requests; they use this token instead."
    fix "Settings > Secrets and variables > Actions: https://github.com/$REPO/settings/secrets/actions"
  else
    set_state UNKNOWN "cannot read the secret (needs admin): $OUT"
  fi
}
app_sync_token() {
  plan_reset
  PLAN_DESC="Create the secret IONOS_SYNC_TOKEN. First, by hand, create a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new limited to $REPO with these repository permissions, read and write, and no more: Contents, Workflows, Pull requests, Issues, Actions. Then the command below prompts you for the token value; this script never reads, shows or stores it."
  plan_add "" gh secret set IONOS_SYNC_TOKEN --repo "$REPO"
  PLAN_INTERACTIVE=1
}

chk_snapshot_refs() {
  load_rulesets
  [ -z "$RULESETS_ERR" ] || { set_state UNKNOWN "cannot read rulesets (needs admin): $RULESETS_ERR"; return; }
  local missing=()
  covers_target branch 'refs/heads/rc/*' non_fast_forward deletion || missing+=('refs/heads/rc/*')
  covers_target tag 'refs/tags/ncw-v*' non_fast_forward deletion || missing+=('refs/tags/ncw-v*')
  if [ ${#missing[@]} -eq 0 ]; then
    set_state PASS "active rulesets block force push and deletion on rc/* branches and ncw-v* tags"
  else
    set_state TODO "no active ruleset blocking force push and deletion for: ${missing[*]}" \
      "A snapshot branch and its tag must never be moved or deleted (spec 01, Releases). Creating them stays allowed. Rehearsal refs (rehearsal/*, rehearsal-v*) are not covered on purpose."
    fix "Settings > Rules > Rulesets: https://github.com/$REPO/settings/rules"
  fi
}
app_snapshot_refs() {
  plan_reset
  local bbody tbody id
  bbody='{"name":"'"$SNAPSHOT_BRANCH_RULESET"'","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/rc/*"],"exclude":[]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}'
  tbody='{"name":"'"$SNAPSHOT_TAG_RULESET"'","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/ncw-v*"],"exclude":[]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}'
  PLAN_DESC="Create the rulesets '$SNAPSHOT_BRANCH_RULESET' (rc/* branches) and '$SNAPSHOT_TAG_RULESET' (ncw-v* tags): no force push and no deletion. Creating a ref stays allowed, so the snapshot workflow still works; a wrong snapshot can then only be superseded by a new release number. Rehearsal refs are not covered."
  id=$(ruleset_id "$SNAPSHOT_BRANCH_RULESET")
  if [ -n "$id" ]; then plan_add "$bbody" gh api -X PUT "repos/$REPO/rulesets/$id" --input -
  else plan_add "$bbody" gh api -X POST "repos/$REPO/rulesets" --input -; fi
  id=$(ruleset_id "$SNAPSHOT_TAG_RULESET")
  if [ -n "$id" ]; then plan_add "$tbody" gh api -X PUT "repos/$REPO/rulesets/$id" --input -
  else plan_add "$tbody" gh api -X POST "repos/$REPO/rulesets" --input -; fi
}

# ---------------------------------------------------------------- output
show_result() { # index id
  local i="$1" id="$2" e
  printf '[%-7s] %d. %s\n' "$STATE" "$i" "$("title_$id")"
  for e in "${EVID[@]}"; do printf '            %s\n' "$e"; done
  if [ "$STATE" = TODO ]; then for e in "${FIX[@]}"; do printf '            fix: %s\n' "$e"; done; fi
}
run_check() { # id -> sets STATE
  EVID=(); FIX=(); "chk_$1"
}

if [ "$MODE" = check ]; then
  echo "Fork settings for $REPO (read-only)"
  load_repo && printf '%s' "$R_JSON" | jq -e '.permissions.admin==true' >/dev/null 2>&1 || \
    echo "note: not logged in as admin of the repository; some settings may show UNKNOWN."
  todo=0; i=0; declare -A COUNT=()
  for id in "${IDS[@]}"; do
    i=$((i+1)); run_check "$id"; show_result "$i" "$id"
    COUNT[$STATE]=$(( ${COUNT[$STATE]:-0} + 1 ))
    [ "$STATE" = TODO ] && todo=$((todo+1))
  done
  echo
  echo "Summary: PASS=${COUNT[PASS]:-0} TODO=${COUNT[TODO]:-0} WAITING=${COUNT[WAITING]:-0} UNKNOWN=${COUNT[UNKNOWN]:-0}"
  [ "$todo" -eq 0 ]; exit $?
fi

# ---------------------------------------------------------------- apply
confirm() { # prompt -> 0 on y
  local a; printf '%s [y/N] ' "$1"
  read -r a || { echo; return 1; }
  [ "$a" = y ] || [ "$a" = Y ]
}
show_plan() {
  local k
  printf '  What: %s\n' "$PLAN_DESC"
  for k in "${!PLAN_CMD[@]}"; do
    plan_argv "$k"
    if [ -n "${PLAN_BODY[$k]}" ]; then printf "  Command: echo '%s' | %s\n" "${PLAN_BODY[$k]}" "$(printf '%q ' "${ARGV[@]}")"
    else printf '  Command: %s\n' "$(printf '%q ' "${ARGV[@]}")"; fi
  done
}
run_plan() {
  local k rc=0
  for k in "${!PLAN_CMD[@]}"; do
    plan_argv "$k"
    if [ "$PLAN_INTERACTIVE" = 1 ]; then "${ARGV[@]}" || rc=1
    elif [ -n "${PLAN_BODY[$k]}" ]; then printf '%s' "${PLAN_BODY[$k]}" | "${ARGV[@]}" >/dev/null || rc=1
    else "${ARGV[@]}" >/dev/null || rc=1; fi
  done
  return $rc
}

total=${#IDS[@]}; i=0
echo "Fork settings wizard for $REPO$([ "$DRY" = 1 ] && echo ' (dry run: nothing is changed)')"
for id in "${IDS[@]}"; do
  i=$((i+1))
  echo
  echo "=== Step $i of $total: $("title_$id") ($((total-i)) left)"
  run_check "$id"
  case "$STATE" in
    PASS) show_result "$i" "$id"; echo "  Already done."; continue ;;
    WAITING) show_result "$i" "$id"; echo "  Skipped: waiting for cutover."; continue ;;
    UNKNOWN)
      show_result "$i" "$id"
      "app_$id"; [ -z "$PLAN_DESC" ] || { echo "  How to do it by hand:"; printf '  %s\n' "$PLAN_DESC"; }
      continue ;;
  esac
  show_result "$i" "$id"
  "app_$id"
  show_plan
  if [ "$DRY" = 1 ]; then echo "  [dry-run] not run."; continue; fi
  if confirm "  Run it?"; then
    if run_plan; then
      R_JSON=""; RULESETS=""; RULESETS_ERR=""
      run_check "$id"; echo "  Now: $STATE - ${EVID[0]:-}"
    else echo "  FAILED; see the gh error above or change it in the web UI: ${FIX[0]:-}"; fi
  else echo "  Skipped."; fi
done

echo
echo "Final check:"
R_JSON=""; RULESETS=""; RULESETS_ERR=""
todo=0; i=0
for id in "${IDS[@]}"; do
  i=$((i+1)); run_check "$id"; printf '[%-7s] %d. %s\n' "$STATE" "$i" "$("title_$id")"
  [ "$STATE" = TODO ] && todo=$((todo+1))
done
[ "$todo" -eq 0 ]; exit $?
