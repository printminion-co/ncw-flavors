# NC Flavors

Customised, reproducible builds of Nextcloud server. Each build differs in its apps and configuration, and all are derived from one upstream release line.

## Language

**Flavor**:
A named variant of Nextcloud defined by its app set (added, removed, disabled, core included), its app configuration and its server configuration.
_Avoid_: Edition, distribution, variant

**Base release**:
The upstream Nextcloud release (for example v35.0.3) a build is derived from.
_Avoid_: Upstream version, parent version

**Stable line**:
An upstream `stable<nn>` branch and the releases cut from it.
_Avoid_: Major version, branch

**Patch series**:
Our ordered set of changes to the server code, kept on top of a stable line.
_Avoid_: Fork changes, customizations

**Dev branch**:
`ionos-dev-v<nn>`, the stable line plus our patch series. It is the working state for that line.
_Avoid_: Fork branch

**Snapshot branch**:
`rc/ncw-v<nn>-<release_nr>`, a frozen copy of a released state that artifacts are built from. It is never rewritten.
_Avoid_: Release branch, tag

**Release number**:
The sprint-planned counter that names a snapshot branch within a stable line, starting at 1 for each line. A release number is the unit that goes live and has an agreed scope of features.
_Avoid_: Version

**Candidate branch**:
An automatically created branch holding the patch series rebased onto a new upstream release. A developer promotes it to become the dev branch.
_Avoid_: Auto-rebase branch

**Build number**:
The CI pipeline run counter appended to an artifact name. One snapshot can be built many times.
_Avoid_: Revision, release number

**Artifact**:
The ready-to-unpack server archive for one flavor, comparable to the official Nextcloud release archive: server code, PHP dependencies, built JS/CSS, the flavor's apps and its config. Named `ncw-<flavor>-v<base release>.<build number>`.
_Avoid_: Package, image, release

**App folder**:
A directory in the server fork that holds the apps of one app set as git submodules and is activated by a flavor.
_Avoid_: Apps dir, extra apps

**Branding**:
The enforced visual identity applied on top of stock Nextcloud so users see the IONOS product, not upstream. It has three tiers: tokens (colors, typography, sizes, light and dark), overrides (per-app styling) and instance settings (primary color, background, legal links, homepage URL, locking of user and admin theming).
_Avoid_: Skin, white-label

**Market**:
A regional variant of the branding (logo, favicon and legal links differ per market).
_Avoid_: Region, locale

**Shared base**:
A reusable set of apps or configuration that several flavors include.
_Avoid_: Common layer, template

**Partial config**:
A small config file holding part of a flavor's server configuration, combined with others and able to read environment variables. Never produced by `occ`.
_Avoid_: Config fragment, overlay
