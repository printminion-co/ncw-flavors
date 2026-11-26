# ncw-flavors

Customised, reproducible builds ("flavors") of Nextcloud server: each flavor has its own set of apps, app
configuration and server configuration, built from an upstream release plus a small patch series.

This repository starts with the design:

- [docs/spec/](docs/spec/README.md): the design spec (repositories and branches, flavor model, apps, build and
  artifact, deployment contract, branding, validation, limits and open items)
- [docs/adr/](docs/adr/): decisions that are hard to reverse and surprising
- [GLOSSARY.md](GLOSSARY.md): vocabulary

Status: design only, nothing is implemented yet. Flavors, bases, themes and build tooling will live on per-line
branches (`v33`, `v34`, ...) of this repository, next to this `main`.

No license has been chosen yet.
