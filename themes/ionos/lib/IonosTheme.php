<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 NC Flavors contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OC\Ncw\Themes;

use OCA\Theming\ITheme;
use OCA\Theming\Themes\DefaultTheme;
use OCA\Theming\Util;
use OCP\Server;

/**
 * The IONOS theme (light). IonosDarkTheme is its dark variant, shown when the browser prefers dark.
 *
 * THE BRAND VALUES ARE IN ONE PLACE: the constants LIGHT, DARK, FONT_FACE and the sizes just below. Everything else
 * in the theme (the CSS files, the mail template) reads them or uses the CSS variables made from them. Every value
 * in this block is a PLACEHOLDER: a neutral palette until the IONOS design values are dropped in here. The primary
 * color has a second copy in bases/common/app-config.json (the `primary_color` instance setting); a test of the
 * flavors repository keeps the two equal.
 *
 * The class is copied by the build to lib/private/Ncw/Themes and registered by the setting `ncw.themes`; the theme
 * folder is `themes/ionos/` (see README.md of the package).
 */
class IonosTheme extends DefaultTheme implements ITheme {
	/* ===== BRAND VALUES: PLACEHOLDER, replace with the IONOS design values ================================ */

	/** The light palette. Keys: see IonosTheme::variables(). */
	public const LIGHT = [
		'primary' => '#2F5D9E', // PLACEHOLDER
		'background' => '#FFFFFF', // PLACEHOLDER
		'text' => '#1F2933', // PLACEHOLDER
		'textMuted' => '#5F6B76', // PLACEHOLDER: needs 4.5:1 on the background
		'border' => '#E1E5E9', // PLACEHOLDER
		'success' => ['background' => '#DDF3E4', 'text' => '#0B5A24', 'element' => '#1B8A3A'], // PLACEHOLDER
		'warning' => ['background' => '#FFF1CC', 'text' => '#6B4A00', 'element' => '#B87A00'], // PLACEHOLDER
		'error' => ['background' => '#FDE3E3', 'text' => '#8C1D1D', 'element' => '#C62828'], // PLACEHOLDER
		'info' => ['background' => '#DCEBFA', 'text' => '#0B4A8C', 'element' => '#1D6FC4'], // PLACEHOLDER
	];

	/** The dark palette, same keys as LIGHT. */
	public const DARK = [
		'primary' => '#6C9BE0', // PLACEHOLDER
		'background' => '#1B1F23', // PLACEHOLDER
		'text' => '#E8EBEE', // PLACEHOLDER
		'textMuted' => '#A4ADB6', // PLACEHOLDER
		'border' => '#2D343A', // PLACEHOLDER
		'success' => ['background' => '#123420', 'text' => '#CDEFD8', 'element' => '#3FB35F'], // PLACEHOLDER
		'warning' => ['background' => '#3A2E0E', 'text' => '#FFEDBB', 'element' => '#F0B429'], // PLACEHOLDER
		'error' => ['background' => '#4A1D1D', 'text' => '#FFD2D2', 'element' => '#FF6B6B'], // PLACEHOLDER
		'info' => ['background' => '#0F3052', 'text' => '#BFDDFB', 'element' => '#4A9BEA'], // PLACEHOLDER
	];

	/** The font family; the @font-face rule for Open Sans is made by getCustomCss(), the files are in fonts/. */
	public const FONT_FACE = "'Open Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"; // PLACEHOLDER

	public const HEADER_HEIGHT = '56px'; // PLACEHOLDER
	public const CLICK_TARGET = '36px'; // PLACEHOLDER: the default clickable area, the small and large ones follow it
	public const CLICK_TARGET_SMALL = '24px'; // PLACEHOLDER
	public const CLICK_TARGET_LARGE = '48px'; // PLACEHOLDER

	/* ===== end of the brand values ========================================================================= */

	public function getId(): string {
		return 'ionos';
	}

	public function getType(): int {
		return ITheme::TYPE_THEME;
	}

	public function getTitle(): string {
		return 'IONOS theme';
	}

	public function getEnableLabel(): string {
		return 'Enable the IONOS theme';
	}

	public function getDescription(): string {
		return 'The IONOS design.';
	}

	/** The brand is always applied; the dark variant is added by getCustomCss(). */
	public function getMediaQuery(): string {
		return '';
	}

	public function getCSSVariables(): array {
		$this->primaryColor = self::LIGHT['primary'];
		return array_merge(parent::getCSSVariables(), self::variables($this->util, self::LIGHT, false));
	}

	/**
	 * The custom CSS: the dark variant of the variables when the browser prefers dark (the rule is stronger than the
	 * light variables of this theme), the font, then the CSS files of the theme folder (themes/ionos/css/*.css).
	 * The server nests this CSS in `[data-theme-ionos]`, which is the body: write `&` for the body itself.
	 */
	public function getCustomCss(): string {
		$dark = '';
		foreach (Server::get(IonosDarkTheme::class)->getCSSVariables() as $name => $value) {
			$dark .= "$name:$value; ";
		}
		$css = "@media (prefers-color-scheme: dark) { body[data-theme-ionos] { $dark} }\n";
		// the URL is relative to the host: the theme CSS is cut at every double slash, so no absolute URL fits here
		$fonts = $this->urlGenerator->getWebroot() . '/themes/ionos/fonts';
		$css .= "@font-face { font-family: 'Open Sans'; font-style: normal; font-weight: 300 800; font-stretch: 75% 100%; "
			. "font-display: swap; src: url('$fonts/OpenSans-Variable.ttf') format('truetype'); }\n";

		$files = glob(\OC::$SERVERROOT . '/themes/ionos/css/*.css');
		sort($files);
		foreach ($files as $file) {
			$css .= file_get_contents($file) . "\n";
		}
		return $css;
	}

	/**
	 * The CSS variables of a palette. Shared with IonosDarkTheme.
	 *
	 * @param array $palette LIGHT or DARK
	 * @return array<string, string> variable name to value
	 */
	public static function variables(Util $util, array $palette, bool $dark): array {
		$shift = fn (string $color, int $by): string => $dark ? $util->lighten($color, $by) : $util->darken($color, $by);
		$background = $palette['background'];
		$variables = [
			'--color-main-background' => $background,
			'--color-main-background-rgb' => join(',', $util->hexToRGB($background)),
			'--color-background-hover' => $shift($background, 4),
			'--color-background-dark' => $shift($background, 7),
			'--color-background-darker' => $shift($background, 14),
			'--color-main-text' => $palette['text'],
			'--color-text-maxcontrast' => $palette['textMuted'],
			'--color-text-maxcontrast-default' => $palette['textMuted'],
			'--color-border' => $palette['border'],
			'--color-border-dark' => $shift($palette['border'], 7),
			'--color-element-success' => $palette['success']['element'],
			'--color-element-warning' => $palette['warning']['element'],
			'--color-element-error' => $palette['error']['element'],
			'--color-element-info' => $palette['info']['element'],
			'--font-face' => self::FONT_FACE,
			'--header-height' => self::HEADER_HEIGHT,
			'--default-clickable-area' => self::CLICK_TARGET,
			'--clickable-area-small' => self::CLICK_TARGET_SMALL,
			'--clickable-area-large' => self::CLICK_TARGET_LARGE,
		];
		foreach (['success', 'warning', 'error', 'info'] as $status) {
			$variables["--color-$status"] = $palette[$status]['background'];
			$variables["--color-$status-hover"] = $shift($palette[$status]['background'], $dark ? 10 : 7);
			$variables["--color-$status-text"] = $palette[$status]['text'];
			$variables["--color-$status-rgb"] = join(',', $util->hexToRGB($palette[$status]['background']));
		}
		return $variables;
	}
}
