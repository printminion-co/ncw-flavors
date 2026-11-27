# Fork settings checklist and wizard

Settings of the server fork (`printminion-co/mk-nc-server`) that only a person with admin rights can change, as
the design needs them (spec 01 "Commit convention in the fork" and "The pipeline in the fork", ADR 0007). The
script verifies each one and can apply the missing ones, one confirmed step at a time.

Needs `bash`, `gh` (logged in; admin on the fork to change settings) and `jq`.

```
tools/fork-settings/wizard.sh --check                  # read-only; exit 0 only when nothing is TODO
tools/fork-settings/wizard.sh --apply --dry-run        # print every command, run none
tools/fork-settings/wizard.sh --apply                  # for each TODO: what, the gh api command, y/n
tools/fork-settings/wizard.sh --check --live-line 33   # at cutover, see below
```

Other options: `--repo owner/name` (default `printminion-co/mk-nc-server`), `--dev-branch NAME` (branch whose
commits the signing check lists). `--repo` must look like `owner/name` and `--dev-branch` like `ionos-dev-v33`, anything else
is refused (exit 2). `--check` prints one state per setting with its evidence:

| State | Meaning |
|---|---|
| PASS | the setting is as designed |
| TODO | it differs; `--apply` can change it (the link to the settings page is printed too) |
| WAITING | must wait until cutover; not a failure |
| UNKNOWN | cannot be verified through the API (or the API refused); the output says why |

`tools/fork-settings/test.sh` runs the wizard against a stub `gh` (PASS, TODO, WAITING, UNKNOWN, the y/n flow,
dry run); it touches nothing on GitHub.

## The settings

1. **Default branch is the live line's dev branch `ionos-dev-v<nn>`. Waits for cutover.** Scheduled workflows run,
   and manual ones are listed, only from the default branch. Today nothing is live, so the default stays
   `master` and the check reports WAITING. At cutover run `--check --live-line <nn>`: it now reports TODO until
   the switch is done, and `--apply --live-line <nn>` switches it
   (`gh api -X PATCH repos/<repo> -f default_branch=ionos-dev-v<nn>`). Once the default is an `ionos-dev-v*`
   branch the check passes without the flag. Web UI: Settings > Branches.
2. **Signed commits required on `ionos-dev-v*` and `rc/*`.** One repository ruleset (`ncw-signed-commits`, REST
   `POST repos/<repo>/rulesets`, rule `required_signatures`). Verified from the active rulesets. Candidate
   branches are not covered on purpose: they are unsigned until a person re-signs the series. A classic branch
   protection rule would also work but is not recognised by the check.
3. **`master` and `stable*` stay pristine mirrors.** A second ruleset (`ncw-pristine-mirrors`): no force push
   (`non_fast_forward`) and no deletion. Only the sync automation pushes there, and it only fast-forwards. If
   upstream ever rewrites history, give the sync a bypass in that ruleset. Recommended by the design, not
   something it spells out as a rule.
4. **Workflow token.** `default_workflow_permissions=write`: the sync and snapshot workflows push branches,
   create issues and disable workflows (contents, issues, pull-requests, actions write); the commit-lint
   workflow declares its own minimal permissions, so the wide default does not apply to it. Verified and set
   through `actions/permissions/workflow`. An organization policy can cap it; then change the org setting first.
   `can_approve_pull_request_reviews` ("Allow GitHub Actions to create and approve pull requests") is reported as
   information only: it is not needed while the pin-proposal pull requests are opened with the sync token
   (item 8) instead of the default `GITHUB_TOKEN`.
5. **Fork pull request workflows need approval from all outside collaborators**
   (`approval_policy=all_external_contributors`, `actions/permissions/fork-pr-contributor-approval`).
6. **Every developer has a signing key on GitHub.** Not verifiable through the API for people, so the check is
   always UNKNOWN and lists the last 10 `IONOS(` commits of the dev branch with author and verification state.
   Each developer does once (link: https://github.com/settings/keys):
   ```
   gpg --list-secret-keys --keyid-format=long      # find the key id
   gpg --armor --export <KEYID>                    # paste as a new GPG key on GitHub
   git config --global user.signingkey <KEYID>
   git config --global commit.gpgsign true
   ```
   (SSH signing also works: `git config gpg.format ssh`, and add the key as a Signing key.) Then make a commit,
   push it and look for the green Verified badge, or rerun `--check` and see `verified=true` for your commits.
   Checklist, one line per developer: name, key uploaded, last commit shows Verified.
7. **Upstream's workflows stay disabled.** Every workflow whose file is not `.github/workflows/ionos-*.yml` must
   be `disabled_manually`. The check reads the Actions API; `--apply` disables the active ones
   (`gh api -X PUT repos/<repo>/actions/workflows/<id>/disable`). The upstream-tracking automation will keep them
   disabled later.
8. **Repository secret `IONOS_SYNC_TOKEN` exists. Owner-supplied.** The sync and snapshot workflows push
   branches that contain workflow files, which the default workflow token is not allowed to do (it lacks the
   `workflow` scope), and they open the pin-proposal pull requests with it. So they use a token you create and
   store as this secret. Checked with `gh api repos/<repo>/actions/secrets/IONOS_SYNC_TOKEN`: 200 is PASS (the
   secret exists; its scope and expiry cannot be verified by the API), 404 is TODO, anything else (403, ...) is
   UNKNOWN with the reason. `--apply` prints the steps and, after a y/n, runs
   `gh secret set IONOS_SYNC_TOKEN --repo <repo>`:
   1. Create a fine-grained personal access token at https://github.com/settings/personal-access-tokens/new,
      limited to the fork only, with the repository permissions Contents, Workflows, Pull requests, Issues and
      Actions, each read and write, and no more. Note its expiry date; the secret stops working then.
   2. `gh secret set` prompts you for the value. The wizard never reads, echoes, logs or stores it; with
      `--dry-run` it only prints the command.

9. **Snapshots are never rewritten.** Two more rulesets, because a ruleset has one target (branch or tag):
   `ncw-snapshot-branches` on `refs/heads/rc/*` and `ncw-snapshot-tags` on `refs/tags/ncw-v*`, each with
   `non_fast_forward` and `deletion`. Creating such a ref stays allowed (the snapshot workflow creates them); changing
   or deleting one is refused for everybody, so a release can always be rebuilt from its snapshot. The signed-commits
   rule (item 2) stays as it is. Rehearsal refs (`rehearsal/*` branches, `rehearsal-v*` tags) are not covered, so a
   person can delete them. A mistaken snapshot is superseded by a new release number; if one really must go, an
   admin disables the ruleset for the moment and enables it again. The check is PASS when both rulesets are active
   and have both rules; the apply step posts (or updates, when the name exists) both after one y/n.

Not covered: branch deletion of merged branches, merge-method settings and other repository options the design
does not mention.