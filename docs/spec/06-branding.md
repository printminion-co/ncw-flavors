# 6. Branding

**Branding** is the enforced IONOS design system applied on top of stock Nextcloud, so users see IONOS Nextcloud
Workspace and not upstream Nextcloud. All flavors rebrand, because every flavor is a modified server. The shared base
carries the default brand theme; a flavor can replace it, extend it or add more.

## Three tiers

| Tier | Contents | Mechanism |
|---|---|---|
| Tokens | Color palette, status colors, typography, header height and click-target size, light and dark variants | A theme class |
| Overrides | Per-app styling for Talk, Files, Calendar, login, public shares and so on | The theme's CSS |
| Instance settings | Primary color, background, legal links, homepage URL, locking of user and admin theming, logo and favicon | `occ theming:config` and `occ config:app:set theming ...`, applied at provisioning |

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

A theme is a package in the flavors repo under `themes/<name>/`, holding the theme class, CSS, images, fonts,
translation overrides and template overrides. A flavor lists zero or more themes in its manifest. A partial config
sets which are registered and, optionally, which one is enforced (`enforce_theme`). The build copies the class into
the theming app's themes folder and the assets into `themes/<name>/`. Bases can carry a theme and flavors inherit it
like apps and configs. `IonosTheme` is the first example; it is a new file, not an edit.

## Mail

The IONOS mail template is a class activated with `mail_template_class`.

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

Strings a theme cannot reach are listed here and are not patched for now: the admin overview's "Nextcloud Hub ..."
label, the `help.php` upstream links, the OCS `website` value, and the translatable strings in the settings app that
a translation override does not cover. Per-market variants (logo, favicon and legal links per market) are out of
scope for now.
