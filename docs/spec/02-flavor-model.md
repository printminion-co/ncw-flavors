# 2. Flavor model

## Layout (on a `v<nn>` branch of the flavors repo)

```
flavors/<name>/   flavor.yaml, config/NN-<name>.config.php, app-config.json
bases/<name>/     same structure, reusable by flavors and other bases
themes/<name>/    theme class, CSS, images, fonts, translation and template overrides
tools/            resolve, validate, build, assemble
```

Flavor names are lowercase letters, digits and single hyphens, starting with a letter (they appear in file names).
Config and app-config files keep their native formats, PHP and JSON.

## Manifest

```yaml
extends: [common, no-collab]      # ordered; later entries win
app_dirs: [apps-upstream, apps-common, apps-flavor1]
themes: [ionos]
apps:
  files:          always          # forced on, an admin cannot disable it
  calendar:       default         # enabled at install, an admin may disable it
  talk:           available       # on disk, off until an admin enables it
  firstrunwizard: removed         # pruned from the artifact wherever it lives
env:
  - { name: SMTP_PASSWORD, required: true }
  - { name: PHONE_REGION,  required: false, default: DE }
```

The manifest has no version field and no per-line block. Each stable line has its own branch of the flavors repo.

## Composition

`extends` is an ordered list. Bases may extend bases; cycles are rejected. Resolution is depth first and the last
entry wins, per app id and per config file name. The build prints the fully resolved flavor for review.

## The app list is a complete allowlist

Every app that exists in the server tree or in an active app folder must have an explicit mode in the resolved
flavor. An app without one is an error in release builds and a warning in dev builds and in the candidate stage
(see [03-apps.md](03-apps.md)).

## Server configuration

The artifact is self-contained: the flavor's partial configs are real files in its `config/`. Nextcloud reads
`config.php` if one exists, then every `*.config.php` in that directory in natural sort order, later wins. The
numeric prefix makes the order visible: bases use 10–49, flavors 50–89. The build rejects two files with the same
number in one resolved flavor. Deployment-generated partial files must not start with a digit, so they sort after
the flavor's files and win on shared keys.

Flavors must not set deployment keys (database, object store, trusted domains, `instanceid`, `passwordsalt`,
`secret`, mail transport, `datadirectory`) or keys Nextcloud writes itself (`version`, `installed`).

Server configuration is never written with `occ`.

## Environment variables

Partials are PHP and may call `getenv()`. The manifest declares every variable a flavor uses, with a required flag
and an optional default. The build checks that every variable referenced in a partial or template is declared; the
deployment validates the environment before it starts an upgrade. Secrets never appear in the repository.

## App configuration

Settings stored in the database have no file or environment mapping in Nextcloud. Each flavor ships an `apps`-only
`app-config.json` template, assembled from bases and overrides. The deployment fills `${ENV_VAR}` placeholders and
imports it with `occ config:import` after install and after every upgrade. Keys it lists are flavor-managed and are
overwritten on every deploy; unlisted keys stay under admin control. Sensitive, lazy and typed values cannot be set
by the import and are set with `occ config:app:set --sensitive/--lazy/--type`, with secrets only from the
environment. The import's `system` section is never used.

## Themes

A flavor lists zero or more themes. See [06-branding.md](06-branding.md).
