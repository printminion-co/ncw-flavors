# 7. Validation

## Layers

1. **Static checks on the zip**, in CI on every build.
2. **Fresh-install smoke test**, in CI.
3. **Upgrade smoke test**, in CI.
4. **Staging rehearsal**, done by people on a deployment that mirrors production (database, object store), restored
   from a recent backup.

Nextcloud's own test suites are not run.

## Static checks

`ncw validate` runs these checks on a zip or an unpacked tree; the compatibility check also runs on its own as
`ncw check-compat`.

- `config/` holds exactly the flavor's partials plus upstream's sample files, nothing else.
- The app folders hold exactly the apps the flavor defines: none missing, none extra.
- Every app has an explicit mode (complete allowlist).
- No `updater/`, `config/CAN_INSTALL`, `.git` or dev files.
- `version.json` and `.buildnumber` are present, `version.json` names the flavor being validated, and config file
  numbers are unique.
- Every app is compatible with the server version (see [03-apps.md](03-apps.md)).

## Smoke tests

- **Upgrade from:** the vanilla official archive of the base release (this guards the migration path), and the
  flavor's previous release when one exists.
- **Install and configure:** the smoke test installs the archive with `occ maintenance:install`, then runs the
  archive's own `ncw-configure.sh`, as a deployment does. It has no configuration code of its own.
- **Probes:** `status.php`, the login page, OCS capabilities, DAV list, upload and download, the files page, admin
  settings and overview, `cron.php` and `files:scan`.
- **App states:** read with `occ app:list --output=json_pretty` and compared with the resolved flavor: `always` and
  `default` apps enabled, `removed` apps absent, `available` apps disabled, except the apps in `enable_after_install`,
  which must be enabled.
- **Logs:** the run fails on new `nextcloud.log` error entries that are not on a short allow-list, and always on a
  `Disabled incompatible app` line.
- **Brand check:** key pages (login, files, settings, admin overview, a sample email) must not contain the text
  "Nextcloud" outside an allow-list of the product name, the AGPL attribution and documentation URLs.
- **Databases:** SQLite by default; a MariaDB service container for the release-build upgrade smoke. The object
  store is covered only in the rehearsal.

## Gate

Any failure blocks publishing, for release builds and dev builds. The logs stay on the run.

## Other checks

- A weekly job compares clean and cached app builds (see [04](04-build-and-artifact.md)).
- Comparing an unpatched empty flavor with the official archive (file list and hashes, ignoring `version.php`,
  `.buildnumber`, `version.json`, `config/CAN_INSTALL`, `updater/` and the signature files) is low priority and not
  part of the first iteration.

## First-run checklist for each new line (34, 35)

Rerun the prototype scenarios (see [08](08-limits-and-open-items.md)); test with `appstoreenabled=true`; test
third-party Flow apps after dropping `workflowengine`; test removing the `appstore` app (it exists from 34 and is
always enabled); confirm whether the pre-disable step is required on 35; check that the theme template override and
the `ThemesService` registration patch still work; try the real deployment layout.
