# 4. Build and artifact

## Artifact

`ncw-<flavor>-v<base release>.<build number>.zip`, for example `ncw-flavor1-v33.0.9.812.zip`. It is built from
source: the official archive is only a reference. `.tar.bz2` is an optional second output. One run builds every
flavor of a release and they share one build number. A future container image would copy the unpacked tree, which
already contains the build files below.

Contents: the patched server tree, the flavor's apps with PHP dependencies and built JS/CSS, `core/shipped.json`
generated for the flavor, the flavor's partial configs in `config/`, `app-config.json`, `app-config-special.json`
(the sensitive, lazy and typed settings that the import cannot set), `removed-apps.json` (the vanilla apps the flavor
drops that are in the server tree's shipped list; a dropped added or forked app is not listed), `version.json` and
`.buildnumber`. Not in it: `updater/` (the official archive adds it from a separate repo; the
server repo has none), `config/CAN_INSTALL` (the official archive ships it; the build deletes it), `.git`, dev files.

## Build number and version

The build number is the pipeline run number: one global counter shared by all flavors and by dev and release builds.
It is written to `.buildnumber`. A small snippet at the end of `version.php` reads that file and, if it holds an
integer above 0, appends it as a 5th element of `$OC_Version`:

```php
$buildNumberFile = __DIR__ . '/.buildnumber';
if (file_exists($buildNumberFile)) {
	$buildNumberContent = @file_get_contents($buildNumberFile);
	if ($buildNumberContent !== false) {
		$buildId = (int)trim($buildNumberContent);
		if ($buildId > 0) {
			// Append build ID as 5th element in version array
			$OC_Version[] = $buildId;
		}
	}
}
```

`status.php` then shows for example `33.0.9.1.812`. Nextcloud compares all segments, so every new build number is a
core upgrade (maintenance page, `occ upgrade`, repairs, migrations). The number must be strictly increasing and
always present: if it is missing or lower than the installed one, Nextcloud treats it as a downgrade and refuses to
start (the web UI errors, `occ` aborts, `status.php` returns an empty body). Upstream's own 4th segment stays
untouched (ADR 0003). Nextcloud's update checks do not apply to this version and are not used.

The build also rewrites `version.php` so that `$OC_Channel = 'git'`.

## `version.json`

Written by the build: flavor, base release, build kind (`dev` or `release`), snapshot branch, release number, build
number, scope text, the commits of the server fork and the flavors repo, each app's submodule commit and
`git describe`, and each cached app build's key and checksum.

## Integrity and updater

Any patch fails Nextcloud's signed integrity check, which only shows an admin warning, and a trusted signature
cannot be obtained. Channel `git` (taken from `version.php`) turns the check off; `integrity:check-core` then
refuses to run, as intended. Signing with our own CA is a possible later hardening, not part of this design. The web
updater is off (`upgrade.disable-web => true` in the shared base) and so is the app store
(`appstoreenabled => false`). Upgrades are done by swapping the tree and running `occ upgrade` (ADR 0004).

## Pipeline

The workflows live in the server fork as `ionos-*.yml` files (see [01](01-repositories-and-branches.md)) and run on
GitHub Actions. The build logic comes from `IONOS/tools`, in the version pinned by the checked-out snapshot.

| Build kind | Source | Trigger | Published as |
|---|---|---|---|
| dev | tip of `ionos-dev-v<nn>` | manual or nightly | GitHub pre-release |
| release | `rc/ncw-v<nn>-<n>` | when the snapshot workflow finishes | GitHub release |

The build needs `php` on its path: it evaluates the flavors' partial configs to read their keys and reject forbidden ones.

Per run:

1. Resolve and validate every flavor: cycles, duplicate app ids, undeclared env vars, duplicate config numbers,
   app compatibility, unclassified apps.
2. Build the server once, and every needed out-of-tree app once, always from source.
3. For each flavor, in a matrix job: copy the built tree, add the built apps of its active app folders, prune
   `removed` apps, strip dev files.
4. Generate `core/shipped.json` and the `apps_paths` partial config, copy the flavor's partials, delete
   `config/CAN_INSTALL`.
5. Write `app-config.json`, `app-config-special.json`, `removed-apps.json`, `version.json` and `.buildnumber`.
6. Run the validation layers (see [07-validation.md](07-validation.md)); a failure blocks publishing.
7. Zip it, add a checksum and a build-provenance attestation, and attach it to the GitHub release of the snapshot
   tag in the fork. Rebuilds of the same snapshot attach new assets with new build numbers.

## Cache

Built apps are cached in the GitHub Actions cache, keyed by the app's commit, the recipe, and the Node and PHP
versions; the server build is not cached, composer and npm downloads are. The key and the checksum of each cached
build go into `version.json`. A weekly job rebuilds every pinned app without the cache and compares it with the
cached build, opening an issue on a mismatch. The workflow takes a `no-cache` input for a fully clean rebuild. A
permanent cache comes later; the key is kept portable so moving it changes no artifact.
