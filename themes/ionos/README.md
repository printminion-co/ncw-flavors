# Theme package: ionos

The IONOS theme for NC Flavors: design tokens, per-app CSS, the Open Sans font and the mail template. It is
enforced by the base `common`. Every brand value is a PLACEHOLDER until the IONOS design values are dropped in.

## Where the brand values are

One place: the constants at the top of `lib/IonosTheme.php` (palette light and dark, status colors, font, header
height, click-target sizes). The CSS files and the mail template only use the CSS variables or those constants.
The primary color has a second copy, the `primary_color` instance setting in `bases/common/app-config.json`; a
test keeps the two equal.

## Layout

| Path | Becomes in the artifact | What |
|---|---|---|
| `lib/*.php` | `lib/private/Ncw/Themes/` | theme classes (namespace `OC\Ncw\Themes`); registered in `ncw.themes` |
| `mail/*.php` | `lib/private/Ncw/Mail/` | mail template classes (namespace `OC\Ncw\Mail`); activated by `mail_template_class` |
| `assets/**` | `themes/ionos/**` | the legacy theme folder (config `theme` => `ionos`) |

The theme classes are not in the theming app on purpose: its autoloader is a classmap, so a class added to
`apps/theming/lib` is never found. The `OC\` namespace is loaded by PSR-4 from `lib/private`.

Asset folders:

- `assets/css/*.css`: per-app overrides, appended to the theme's stylesheet by `IonosTheme::getCustomCss()`. The
  server nests them in `[data-theme-ionos]` (the body): write `&` for the body, use only CSS variables, and do not
  write a double slash (the server cuts the CSS at it). One file per app is the pattern (`ionos-login.css`,
  `ionos-files.css`, `ionos-public.css`).
- `assets/fonts/`: Open Sans (variable font) with its license, see below.
- `assets/core/l10n/<lang>.json`: translation overrides, loaded by the server on top of `core/l10n/<lang>.json`.
- `assets/core/templates/`: template overrides, loaded instead of the server's `core/templates/`.

## Logo and favicon (DUMMY set included)

The theme ships its own logo set, so no Nextcloud logo is shown. The files are DUMMIES: a generic ring-and-diamond
mark and a plain bar as the wordmark stand-in, in a neutral gray-blue that matches the placeholder palette. They
contain no text, no trademark and no brand mark. The logo lives in this theme, not in a flavor: the base `common`
enforces the theme `ionos` for every flavor (flavor1 included), so every flavor ships these files.

The server looks an image up in `themes/<theme>/core/img/<file>` before its own `core/img/<file>`
(`URLGenerator::imagePath`). On 33 the default logo is `core/img/logo/logo.svg` (not `core/img/logo.svg`). Files, all
below `assets/core/img/` (so `themes/ionos/core/img/` in the artifact):

| File | Size | Where a user sees it |
|---|---|---|
| `logo/logo.svg` | 256x128 | the login page and the header (through the CSS variables, see below), `getLogo()`: capabilities (clients), federated sharing settings |
| `logo/logo.png` | 252x120 | the logo of every email (`getLogo(false)`) |
| `favicon.ico` | 32x32 | the browser tab icon (`<link rel="icon">`) |
| `favicon-touch.png` | 180x180 | `apple-touch-icon`, the `og:image` of the login page |
| `favicon-fb.png` | 200x200 | the `og:image` preview of a public share |
| `favicon-mask.svg` | 16x16 | `mask-icon` (Safari pinned tab), one color |
| `manifest.json` | - | the web app manifest (`<link rel="manifest">`): name and the two icons above |

When a theme has a PNG but no SVG of a name, the server uses the PNG; both are shipped. Not shipped on purpose:
`logo/logo-mail.png`, `logo/logo-icon-175px.png` and `logo/logo-enterprise.*` are not used by any code on 33;
`favicon.png`, `favicon.svg` and `favicon-touch.svg` are only read by the theming app from `core/img/` directly
(fallbacks of the routes `/apps/theming/favicon` and `/apps/theming/icon`).

Two places need more than the file, checked on the 33 code and in a real install:

- **The logo of the login page and the header is CSS.** The server's CSS says `background-image: var(--image-logo,
  url(../../core/img/logo/logo.svg))`, and on 33 the theming app defines `--image-logo` and `--image-logoheader` only for a
  logo an admin uploaded. Without it the browser loads the fixed `/core/img/logo/logo.svg`, which the theme folder cannot
  replace. So `IonosTheme::getCSSVariables()` defines both variables as the theme folder's `logo/logo.svg` (looked up
  through `imagePath`, so the web root is right) unless an admin logo exists. The theme must not drop that.
- **`manifest.json` is a static copy.** Without it the server serves its own `core/img/manifest.json` on the login page
  (name "Nextcloud", the Nextcloud touch icon) and the route `/apps/theming/manifest/<app>` on the other pages, whose icons
  come from the admin upload, from `core/img/logo/logo.svg` of the server tree (hardcoded in `Util::getAppIcon`) or from
  the server's `favicon-touch.png`: none of them reads the theme folder. A `core/img/manifest.json` in the theme wins for
  every page, and its relative `src` and `start_url` point to the theme's icons and to the site root. The product name in
  it is a second copy of `productName` in `bases/common/app-config.json` (a test keeps them equal); the per-app names of
  the route are gone.

### Replacing the dummies

Keep the file names and sizes above and drop the real files in `assets/core/img/`. To regenerate the dummies instead
(for example after changing the shapes or the colors), edit the SVG sources in `logo-src/` (`logo.svg`, `icon.svg`,
`mask.svg`; they are not part of the artifact) and run `logo-src/generate.sh`: it needs ImageMagick 6 (`convert`)
and writes all files above, byte for byte the same on every run. `logo.svg` and `mask.svg` are copied as they are,
the PNGs and the ICO are rendered from the SVGs. `ncw validate` compares every file of `assets/` with the artifact,
so a changed or missing image is reported.

License of the dummy files: made for this repository, AGPL-3.0-or-later like the rest of it (the SVG sources say so in
a comment; PNG and ICO cannot carry it).

## Font license

`assets/fonts/` holds Open Sans (SIL Open Font License 1.1): `OFL.txt` is the license, `ATTRIBUTION.txt` the
attribution and source (googlefonts/opensans, pinned commit), `FONTLOG.txt` the font's own log. The license applies
to the font files only.

## Translation overrides

`assets/{core,lib,apps/settings,apps/theming}/l10n/{en,de}.json` replace the bare word "Nextcloud" by the product name
in the strings the server translates through its `l10n/*.json` files (the server merges these theme files over
its own, per string). They were made once from the server's `de.json` files, by replacing the word and leaving out
strings that name an upstream product or version (for example "Nextcloud Mail", "Nextcloud 30", "Nextcloud
community"), and strings where a compound such as "Nextcloud-Verzeichnisse" would remain. The product name is written
into the strings, so it is a second place to change when the name changes.

Not reached: strings that the browser translates from the `l10n/*.js` files (the server loads only one file of that
kind, so an override would replace the whole file), and text that is written in PHP or JS without translation.

## Templates

A template of the server is replaced by the file of the same path below `assets/` (checked on a real install: the theme
file is used). One template is overridden:

### Source offer: `assets/apps/settings/templates/settings/personal/development.notice.php`

The AGPL requires offering the modified source to users, and Nextcloud has no source-offer field. The personal
development notice of the settings app is replaced by a notice that:

- attributes the upstream project (the sentence "This server is based on the Nextcloud server by the Nextcloud community
  and has been modified.", the only place with the text Nextcloud besides the product name),
- links the source of the RUNNING version, and
- keeps the AGPL license link.

The upstream marketing is gone: the "Reasons to use" PDF link and the five social links with their images.

**The repository URL is the brand value `$ncwSourceRepository` at the top of the template** (marked `BRAND VALUE`; the
public repository of the modified server, `https://github.com/printminion-co/mk-nc-server`). Change it there only.

The link is made at runtime from `version.json` in the server root (written by the build):

| `kind` | fields read | link |
|---|---|---|
| `release` | `base_release`, `release_number` | `<repository>/tree/ncw-v<base_release>-<release_number>` (the annotated snapshot tag) |
| `dev` | `server_commit` | `<repository>/tree/<server_commit>` (the full sha) |

Anything else falls back to the plain repository URL: the file is missing, not readable or not JSON, the kind is unknown,
or a value does not match a strict pattern (the tag `^[A-Za-z0-9._-]+$`, the sha `^[0-9a-f]{40}$`, the release number an
integer of at least 1). Reading never throws, so the personal page does not break. All output goes through `p()`.

The three strings go through `$l->t()` with English text; `assets/apps/settings/l10n/{en,de}.json` carry the English and
German entries (the PHP side of the l10n override works for templates, unlike the JS files). The brand check of the smoke
tests (the fork) allows the attribution sentence and checks that the page links the expected source exactly once.
