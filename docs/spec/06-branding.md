# 6. Branding

**Branding** is the enforced IONOS design system applied on top of stock Nextcloud, so users see IONOS Nextcloud
Workspace and not upstream Nextcloud. All flavors rebrand, because every flavor is a modified server. The shared base
carries the default brand theme; a flavor can replace it, extend it or add more.

## Three tiers

| Tier | Contents | Mechanism |
|---|---|---|
| Tokens | Color palette, status colors, typography, header height and click-target size, light and dark variants | A theme class |
| Overrides | Per-app styling for Talk, Files, Calendar, login, public shares and so on | The theme's CSS |
| Instance settings | Primary color, background, product name, legal links, homepage URL, locking of user and admin theming, client download links, logo and favicon | The app-configuration template (`app-config.json`, applied by `ncw-configure.sh` with `occ config:import` and `occ config:app:set`) and partial configs, applied at provisioning |

It adds the design tokens, the Open Sans font, the per-app overrides and the IONOS mail template. It changes
primary, status, text, background and border colors, dark-mode behavior, logo, favicon and legal links. It removes
user and admin theming controls, the other upstream themes where one theme is enforced, and upstream marketing
(the Nextcloud name, slogan and promo links). Functional changes to the product are out of scope. The theme owns the
look, `occ` owns the instance settings, and neither is edited by hand on a running instance.

## Principle: no server code changes

Server code is not changed. New classes and files are added and activated by configuration. The one known exception
on 33 is a single generic, named patch to `ThemesService`: it builds its theme list in its constructor from a fixed
set of classes and `enforce_theme` can only pick from that list, so the patch registers the extra theme classes
listed in a system setting (for example `ncw.themes`). There are no per-theme patches (ADR 0006).

## Themes

A theme is a package in the flavors repo under `themes/<name>/`:

| In the package | In the artifact | What |
|---|---|---|
| `lib/*.php` | `lib/private/Ncw/Themes/` | theme classes, namespace `OC\Ncw\Themes`, registered through `ncw.themes` |
| `mail/*.php` | `lib/private/Ncw/Mail/` | mail template classes, namespace `OC\Ncw\Mail`, not registered, activated by `mail_template_class` |
| `assets/**` | `themes/<name>/**` | the legacy theme folder: CSS, fonts, images, translation and template overrides |

A flavor lists zero or more themes in its manifest and inherits them from bases like apps and configs. The tool generates
`config/01-themes.config.php` (reserved number range 00 to 09) with the keys `ncw.themes` (the list of the class names of all
`lib/*.php` of the themes, in the order of the themes, then by name) and, when the flavor enforces one, `enforce_theme`. A flavor
config may not set these two keys. The `ThemesService` patch reads exactly `ncw.themes` as a list of fully qualified class names,
resolves each through the server container, and ignores with one warning a class that does not exist, does not implement
`ITheme`, cannot be built or uses the id of a theme that is already registered. `validate` compares every file of the theme
packages with the artifact. The shared base `common` lists and enforces the `ionos` theme, so every flavor that extends it has it.

The theme classes do not go to the theming app: its Composer autoloader is a classmap (`classmap-authoritative`), so a class added
to `apps/theming/lib` is never found. The server's own `OC\` namespace is loaded by PSR-4 from `lib/private`, which is where the
classes go. A class outside `OCA\Theming` is built by the server container and not by the theming app's container, which is the only
one that can inject a translator (`IL10N`): a theme class that extends `DefaultTheme` takes the l10n factory instead.

The server stylesheet code for a theme (`getThemeStylesheet`) nests the theme's custom CSS in `[data-theme-<id>]` and cannot read an
`@media` rule that holds selectors (a rule like that is dropped silently, and a long one exhausts the PCRE backtrack limit and
drops every at-rule). So the first theme serves light and dark in one class with `light-dark()` values and `color-scheme: light
dark`; per-app CSS is nested rules, `@font-face` is the one at-rule that works.

The `theme` system setting (the legacy theme folder, set by the base config `11-theme.config.php` to the name of the package) makes
the server load `themes/<name>/`: translation overrides as JSON next to the server's own `l10n` files (core, lib and every app),
template overrides by path, CSS and images. A theme's `l10n/*.js` replaces the app's file instead of merging, so only JSON is
overridden. The same setting is the lock on admin theming (see below).

`IonosTheme` is the first theme. Its brand values are placeholders in one marked block of the class (palette light and dark, status
colors, font, header height, click target); the per-app CSS and the mail template only use them. The font is Open Sans (SIL Open
Font License 1.1, license and attribution shipped with the font files). There is no logo and no favicon asset yet, so the server's
default ones are used; they go to `themes/<name>/core/img/`.

## Mail

The IONOS mail template is a subclass of the server's `EMailTemplate` in the theme package (`mail/`), activated by the base config
`12-mail.config.php` (`mail_template_class`). It restyles the server's layout strings with the brand values of the theme and keeps
the placeholders of the originals. The header logo is the theming app's logo (the default one until a logo asset exists).

## Instance settings and locks

The base `common` carries them in `app-config.json`, so `ncw-configure.sh` applies them after every install and upgrade:

- theming: `name` and `productName` (IONOS Nextcloud Workspace), `slogan` (empty), `url`, `imprintUrl` and `privacyUrl` (placeholders on
  `example.invalid`), `primary_color` (equal to the primary color of the theme class, a test keeps them equal), `background_color` and
  `backgroundMime` = `backgroundColor` (a plain color, no image), and the special setting `disable-user-theming` (boolean).
- partial config `13-clients.config.php`: `customclient_desktop`, `customclient_ios`, `customclient_android` and `customclient_fdroid`
  (placeholders) and an empty `customclient_ios_appid`, which otherwise puts the Nextcloud iOS app into every page.

Locks, checked on a real install:

- **User theming**: the theming app setting `disable-user-theming` hides the personal choices; the user theming section only tells that
  the admin disabled it. With `enforce_theme` the section lists only the enforced theme.
- **Admin theming**: there is no setting that hides the admin theming section on 33. The closest mechanism is the legacy `theme` system
  setting: the section then shows only "You are already using a custom theme" (`isThemeable` false), and the settings applied by
  `ncw-configure.sh` stay in force. The app-menu part of the admin page is not hidden. No server code is patched for it.

Gaps: the theming app has no terms-of-use link (only imprint and privacy), so none is set. Logo, favicon and the mail header logo wait
for assets.

## Source offer

The AGPL requires offering the modified source to users who use the server over the network, and Nextcloud has no
built-in source-offer field or About page. The existing personal development notice (a PHP template,
`apps/settings/templates/settings/personal/development.notice.php`) is overridden through a theme to link the
public repository at the running release's tag, read from `version.json`. No new page or app is added. If the
template override does not work on a line, the notice gets a small patch instead. Login and public pages use the
theming homepage URL and legal links.

## Name and trademark

Under the project's trademark policy (updated 2024-06-26) a modified server may not use the Nextcloud marks, and no
company, product or app name may include them. The product name "IONOS Nextcloud Workspace" is permitted by
agreement with Nextcloud; the spec gives no details of it. The IONOS marks remain trademarks of their owner;
publishing the brand assets under an open source license does not grant rights to the marks. This is not legal
advice.

## Known residuals

Strings a theme cannot reach are listed here and are not patched for now: the admin overview's "Nextcloud Hub ..." label, the
`help.php` upstream links, the OCS `website` value, and the translatable strings in the settings app that a translation override does
not cover. Found by the brand check on a real install (each is an entry of its allow-list with the page and a reason): the update
server URL of the update notification app, the sharing source type names that the circles app sends ("Nextcloud Account", "Nextcloud
Group", "Nextcloud App", hard-coded), the settings description that names the Nextcloud Mail app, the image attributions of the shipped
backgrounds, the comment texts in the capabilities, ids and file names that contain the word, the documentation links, and the
social links and the AGPL attribution of the development notice until its template is overridden. Text that the browser builds from the
JS bundles is not covered by the check. Per-market variants (logo, favicon and legal links per market) are out of scope for now.
