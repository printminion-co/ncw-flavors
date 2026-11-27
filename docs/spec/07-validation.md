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
- **Probes:** `status.php`, the login page, OCS capabilities, DAV list, upload and download, the files page, admin
  settings and overview, `cron.php` and `files:scan`.
- **App states:** read with `occ app:list --output=json_pretty` and compared with the resolved flavor: `always` and
  `default` apps enabled, `removed` apps absent, `available` apps disabled.
- **Logs:** the run fails on new `nextcloud.log` error entries that are not on a short allow-list, and always on a
  `Disabled incompatible app` line.
- **Brand check:** key pages must not contain the text "Nextcloud", in any case, outside an allow-list. The pages are the login page
  and, with a session, the files page, the admin settings, the admin overview, the personal settings, the user theming section and
  the admin theming section, plus a sample system mail made by the real mail template (HTML and text). A page is its HTML with the
  settings it carries (the Base64 initial-state values) decoded. The allow-list has one entry per allowed phrase: a page, a strict
  regexp and a reason (the product name "IONOS Nextcloud Workspace", the AGPL attribution, documentation URLs, identifiers, and the known
  residuals of [06-branding.md](06-branding.md)); the shipped list comes from the real pages of a dev build, an entry that matches
  nothing is noticed, and the bare word is never an entry. It is not a check of the text the browser builds from JS.
- **Theme probes:** derived from the resolved flavor and the archive, so no per-flavor code: for an enforced theme, `enforce_theme` is set,
  the login page carries `data-theme-<id>`, the theme stylesheet answers 200 with its scope and tokens and the user theming section lists only
  that theme; when the archive disables user theming, the section says so; when the legacy `theme` setting is set, the admin theming section says
  the instance is not themeable; when `mail_template_class` is set, the sample mail is made by that class. The brand check and the probes run in
  every smoke test (fresh install and both upgrades) and a failure blocks publishing. The `brand` mode of the workflow input `smoke_break`
  adds a "Nextcloud" text to the login template of the archive so that the check can be seen to fail.
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
