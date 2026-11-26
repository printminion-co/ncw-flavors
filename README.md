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

## License

Copyright (C) the ncw-flavors contributors.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General
Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option)
any later version. See [LICENSE](LICENSE). SPDX-License-Identifier: AGPL-3.0-or-later

The IONOS marks and the Nextcloud marks remain trademarks of their owners; this license grants no rights to them.
