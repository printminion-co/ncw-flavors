# 3. Apps: modes, sources and pins

## Modes

| Mode | Meaning | `core/shipped.json` |
|---|---|---|
| `always` | Enabled for everyone; an admin cannot disable it | `alwaysEnabled` |
| `default` | Enabled at install; an admin may disable it | `defaultEnabled` |
| `available` | On disk, not enabled; an admin may enable it | in none of the three lists |
| `removed` | Pruned from the artifact | removed from all three lists, including `shippedApps` |

The build generates `core/shipped.json` from the flavor's app list; it is not a patch. Vanilla apps the flavor keeps
stay in `shippedApps`. Added apps (vanilla or forked) are never put in `shippedApps`: Nextcloud reads the three
lists independently, so an added app can be always-enabled without being shipped, and a missing added app is
auto-disabled on upgrade instead of aborting it.

An app that the installer cannot enable is `available` and listed in `enable_after_install` (see
[02-flavor-model.md](02-flavor-model.md)): `ncw-configure.sh` enables it with `occ app:enable` right after the install.
Example: `groupfolders` in flavor1. `occ maintenance:install` installs every `default` app before any app is loaded,
and groupfolders' migrations need services the app registers when it is loaded, so the install fails if it is `default`;
`occ app:enable` on an installed instance works.

`default` and `available` decide the state of fresh installs only. On an existing instance an installed app keeps
its state; only `always` (forced on) and `removed` change it.

Always-enabled core apps may be removed in one release (for example `workflowengine`). A removed app must leave all
three lists and the tree: leaving it in `shippedApps` while deleting its files makes `occ upgrade` fail.

## Sources

Apps come from git only; the app store is never used. Apps inside the server tree come with the server. Every other
app is a git submodule inside an **app folder** of the server fork (`apps-<set>/`), and the submodule commit is the
pin. `apps-upstream/` holds upstream's separately hosted bundled apps; a helper proposes new pins from upstream's
app list on each base release and a developer reviews them. A pin has one commit per branch, so two flavors that
need different versions of the same source use two differently named submodules.

## Forks

Each fork is its own public repo and follows its upstream's branches. Our work sits on `ncw/<upstream ref>`
branches. Releases of a fork are immutable tags `v<upstream version>-ncw.<n>` and the submodule points at the tag's
commit.

## Activation

The flavor manifest lists the app folders it activates. The build generates a partial config that sets `apps_paths`
to the in-tree `apps` plus those folders, with `writable` off, and ships only the active folders. The build fails
when an app id appears in more than one active folder, or in an active folder and the server's `apps/`, and names
both locations. Reason: with duplicates Nextcloud loads the copy with the highest `info.xml` version and only on a
tie the first folder in `apps_paths`, so a fork with the same version as vanilla would load by folder order.

## Building apps

Every app that is built from git is always built from source, whether or not it ships built files. The default
recipe is `composer install --no-dev -a` when there is a `composer.json`, then `npm ci && npm run build` when
`package.json` has a `build` script. A manifest entry can override it with `build:` commands. Dev files
(`node_modules`, tests, `.git`) are stripped.

## Compatibility

For every app that stays in the artifact, `appinfo/info.xml` `min-version` and `max-version` must accept the server
version being built, using Nextcloud's rule: a bound is compared only as far as it is written, so
`max-version="33"` accepts 33.0.9. A missing bound is an error. The check runs right after checkout and again on
the assembled tree, fails every build, and names the app, its bounds and the server version.

## New upstream apps

A new base release can add apps (for example 34 adds `appstore`, `files_lock` and `office`, and 35 adds
`sharing`, which is always enabled). The candidate stage lists unclassified apps in an issue; dev builds warn;
release builds fail until every app has a mode.
