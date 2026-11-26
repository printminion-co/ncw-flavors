#!/usr/bin/env bash
# Exercises wizard.sh against a stub gh (no network, no GitHub changes).
# Run: bash tools/fork-settings/test.sh
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WIZ="$HERE/wizard.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS+1)); }
expect() { # name condition-exit
  if [ "$2" -eq 0 ]; then ok "$1"; else fail "$1"; fi
}

mkdir -p "$TMP/bin"
cat > "$TMP/bin/gh" <<'STUB'
#!/usr/bin/env bash
# Fake gh: serves $FX/<path with / ? & = as _>.json, logs every call to $FX/calls.log.
args=("$@"); path=""; write=0; body=""
i=0
while [ $i -lt ${#args[@]} ]; do
  a="${args[$i]}"
  case "$a" in
    api|--paginate) ;;
    -X) write=1; i=$((i+1)) ;;
    -f|-F) write=1; i=$((i+1)) ;;
    --input) write=1; body=$(cat); i=$((i+1)) ;;
    -*) ;;
    *) [ -n "$path" ] || path="$a" ;;
  esac
  i=$((i+1))
done
if [ $write = 1 ]; then echo "WRITE $* ${body:+BODY=$body}" >> "$FX/calls.log"; exit 0; fi
echo "GET $path" >> "$FX/calls.log"
f="$FX/$(printf '%s' "$path" | tr '/?&=' '____').json"
if [ -f "$f" ]; then cat "$f"; else echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
STUB
chmod +x "$TMP/bin/gh"

fixtures() { # dir mode: pass | todo
  local d="$1" m="$2"; mkdir -p "$d"; : > "$d/calls.log"
  local branch=master; [ "$m" = pass ] && branch=ionos-dev-v33
  echo "{\"default_branch\":\"$branch\",\"permissions\":{\"admin\":true}}" > "$d/repos_o_r.json"
  echo '[{"name":"ionos-dev-v33"},{"name":"master"}]' > "$d/repos_o_r_branches_per_page_100.json"
  # shellcheck disable=SC2028
  echo '[{"sha":"aaaaaaaa1111","author":{"login":"alice"},"commit":{"message":"IONOS(ci): x\n\nbody","author":{"name":"A"},"verification":{"verified":true,"reason":"valid"}}},
        {"sha":"bbbbbbbb2222","author":{"login":"bob"},"commit":{"message":"IONOS(app): y","author":{"name":"B"},"verification":{"verified":false,"reason":"unsigned"}}},
        {"sha":"cccccccc3333","author":{"login":"up"},"commit":{"message":"fix: upstream","author":{"name":"U"},"verification":{"verified":false,"reason":"unsigned"}}}]' \
        > "$d/repos_o_r_commits_sha_ionos-dev-v33_per_page_100.json"
  if [ "$m" = pass ]; then
    echo '[{"id":1},{"id":2}]' > "$d/repos_o_r_rulesets.json"
    echo '{"id":1,"name":"s","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/ionos-dev-v*","refs/heads/rc/*"]}},"rules":[{"type":"required_signatures"}]}' > "$d/repos_o_r_rulesets_1.json"
    echo '{"id":2,"name":"m","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/master","refs/heads/stable*"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}' > "$d/repos_o_r_rulesets_2.json"
    echo '{"default_workflow_permissions":"write","can_approve_pull_request_reviews":true}' > "$d/repos_o_r_actions_permissions_workflow.json"
    echo '{"approval_policy":"all_external_contributors"}' > "$d/repos_o_r_actions_permissions_fork-pr-contributor-approval.json"
    echo '{"workflows":[{"id":9,"path":".github/workflows/ionos-commit-lint.yml","state":"active"},{"id":10,"path":".github/workflows/cypress.yml","state":"disabled_manually"}]}' > "$d/repos_o_r_actions_workflows.json"
  else
    echo '[]' > "$d/repos_o_r_rulesets.json"
    echo '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}' > "$d/repos_o_r_actions_permissions_workflow.json"
    echo '{"approval_policy":"first_time_contributors"}' > "$d/repos_o_r_actions_permissions_fork-pr-contributor-approval.json"
    echo '{"workflows":[{"id":9,"path":".github/workflows/ionos-commit-lint.yml","state":"active"},{"id":10,"path":".github/workflows/cypress.yml","state":"active"}]}' > "$d/repos_o_r_actions_workflows.json"
  fi
}
run() { # fixturedir args... (stdin passes through)
  local d="$1"; shift
  FX="$d" PATH="$TMP/bin:$PATH" bash "$WIZ" --repo o/r "$@"
}
absent() { ! grep -q "$1" "$2"; }
writes() { grep -c '^WRITE' "$1/calls.log"; }

# syntax and lint
bash -n "$WIZ"; expect "bash -n" $?
if command -v shellcheck >/dev/null; then shellcheck "$WIZ" "$0"; expect "shellcheck" $?; fi

# 1. cutover done and everything set: no TODO, exit 0, signing keys stay UNKNOWN
fixtures "$TMP/pass" pass
out=$(run "$TMP/pass" --check --live-line 33); rc=$?
expect "all set: exit 0" $((rc))
echo "$out" | grep -q 'PASS=6 TODO=0 WAITING=0 UNKNOWN=1'; expect "all set: summary" $?
echo "$out" | grep -q 'bob .*verified=false'; expect "signing evidence lists unverified commit" $?
echo "$out" | absent 'upstream' /dev/stdin; expect "signing evidence skips non-IONOS commits" $?
[ "$(writes "$TMP/pass")" = 0 ]; expect "--check never writes" $?

# 2. before cutover: WAITING, not a failure
fixtures "$TMP/todo" todo
out=$(run "$TMP/todo" --check); rc=$?
[ $rc -eq 1 ]; expect "todo: exit 1" $?
echo "$out" | grep -q 'WAITING\] 1\.'; expect "todo: default branch WAITING" $?
echo "$out" | grep -q 'TODO   \] 2\.'; expect "todo: signed commits TODO" $?
echo "$out" | grep -q 'TODO   \] 7\.'; expect "todo: upstream workflow TODO" $?
out=$(run "$TMP/todo" --check --live-line 33)
echo "$out" | grep -q 'TODO   \] 1\.'; expect "live line given: default branch TODO" $?

# 3. WAITING alone does not fail: make everything pass except the default branch
fixtures "$TMP/wait" pass; echo '{"default_branch":"master","permissions":{"admin":true}}' > "$TMP/wait/repos_o_r.json"
run "$TMP/wait" --check >/dev/null; expect "WAITING only: exit 0" $?

# 4. UNKNOWN when the API refuses
fixtures "$TMP/denied" pass; rm "$TMP/denied/repos_o_r_actions_permissions_workflow.json"
out=$(run "$TMP/denied" --check --live-line 33)
echo "$out" | grep -q 'UNKNOWN\] 4\.'; expect "API refusal: UNKNOWN" $?

# 5. dry run: shows commands, writes nothing
out=$(run "$TMP/todo" --apply --dry-run </dev/null)
[ "$(writes "$TMP/todo")" = 0 ]; expect "dry-run: no writes" $?
echo "$out" | grep -q 'Command: .*rulesets'; expect "dry-run: prints the ruleset command" $?
echo "$out" | grep -q 'fork-pr-contributor-approval'; expect "dry-run: prints approval command" $?

# 6. y/n flow: order is signed(y) mirrors(n) token(y) approval(n) upstream(y)
: > "$TMP/todo/calls.log"
# with --live-line the default branch step comes first: answer it n
printf 'n\ny\nn\ny\nn\ny\n' | run "$TMP/todo" --apply --live-line 33 >/dev/null
l="$TMP/todo/calls.log"
grep -q 'WRITE.*rulesets.*required_signatures' "$l"; expect "y: signed ruleset POST" $?
absent 'WRITE.*non_fast_forward' "$l"; expect "n: mirror ruleset not created" $?
grep -q 'WRITE.*actions/permissions/workflow.*default_workflow_permissions=write' "$l"; expect "y: token permissions PUT" $?
absent 'WRITE.*fork-pr-contributor-approval' "$l"; expect "n: approval not changed" $?
grep -q 'WRITE.*actions/workflows/10/disable' "$l"; expect "y: upstream workflow 10 disabled" $?
absent 'workflows/9/disable' "$l"; expect "ionos-* workflow left alone" $?
absent 'default_branch=' "$l"; expect "n: default branch not switched" $?
[ "$(writes "$TMP/todo")" = 3 ]; expect "exactly 3 writes" $?

# 7. EOF on stdin counts as no
: > "$TMP/todo/calls.log"; run "$TMP/todo" --apply </dev/null >/dev/null
[ "$(writes "$TMP/todo")" = 0 ]; expect "EOF answers no" $?

# 8. argument errors
run "$TMP/todo" --dry-run >/dev/null 2>&1; [ $? -eq 2 ]; expect "--dry-run alone is refused" $?
run "$TMP/todo" >/dev/null 2>&1; [ $? -eq 2 ]; expect "no mode is refused" $?

echo; [ $FAILS -eq 0 ] && echo "all passed" || echo "$FAILS failed"
exit $FAILS
