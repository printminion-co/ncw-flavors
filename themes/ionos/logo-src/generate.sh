#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 NC Flavors contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Makes the DUMMY logo files of the theme from the three SVG sources next to this script. Needs ImageMagick 6
# (`convert`, with its built-in SVG renderer). Run it from anywhere; the output is deterministic (no metadata).
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
img=$here/../assets/core/img
mkdir -p "$img/logo"
flags=(-background none -strip +set date:create +set date:modify +set date:timestamp -define png:exclude-chunk=all)

cp "$here/logo.svg" "$img/logo/logo.svg"
cp "$here/mask.svg" "$img/favicon-mask.svg"
# logo.png: 252x120 like the server's original, the 2:1 mark centered
convert -density 384 "${flags[@]}" "$here/logo.svg" -resize 240x120 -gravity center -extent 252x120 -depth 8 "png:$img/logo/logo.png"
# the icon tile: touch icon 180x180 and the 200x200 preview of public shares
convert -density 384 "${flags[@]}" "$here/icon.svg" -resize 180x180 -colors 16 -define png:color-type=3 "png:$img/favicon-touch.png"
convert -density 384 "${flags[@]}" "$here/icon.svg" -resize 200x200 -colors 16 -define png:color-type=3 "png:$img/favicon-fb.png"
# favicon.ico: one 32x32 image like the server's original
convert -density 768 "${flags[@]}" "$here/icon.svg" -resize 32x32 "ico:$img/favicon.ico"
