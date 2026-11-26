# NC Flavors: design spec

Status: design only. Nothing described here is implemented yet. Several statements come from reading
Nextcloud's source code and from one throwaway prototype on 33.0.9; they are marked where they were not run.
See [08-limits-and-open-items.md](08-limits-and-open-items.md).

## What this is

NC Flavors builds customised, reproducible releases of Nextcloud server. Every build is one **flavor**: a named
variant with its own set of apps (added, removed, disabled, core apps included), its own app configuration, and
its own server configuration. Flavors can share common sets of apps and configuration. Apps can be vanilla or
forked and modified by us. Server code changes are kept to a minimum and are carried across stable lines.

The output of a release is, for every flavor, one archive in the style of the official Nextcloud release archive:
the server code, PHP dependencies and built JS/CSS, the flavor's apps and its configuration.

```
upstream nextcloud/server
  └─ fork: stable<nn> (pristine mirror)
       └─ ionos-dev-v<nn> = stable<nn> + our patch series
            │   ├─ .github/workflows/ionos-*.yml   the pipeline
            │   ├─ IONOS/        submodule: this flavors repo (flavors, bases, themes, tools)
            │   └─ apps-<set>/   submodules: forked and vanilla apps
            └─ rc/ncw-v<nn>-<n>  frozen snapshot of a release
                 └─ build ─► ncw-<flavor>-v<base release>.<build number>.zip   (one per flavor)
```

## Contents

1. [Repositories, branches and releases](01-repositories-and-branches.md)
2. [Flavor model](02-flavor-model.md)
3. [Apps: modes, sources and pins](03-apps.md)
4. [Build and artifact](04-build-and-artifact.md)
5. [Deployment contract](05-deployment.md)
6. [Branding](06-branding.md)
7. [Validation](07-validation.md)
8. [Limits and open items](08-limits-and-open-items.md)

Vocabulary is defined in [../../GLOSSARY.md](../../GLOSSARY.md). Decisions that are hard to reverse and surprising
are recorded in [../adr/](../adr/).

## Non-goals

Container images and hosting, implementing the pipeline or the flavors (this spec is the starting point for that),
contributing patches upstream, Nextcloud update checks, a permanent internal build cache, per-market branding.
