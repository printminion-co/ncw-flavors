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

Prints the path of `ncw-<flavor>-v<base release>.<build number>.zip`. The artifact holds the server tree with the
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

## Develop

```
npm run typecheck
npm test
```

The tests run the command line against a small stand-in for a built server tree and their own fixture flavors;
one more test builds the example flavor committed in this branch. That command line is the one test seam. Tests that evaluate PHP are skipped when `php` is not installed.
