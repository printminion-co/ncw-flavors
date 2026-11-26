# 1. Repositories, branches and releases

## Repositories

| Repository | Visibility | Holds |
|---|---|---|
| `printminion-co/mk-nc-server` (the server fork) | public | Upstream server code, our patch series, the pipeline workflows (`ionos-*.yml`), app folders and the flavors repo as submodules, snapshots, tags and GitHub Releases |
| `printminion-co/ncw-flavors` (the flavors repo) | public | `main`: spec, ADRs, glossary. `v<nn>` branches: flavors, bases, themes, build tooling |
| one repo per forked app | public | Our changes to a vanilla app |

Everything the build fetches must be public. Private app sources are out of scope.

## Stable lines

A **stable line** is an upstream `stable<nn>` branch and the releases cut from it. Work starts on line 33 with
base release v33.0.9. Lines 34 and 35 follow as upgrades, not as parallel lines: when live moves to a newer line,
the older line is frozen and nobody backports to it. Target the current stable line and the one before it
(as of November 2026: 35 and 34; 33 is supported upstream until February 2027). Upstream cuts the stable branch at
RC 1, tags beta then rc then final, and ships point releases monthly.

## Branches in the server fork

| Branch | Content | Rewritten? |
|---|---|---|
| `master` | Pristine mirror of upstream's default branch | no |
| `stable<nn>` | Pristine mirror of upstream, fast-forward only, synced by automation | no |
| `ionos-dev-v<nn>` | `stable<nn>` plus our patch series; for 33 it starts at upstream tag `v33.0.9` | only by a developer promoting a candidate |
| `candidate/ionos-dev-v<nn>/<upstream tag>` | The series rebased onto a new upstream release, created by automation, unsigned | disposable |
| `rc/ncw-v<nn>-<release_nr>` | Frozen snapshot of a released state; builds come from it | never |

One shared patched branch exists per stable line. Flavors never get their own server branch; they differ only in
apps, configuration and themes (ADR 0005). The fork's default branch is the live line's `ionos-dev-v<nn>` and is
switched at cutover; see "The pipeline in the fork" below.

## Rebase and promotion

Automation never rewrites `ionos-dev-v<nn>`. On a new upstream release tag, a scheduled job tries to rebase the
series onto it and pushes a candidate branch. If the rebase conflicts it creates no branch and opens an issue.

A developer promotes a candidate in three steps:

1. Push a `pre-rebase/ionos-dev-v<nn>/<upstream tag>` tag on the current state of `ionos-dev-v<nn>`.
2. Re-sign every commit of the candidate's series, for example
   `git rebase --force-rebase --gpg-sign <upstream tag>` on the candidate. Rebasing drops signatures, and the
   automation holds no signing key.
3. Reset `ionos-dev-v<nn>` to the candidate with `--force-with-lease`. Branch protection requires signed commits
   there, so an unsigned candidate cannot be promoted.

Pre-rebase tags are pruned only on demand. A scheduled job also proposes pull requests that bump the pins of the
upstream-bundled apps from upstream's app list (see [03-apps.md](03-apps.md)).

## Authoring patches

New patches land on the live line through pull requests with rebase-merge: linear history, no merge commits,
one self-contained commit per change, following the commit convention below. The next line's candidate is
regenerated from the live line's series. Authoring switches to the new line at cutover. Server code is not changed
unless Nextcloud offers no other way (see ADR 0006); the known exceptions are listed in
[08-limits-and-open-items.md](08-limits-and-open-items.md).

## Commit convention in the fork

Every commit by our developers in the server fork uses `IONOS` as its type, a scope in parentheses and an
imperative subject, for example `IONOS(ci): optimize build workflow` or
`IONOS(branding): register themes listed in ncw.themes`. Commits are signed (`git commit -S`).

The prefix makes our commits easy to find and to cherry-pick onto a new rebase or a new stable line, and it
separates them from upstream commits:

```
git log --oneline --grep='^IONOS(' stable<nn>..ionos-dev-v<nn>
```

Enforcement:

- Branch protection requires signed commits on `ionos-dev-v<nn>` and on `rc/*` branches.
- A pull-request workflow, `ionos-commit-lint.yml`, fails when a commit message does not match `IONOS(<scope>): `.

## Releases

A **release number** is chosen by a person in sprint planning, restarts at 1 for each line, and names the unit that
goes live with an agreed scope of features (`ncw-v33-5`, then `ncw-v34-1` after the move to line 34). A manual
workflow takes the release number, the source branch and a `scope` text. It creates `rc/ncw-v<nn>-<release_nr>`
and an annotated tag `ncw-v<base release>-<release_nr>` in the fork, and rejects a reused release number. The scope
is stored in the tag annotation, the GitHub release notes and `version.json`. GitHub Releases live in the fork.
Tagging the flavors repo with the same name is optional, since the submodule pin already freezes it.

The first release is `ncw-v33-1` on base v33.0.9. The Nextcloud version itself does not change in that step.

## Submodules

The fork carries the flavors repo as a submodule at `IONOS/` (the path is case-sensitive), tracking the `v<nn>`
branch of that line. A snapshot therefore freezes the server, the pipeline, all app pins and all flavor
definitions by commit (ADR 0001, ADR 0002). App folders `apps-<set>/` sit at the fork root, next to `IONOS/`.

## The pipeline in the fork

The pipeline workflows live in the server fork as `.github/workflows/ionos-*.yml` and are kept as `IONOS(ci)`
commits in the patch series (ADR 0007). They cover the `stable<nn>` mirror sync, candidate creation, the app pin
proposals, the manual snapshot workflow, the nightly dev build, the release build and commit linting.

- **Own prefix:** every workflow file we add starts with `ionos-`, so none collides with upstream's.
- **Default branch:** scheduled workflows run, and manual workflows are listed, only from the default branch. The
  fork's default branch is therefore the live line's `ionos-dev-v<nn>` and is switched at cutover, while `master`
  stays a pristine mirror.
- **Upstream's workflows:** the files are left untouched, because deleting them would conflict on every rebase.
  The scheduled sync job disables, through the Actions API, every workflow whose file name does not start with
  `ionos-`, so workflows that upstream adds later are switched off too.
- **Tokens:** the default `GITHUB_TOKEN` pushes the mirrors, the candidates and the snapshot branches; no
  cross-repo token is needed. Pushes made with that token do not trigger other workflows, so the snapshot workflow
  starts the build explicitly.
- **Tooling:** the workflows check the fork out with submodules and run the build logic from `IONOS/tools`, in the
  version pinned by the checked-out snapshot, so an old snapshot rebuilds with its own tooling and its own
  workflows.

## The flavors repo

`main` holds `GLOSSARY.md`, `docs/spec/` and `docs/adr/`. Each `v<nn>` branch holds `flavors/`, `bases/`,
`themes/` and `tools/` for that line; the next line's branch starts from the live line's. Tooling changes needed
on two active lines are applied to both.
