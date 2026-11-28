# 5. Deployment contract

This spec does not implement a deployment. It states what a deployment (for example a Helm chart on Kubernetes with
an object store and a MariaDB database) must do with an artifact.

## Configuration layering

Nextcloud merges, in this order: `config.php` (if one exists), the flavor's numbered partials (`10-` to `89-`), then
the deployment's own generated partials, which must not start with a digit (for example `instance.config.php` and
`server.config.php`). The deployment's files win on shared keys. They are mounted into `config/` as individual files
so the flavor's partials stay in place. Flavors never set deployment keys (see [02](02-flavor-model.md)).

Nextcloud never builds `config.php` from partials. It reads `config.php` and the partials, and writes its own state
(`instanceid`, `passwordsalt`, `secret`, `installed`, `version`) into `config.php`. The deployment must supply or
persist that state, and must handle a version change without a manual edit. A new build number is such a version
change.

## Installing

First install is done from the command line: `occ maintenance:install` with values fed from the environment. There
is no browser installer and no `autoconfig.php`. Then run `bash ncw-configure.sh` from the artifact (see
[04](04-build-and-artifact.md)): it imports `app-config.json`, sets the special settings and enables the apps the
installer cannot (`enable_after_install`). The deployment contains no other `occ` logic for the flavor.

## Upgrading to a new artifact

One maintenance window.

1. Disable the apps listed in `removed-apps.json` on the old version (`occ app:disable`, idempotent). On 33 this is
   hygiene: an app removed from all three `shipped.json` lists is auto-disabled by `occ upgrade`, but the step
   avoids an error log entry and a re-download attempt. On 35 it is required until tested otherwise, because the
   upgrade check is skipped under channel `git` there and a dropped enabled app could stay enabled with no files.
2. Swap in the new artifact.
3. Run `occ upgrade`.
4. Run `bash ncw-configure.sh` (it imports `app-config.json` and enables the `enable_after_install` apps) and apply the instance settings (see [06](06-branding.md)).
5. Run the smoke checks (see [07](07-validation.md)) and leave maintenance mode.

`occ` is used only for install, upgrade, app config and instance settings, never for server configuration.

## Moving an existing instance onto a flavor

Run the cutover above, after a rehearsal on a staging deployment restored from a recent backup. The first release is
the same base release the instance already runs, so the flavor changes (apps, config, build number) and not the
Nextcloud version. An instance installed from the official archive has no `updater.release.channel` or `apps_paths`
set in the cases covered here; if either exists in its `config.php` it must be removed once, because
`updater.release.channel` overrides the channel in `version.php` and would turn the integrity check back on.

## Backups and rollback

Backups are an external precondition, made by other systems at other times. This design neither makes nor verifies
them, and it offers no rollback: Nextcloud refuses to run a code version lower than the installed one.

## Logs

The deployment chooses the log destination (for example syslog); CI and a local dev container read `nextcloud.log`.
It is not part of a flavor.
