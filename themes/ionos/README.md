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

## Logo and favicon (not included)

There is no logo and no favicon asset yet, so the server's default ones are used. They go here:

- `assets/core/img/logo.svg` (and `logo.png`), `assets/core/img/logo-icon.svg`: the logo and the one in emails
- `assets/core/img/favicon.svg`, `favicon.png`, `favicon.ico`, `favicon-touch.png`: the favicons

The server replaces an image of `core/img/` with the file of the same name in `themes/ionos/core/img/`.
(`themes/example` in the server tree shows the full set.)

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

A template of the server is replaced by the file of the same path below `assets/`, for example
`assets/apps/settings/templates/settings/personal/development.notice.php` (checked: the theme file is used). The
source-link override of the development notice belongs to its own change; no template is overridden yet.
