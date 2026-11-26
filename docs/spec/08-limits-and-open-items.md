# 8. Limits and open items

## What was run, and what was only read

A throwaway prototype ran on Nextcloud 33.0.9 (official archive, SQLite, PHP 8.3). It showed that:

- a flavor tree swapped in over a vanilla install upgrades cleanly, and the 5th version segment triggers the
  upgrade;
- a symlinked `config.php` works for install and upgrade, and numbered partials merge in order;
- removing `firstrunwizard` and the always-enabled `workflowengine` (from all three lists and the tree) works:
  login, OCS capabilities, DAV, file upload and download, the files page, admin pages, cron and `files:scan` all
  worked afterwards;
- leaving a removed app in `shippedApps` aborts the upgrade (exit 5, maintenance mode stays on);
- a lower or missing build number is blocked as a downgrade;
- a fresh install of a flavor tree comes up with exactly the flavor's apps.

Everything else in this spec comes from reading Nextcloud's source (v33.0.9, stable34, stable35) and its
documentation, and is untested: stable34 and 35 were not run, a build from source was not exercised (the official
archive was the base), `appstoreenabled=true`, third-party apps and a real deployment layout were not tried, and the
claim that the `IManager` alias in core only matters to the workflow engine app comes from the source. The
ThemesService registration, the theme template override for the development notice and the `appstore` app removal
are not tested.

Facts used: Nextcloud server and its bundled apps are AGPL-3.0-or-later; the trademark policy is as cited in
[06-branding.md](06-branding.md); the stable line schedule is as of November 2026 and changes.

## Known exceptions to "no server code changes"

1. The generic `ThemesService` registration patch (ADR 0006).
2. Possibly a small patch to the development notice, if the theme template override does not work.
3. The `ionos-*.yml` workflow files, which are commits in the series and are kept up to date on each rebase.

## Open items for the owner

- Tag naming: the snapshot branch is `rc/ncw-v<nn>-<n>` and the annotated tag is `ncw-v<base release>-<n>`. Confirm
  that both names are wanted.
- Names in public places: branches `ionos-dev-v<nn>` and the submodule path `IONOS/` use the company name; the
  artifact, snapshot and repo names use `ncw`.
- The licensing facts were gathered from license texts and policy pages; the full AGPL text and FAQ could not be
  read, third-party and npm dependency licenses were not audited, and the policy says nothing about "based on
  Nextcloud" wording.

## Out of scope

Container images, deployment and hosting; implementing the pipeline or the flavors; contributing patches upstream;
Nextcloud update checks and the update server; a permanent internal build cache; per-market branding variants.
