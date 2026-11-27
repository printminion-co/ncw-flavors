<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 NC Flavors contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OC\Ncw\Themes;

use OCA\Theming\ImageManager;
use OCA\Theming\ITheme;
use OCA\Theming\Themes\DefaultTheme;
use OCA\Theming\ThemingDefaults;
use OCA\Theming\Util;
use OCP\App\IAppManager;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\L10N\IFactory;
use OCP\Server;

/**
 * The IONOS theme, light and dark in one class: every color variable is `light-dark(<light>, <dark>)` and the body
 * has `color-scheme: light dark`, so the browser takes the dark value when the user prefers dark. (A separate dark
 * theme or an @media rule in the custom CSS cannot do this: the server enforces one theme, and its stylesheet code
 * cannot read an @media rule that holds selectors, see README.md of the package.)
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

	/** The dark palette, same keys as LIGHT, except `primary`: the primary color is the same in both. */
	public const DARK = [
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

	/**
	 * The same parameters as DefaultTheme, except that the translator is made from the factory: the server container
	 * resolves this class (it is outside OCA\Theming) and has no translator to inject, the theming app's container has.
	 */
	public function __construct(
		Util $util,
		ThemingDefaults $themingDefaults,
		IUserSession $userSession,
		IURLGenerator $urlGenerator,
		ImageManager $imageManager,
		IConfig $config,
		IFactory $l10nFactory,
		IAppManager $appManager,
		?IRequest $request,
	) {
		parent::__construct($util, $themingDefaults, $userSession, $urlGenerator, $imageManager, $config, $l10nFactory->get('theming'), $appManager, $request);
	}

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

	/** The brand is always applied, the browser's preference picks light or dark inside the variables. */
	public function getMediaQuery(): string {
		return '';
	}

	public function getMeta(): array {
		return [['name' => 'color-scheme', 'content' => 'light dark']];
	}

	public function getCSSVariables(): array {
		$this->primaryColor = self::LIGHT['primary'];
		return array_merge(parent::getCSSVariables(), self::variables($this->util, self::LIGHT, self::DARK));
	}

	/**
	 * The custom CSS: the color scheme, the font, then the CSS files of the theme folder (themes/ionos/css/*.css).
	 * The server nests this CSS in `[data-theme-ionos]`, which is the body: write `&` for the body itself. Keep
	 * at-rules to @font-face: the server only finds those without nested selectors.
	 */
	public function getCustomCss(): string {
		$css = "color-scheme: light dark;\n";
		// the URL is relative to the host: the theme CSS is cut at every double slash, so no absolute URL fits here
		$fonts = $this->urlGenerator->getWebroot() . '/themes/ionos/fonts';
		$css .= "@font-face { font-family: 'Open Sans'; font-style: normal; font-weight: 300 800; font-stretch: 75% 100%; "
			. "font-display: swap; src: url('$fonts/OpenSans-Variable.ttf') format('truetype'); }\n";

		$files = glob(\OC::$SERVERROOT . '/themes/ionos/css/*.css') ?: [];
		sort($files);
		foreach ($files as $file) {
			$css .= file_get_contents($file) . "\n";
		}
		return $css;
	}

	/**
	 * The CSS variables of the two palettes: `light-dark(light, dark)` for every color that differs.
	 *
	 * @param array $light LIGHT
	 * @param array $dark DARK
	 * @return array<string, string> variable name to value
	 */
	public static function variables(Util $util, array $light, array $dark): array {
		$both = fn (string $lightValue, string $darkValue): string => "light-dark($lightValue, $darkValue)";
		// the same shift of a color in both palettes: darker in the light one, lighter in the dark one
		$shifted = fn (string $key, int $by, ?int $darkBy = null): string => $both(
			$util->darken($light[$key], $by),
			$util->lighten($dark[$key], $darkBy ?? $by),
		);
		$variables = [
			'--color-main-background' => $both($light['background'], $dark['background']),
			// the -rgb variable cannot hold two values: it stays the light one, so these are mixed from the color itself
			'--color-main-background-rgb' => join(',', $util->hexToRGB($light['background'])),
			'--color-main-background-translucent' => 'color-mix(in srgb, var(--color-main-background) 97%, transparent)',
			'--color-main-background-blur' => 'color-mix(in srgb, var(--color-main-background) 80%, transparent)',
			'--color-background-hover' => $shifted('background', 4),
			'--color-background-dark' => $shifted('background', 7),
			'--color-background-darker' => $shifted('background', 14),
			'--color-placeholder-light' => $shifted('background', 10),
			'--color-placeholder-dark' => $shifted('background', 20),
			'--color-main-text' => $both($light['text'], $dark['text']),
			'--color-text-maxcontrast' => $both($light['textMuted'], $dark['textMuted']),
			'--color-text-maxcontrast-default' => $both($light['textMuted'], $dark['textMuted']),
			'--color-border' => $both($light['border'], $dark['border']),
			'--color-border-dark' => $shifted('border', 7),
			'--color-border-maxcontrast' => $both($util->darken($light['background'], 51), $util->lighten($dark['background'], 40)),
			'--font-face' => self::FONT_FACE,
			'--header-height' => self::HEADER_HEIGHT,
			'--default-clickable-area' => self::CLICK_TARGET,
			'--clickable-area-small' => self::CLICK_TARGET_SMALL,
			'--clickable-area-large' => self::CLICK_TARGET_LARGE,
		];
		foreach (['success', 'warning', 'error', 'info'] as $status) {
			$background = $both($light[$status]['background'], $dark[$status]['background']);
			$variables["--color-element-$status"] = $both($light[$status]['element'], $dark[$status]['element']);
			$variables["--color-$status"] = $background;
			$variables["--color-$status-hover"] = $both($util->darken($light[$status]['background'], 7), $util->lighten($dark[$status]['background'], 10));
			$variables["--color-$status-text"] = $both($light[$status]['text'], $dark[$status]['text']);
			$variables["--color-$status-rgb"] = join(',', $util->hexToRGB($light[$status]['background']));
		}
		$variables['--color-text-error'] = 'var(--color-element-error)';
		$variables['--color-text-success'] = 'var(--color-element-success)';
		return $variables;
	}
}
