# ncw-flavors, line 33

Flavors, bases, themes and build tooling for stable line 33 of Nextcloud. The design lives on the `main`
branch of this repository (`docs/spec/`).

```
flavors/<name>/   flavor.yaml, config/NN-<name>.config.php
bases/<name>/     same structure, reused by flavors through `extends`
themes/           theme packages (none yet)
tools/            the build tooling (TypeScript on Node 24)
```

## Build an artifact

```
cd tools && npm ci
node src/cli.ts build --flavors .. --flavor flavor1 --tree <built server tree> \
  --line 33 --kind dev --build-number 812 --out <dir>
```

Prints the path of `ncw-<flavor>-v<base release>.<build number>.zip` to stdout, and the resolved flavor (see
below) to stderr for the build log. The artifact holds the server tree with the
flavor applied: shipped-apps lists generated from the app modes, removed apps pruned, only the active app folders,
the flavor's partial configs, the build number file, and a version file that reports channel `git` and the build
number as a fifth version element. The install flag file and the web updater are left out. The same inputs give
byte-identical artifacts.

Numbers 00 to 09 of the partial config names are reserved for files the tool generates (`00-apps-paths`);
bases use 10 to 49 and flavors 50 to 89.

## See what a flavor resolves to

```
node src/cli.ts resolve --flavors .. --flavor flavor1
```

Prints the fully resolved flavor as YAML for review: the manifests in the order they were applied, the apps with
their modes, the app folders, the themes, the config files with the manifest each one comes from, and the
environment variables.

A flavor's bases are applied depth first in the listed order, then the flavor itself, and the last declaration wins
per app, per config file name and per environment variable. Themes and app folders are an ordered union. A base
reached through more than one path is applied once, where it is first reached. A cycle in `extends` is rejected
and the message names it.

## Check app version compatibility

```
node src/cli.ts check-compat --flavors .. --flavor flavor1 --tree <server checkout>
```

Every app that stays in the artifact (in `apps/` and the active app folders) must accept the server version of the
tree: the `min-version` and `max-version` of `<nextcloud>` in its `appinfo/info.xml` are compared only as far as
they are written, so `max-version="33"` accepts 33.0.9. A missing or malformed bound is an error; removed apps are
skipped. A failure exits with 2 and prints, to stderr, a GitHub Actions `::error file=...,title=App version
compatibility::` annotation and a readable line per app naming the app, both bounds and the server version.
`build` runs the same check on the source tree before assembling and on the assembled tree afterwards, for dev and
release builds alike.

## Develop

```
npm run typecheck
npm test
```

The tests run the command line against a small stand-in for a built server tree and their own fixture flavors;
one more test builds the example flavor committed in this branch. That command line is the one test seam. Tests that evaluate PHP are skipped when `php` is not installed.

## App modes and classification

Every app in the tree or in an active app folder needs a mode. An app without one is a warning on stderr in a `dev`
build and a failure in a `release` build. The same app id in two active app folders, or in one and the server tree
(`apps/<id>`), fails and names both locations (Nextcloud would load only one of them). Before the lists are written
the build checks that no removed app is left in any of them.

## Build metadata

Every artifact holds `version.json`, written by the build from inputs the pipeline supplies (the tool does not run
git itself). Pretty JSON, two-space indent, sorted keys, final newline; only these fields exist:
`flavor`, `base_release`, `kind` (`dev` or `release`), `snapshot_branch`, `release_number`, `scope`,
`server_commit`, `flavors_commit`, `apps` (app id to `commit` and `describe`) and `cached_builds` (app id to
`key` and `checksum`). The build number is not part of it (it is in `.buildnumber`).

| Option | Meaning |
| --- | --- |
| `--snapshot-branch <name>`, `--release-number <n>`, `--scope <text>` | Required for kind `release`; optional for `dev`. A field whose option is not given is left out of the file. The release number is a positive integer, the scope is not empty. |
| `--server-commit <sha>`, `--flavors-commit <sha>` | Optional hex commit shas (7 to 64 digits); left out when not given. |
| `--app-pins <file.json>` | JSON object `{"<app id>": {"commit": "<sha>", "describe": "<git describe>"}}`. Both fields required, no others. |
| `--cache-keys <file.json>` | JSON object `{"<app id>": {"key": "<cache key>", "checksum": "<checksum>"}}`. Both fields required, no others. |

`apps` and `cached_builds` are `{}` when their option is not given. Bad input is rejected before anything is
written. A negative build number must be written `--build-number=-5` (the form `--build-number -5` is refused by the argument parser, also with exit 2).
Processing a tree whose version file already has the build number snippet does not append it a second time.
