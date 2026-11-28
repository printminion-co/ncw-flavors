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
`apps/settings/templates/settings/personal/development.notice.php`) is overridden through a theme: the theme file
`assets/apps/settings/templates/settings/personal/development.notice.php` is used instead of the server's (checked on a
real install, so no patch of the notice is needed on line 33; a line where the override does not work gets a small patch
instead). No new page or app is added, and the server code is not touched. Login and public pages use the theming
homepage URL and legal links.

As built, the template of the `ionos` theme:

- links the public repository of the server fork, written once as the marked brand value `$ncwSourceRepository` at the
  top of the template (the real public repository, no placeholder);
- reads `version.json` in the server root at runtime. A `release` build links `<repository>/tree/ncw-v<base_release>-<release_number>`
  (the annotated snapshot tag of the snapshot workflow), a `dev` build links `<repository>/tree/<server_commit>` (the full sha).
  The plain repository URL is the fallback when the file is missing, unreadable or not JSON, the kind is unknown, or a
  value does not match its strict pattern (tag `^[A-Za-z0-9._-]+$`, sha `^[0-9a-f]{40}$`, release number an integer of
  at least 1). Reading never throws, so the personal page cannot break; all output goes through `p()`;
- keeps the AGPL license link and attributes the upstream project in one sentence ("This server is based on the Nextcloud
  server by the Nextcloud community and has been modified."): it is the only text "Nextcloud" the notice adds, and the
  brand check allow-list has one entry for it;
- drops the upstream marketing: the "Reasons to use" PDF link and the five social links with their images (facebook,
  bluesky, mastodon, blog, newsletter). Their allow-list entries are removed with them.

The three strings go through `$l->t()` with English text. English and German entries are in the theme's
`assets/apps/settings/l10n/{en,de}.json`; the server merges those over its own, and the PHP side of the l10n override
works for templates, unlike the JS translation files.

The smoke tests prove it: the brand check run (fresh install and upgrade) fetches the personal page and checks that it has
a link to the expected source, derived from the `version.json` of the unpacked archive by the same rule, exactly once, and
none of the marketing links. The `smoke_break` mode `source-link` replaces the template in the archive by one without the
link, so the failure of that probe can be shown in CI.

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
