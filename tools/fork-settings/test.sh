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
# `-f/-F key=value` on a read become query parameters, as `gh api -X GET` does. A request is a write when its
# method is not GET or it has --input. `gh secret set` is logged as a write and reads nothing. A missing fixture
# is a 404; a `.err` file next to it is printed to stderr instead (to simulate other HTTP errors).
if [ "${1:-}" = secret ]; then echo "WRITE $*" >> "$FX/calls.log"; exit 0; fi
args=("$@"); path=""; method=GET; write=0; body=""; query=""
i=0
while [ $i -lt ${#args[@]} ]; do
  a="${args[$i]}"
  case "$a" in
    api|--paginate) ;;
    -X|--method) method="${args[$((i+1))]}"; i=$((i+1)) ;;
    -f|-F|--field|--raw-field) query="${query:+$query&}${args[$((i+1))]}"; i=$((i+1)) ;;
    --input) write=1; body=$(cat); i=$((i+1)) ;;
    -*) ;;
    *) [ -n "$path" ] || path="$a" ;;
  esac
  i=$((i+1))
done
[ "$method" = GET ] || write=1
if [ $write = 1 ]; then echo "WRITE $* ${body:+BODY=$body}" >> "$FX/calls.log"; exit 0; fi
path="$path${query:+?$query}"
echo "GET $path" >> "$FX/calls.log"
f="$FX/$(printf '%s' "$path" | tr '/?&=' '____').json"
if [ -f "$f" ]; then cat "$f"
elif [ -f "${f%.json}.err" ]; then cat "${f%.json}.err" >&2; exit 1
else echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
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
    echo '[{"id":1},{"id":2},{"id":3},{"id":4}]' > "$d/repos_o_r_rulesets.json"
    echo '{"id":1,"name":"s","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/ionos-dev-v*","refs/heads/rc/*"]}},"rules":[{"type":"required_signatures"}]}' > "$d/repos_o_r_rulesets_1.json"
    echo '{"id":2,"name":"m","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/master","refs/heads/stable*"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}' > "$d/repos_o_r_rulesets_2.json"
    echo '{"id":3,"name":"b","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/rc/*"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}' > "$d/repos_o_r_rulesets_3.json"
    echo '{"id":4,"name":"t","target":"tag","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/ncw-v*"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}' > "$d/repos_o_r_rulesets_4.json"
    echo '{"default_workflow_permissions":"write","can_approve_pull_request_reviews":true}' > "$d/repos_o_r_actions_permissions_workflow.json"
    echo '{"approval_policy":"all_external_contributors"}' > "$d/repos_o_r_actions_permissions_fork-pr-contributor-approval.json"
    echo '{"name":"IONOS_SYNC_TOKEN"}' > "$d/repos_o_r_actions_secrets_IONOS_SYNC_TOKEN.json"
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
echo "$out" | grep -q 'PASS=8 TODO=0 WAITING=0 UNKNOWN=1'; expect "all set: summary" $?
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
echo "$out" | grep -q 'TODO   \] 8\.'; expect "todo: missing sync token secret is TODO" $?
out=$(run "$TMP/todo" --check --live-line 33)
echo "$out" | grep -q 'TODO   \] 1\.'; expect "live line given: default branch TODO" $?

echo "$out" | grep -q 'TODO   \] 9\.'; expect "todo: snapshot refs TODO" $?

# 2b. never rewritten: branch rc/* and tag ncw-v* each need their own ruleset (the target is per ruleset)
out=$(run "$TMP/pass" --check --live-line 33)
echo "$out" | grep -q 'PASS   \] 9\.'; expect "snapshot refs: PASS" $?
fixtures "$TMP/notag" pass; rm "$TMP/notag/repos_o_r_rulesets_4.json"
out=$(run "$TMP/notag" --check --live-line 33)
echo "$out" | grep -q 'TODO   \] 9\..*' ; expect "no tag ruleset: TODO" $?
echo "$out" | grep -q 'refs/tags/ncw-v\*'; expect "no tag ruleset: names the tag pattern" $?
fixtures "$TMP/tagasbranch" pass
echo '{"id":4,"name":"t","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/tags/ncw-v*"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}' > "$TMP/tagasbranch/repos_o_r_rulesets_4.json"
out=$(run "$TMP/tagasbranch" --check --live-line 33)
echo "$out" | grep -q 'TODO   \] 9\.'; expect "tag pattern in a branch-target ruleset does not count" $?
fixtures "$TMP/nodel" pass
echo '{"id":3,"name":"b","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/rc/*"]}},"rules":[{"type":"non_fast_forward"}]}' > "$TMP/nodel/repos_o_r_rulesets_3.json"
out=$(run "$TMP/nodel" --check --live-line 33)
echo "$out" | grep -q 'TODO   \] 9\.'; expect "rc/* without the deletion rule: TODO" $?
fixtures "$TMP/disabled" pass
echo '{"id":3,"name":"b","target":"branch","enforcement":"evaluate","conditions":{"ref_name":{"include":["refs/heads/rc/*"]}},"rules":[{"type":"non_fast_forward"},{"type":"deletion"}]}' > "$TMP/disabled/repos_o_r_rulesets_3.json"
out=$(run "$TMP/disabled" --check --live-line 33)
echo "$out" | grep -q 'TODO   \] 9\.'; expect "inactive ruleset does not count" $?

# 3. WAITING alone does not fail: make everything pass except the default branch
fixtures "$TMP/wait" pass; echo '{"default_branch":"master","permissions":{"admin":true}}' > "$TMP/wait/repos_o_r.json"
run "$TMP/wait" --check >/dev/null; expect "WAITING only: exit 0" $?

# 4. UNKNOWN when the API refuses
fixtures "$TMP/denied" pass; rm "$TMP/denied/repos_o_r_actions_permissions_workflow.json"
out=$(run "$TMP/denied" --check --live-line 33)
echo "$out" | grep -q 'UNKNOWN\] 4\.'; expect "API refusal: UNKNOWN" $?

# 4b. the sync token secret: PASS says what the API cannot verify; 403 and other errors are UNKNOWN with the reason
out=$(run "$TMP/pass" --check --live-line 33)
echo "$out" | grep -q 'PASS   \] 8\.'; expect "secret exists: PASS" $?
echo "$out" | grep -q 'exists; its scope and expiry cannot be verified by the API'; expect "secret exists: says what is not verified" $?
fixtures "$TMP/s403" pass; rm "$TMP/s403/repos_o_r_actions_secrets_IONOS_SYNC_TOKEN.json"
echo 'gh: Resource not accessible by personal access token (HTTP 403)' > "$TMP/s403/repos_o_r_actions_secrets_IONOS_SYNC_TOKEN.err"
out=$(run "$TMP/s403" --check --live-line 33)
echo "$out" | grep -q 'UNKNOWN\] 8\.'; expect "secret 403: UNKNOWN" $?
echo "$out" | grep -q 'HTTP 403'; expect "secret 403: reason shown" $?
fixtures "$TMP/s500" pass; rm "$TMP/s500/repos_o_r_actions_secrets_IONOS_SYNC_TOKEN.json"
echo 'gh: Server Error (HTTP 500)' > "$TMP/s500/repos_o_r_actions_secrets_IONOS_SYNC_TOKEN.err"
out=$(run "$TMP/s500" --check --live-line 33)
echo "$out" | grep -q 'UNKNOWN\] 8\.'; expect "secret 500: UNKNOWN" $?
echo "$out" | grep -q 'HTTP 500'; expect "secret 500: reason shown" $?

# 4c. the workflow token only needs write; approving pull requests is information
fixtures "$TMP/car" pass; echo '{"default_workflow_permissions":"write","can_approve_pull_request_reviews":false}' > "$TMP/car/repos_o_r_actions_permissions_workflow.json"
out=$(run "$TMP/car" --check --live-line 33)
echo "$out" | grep -q 'PASS   \] 4\.'; expect "write without approving pull requests: PASS" $?
echo "$out" | grep -q 'can_approve_pull_request_reviews=false (not needed while the sync token opens pull requests)'; expect "can_approve is reported as information" $?

# 5. dry run: shows commands, writes nothing
out=$(run "$TMP/todo" --apply --dry-run </dev/null)
[ "$(writes "$TMP/todo")" = 0 ]; expect "dry-run: no writes" $?
echo "$out" | grep -q 'Command: .*rulesets'; expect "dry-run: prints the ruleset command" $?
echo "$out" | grep -q 'fork-pr-contributor-approval'; expect "dry-run: prints approval command" $?
echo "$out" | grep -q 'gh secret set IONOS_SYNC_TOKEN --repo o/r'; expect "dry-run: prints the secret command" $?
echo "$out" | grep -q 'Workflows'; expect "dry-run: prints the token steps" $?
echo "$out" | grep -q '"target":"tag".*refs/tags/ncw-v\*'; expect "dry-run: prints the tag ruleset body" $?
echo "$out" | grep -q 'ncw-snapshot-branches'; expect "dry-run: prints the branch ruleset" $?

# 6. y/n flow: order is signed(y) mirrors(n) token(y) approval(n) upstream(y)
: > "$TMP/todo/calls.log"
# with --live-line the default branch step comes first: answer it n
printf 'n\ny\nn\ny\nn\ny\ny\ny\n' | run "$TMP/todo" --apply --live-line 33 >/dev/null
l="$TMP/todo/calls.log"
grep -q 'WRITE.*rulesets.*required_signatures' "$l"; expect "y: signed ruleset POST" $?
absent 'WRITE.*ncw-pristine-mirrors' "$l"; expect "n: mirror ruleset not created" $?
grep -q 'WRITE.*actions/permissions/workflow.*default_workflow_permissions=write' "$l"; expect "y: token permissions PUT" $?
absent 'WRITE.*fork-pr-contributor-approval' "$l"; expect "n: approval not changed" $?
grep -q 'WRITE.*actions/workflows/10/disable' "$l"; expect "y: upstream workflow 10 disabled" $?
absent 'workflows/9/disable' "$l"; expect "ionos-* workflow left alone" $?
absent 'default_branch=' "$l"; expect "n: default branch not switched" $?
grep -qx 'WRITE secret set IONOS_SYNC_TOKEN --repo o/r' "$l"; expect "y: gh secret set is run, with no value on the command line" $?
absent 'WRITE.*can_approve' "$l"; expect "token permissions do not touch can_approve_pull_request_reviews" $?
grep -q 'WRITE.*rulesets.*"include":\["refs/heads/rc/\*"\].*non_fast_forward.*deletion' "$l"; expect "y: rc/* ruleset POST (no force push, no deletion)" $?
grep -q 'WRITE.*rulesets.*"target":"tag".*"include":\["refs/tags/ncw-v\*"\].*non_fast_forward.*deletion' "$l"; expect "y: ncw-v* tag ruleset POST" $?
[ "$(writes "$TMP/todo")" = 6 ]; expect "exactly 6 writes" $?
: > "$l"
printf 'n\nn\nn\nn\nn\nn\nn\nn\n' | run "$TMP/todo" --apply --live-line 33 >/dev/null
[ "$(writes "$TMP/todo")" = 0 ]; expect "n: the secret is not set" $?

# 7. EOF on stdin counts as no
: > "$TMP/todo/calls.log"; run "$TMP/todo" --apply </dev/null >/dev/null
[ "$(writes "$TMP/todo")" = 0 ]; expect "EOF answers no" $?

# 8. argument errors
run "$TMP/todo" --dry-run >/dev/null 2>&1; [ $? -eq 2 ]; expect "--dry-run alone is refused" $?
run "$TMP/todo" >/dev/null 2>&1; [ $? -eq 2 ]; expect "no mode is refused" $?
# shellcheck disable=SC2016  # the command substitution must stay literal
for bad in 'o' 'o/r;touch x' 'o/r x' '$(id)/r' 'o/r/s'; do
  FX="$TMP/todo" PATH="$TMP/bin:$PATH" bash "$WIZ" --check --repo "$bad" >/dev/null 2>&1; [ $? -eq 2 ]; expect "--repo '$bad' is refused" $?
done
for bad in 'master' 'ionos-dev-v33;x' 'ionos-dev-v' 'ionos-dev-v3 3'; do
  run "$TMP/todo" --check --dev-branch "$bad" >/dev/null 2>&1; [ $? -eq 2 ]; expect "--dev-branch '$bad' is refused" $?
done
run "$TMP/pass" --check --dev-branch ionos-dev-v33 >/dev/null 2>&1; rc=$?
[ $rc -le 1 ]; expect "--dev-branch ionos-dev-v33 is accepted" $?

echo; [ $FAILS -eq 0 ] && echo "all passed" || echo "$FAILS failed"
exit $FAILS
