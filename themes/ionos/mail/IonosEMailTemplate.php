<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 NC Flavors contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OC\Ncw\Mail;

use OC\Mail\EMailTemplate;
use OC\Ncw\Themes\IonosTheme;
use OCP\Defaults;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;

/**
 * The IONOS mail template. The server's EMailTemplate keeps the layout in string properties; this class restyles
 * them with the brand values of IonosTheme (text, background, muted text, primary color and the font) and keeps the
 * structure and the placeholders of the originals. It is activated by the system setting `mail_template_class`.
 *
 * It holds no brand value of its own: change IonosTheme::LIGHT and IonosTheme::FONT_FACE. The header has the
 * instance logo from the theming app (the dummy logo of the theme folder unless an admin uploads one), the text only has
 * the instance name from the theming settings.
 */
class IonosEMailTemplate extends EMailTemplate {
	/** The stock text color and the stock font stack, as the server's template writes them. */
	private const STOCK_TEXT = '#0a0a0a';
	private const STOCK_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen-Sans,Ubuntu,Cantarell,'Helvetica Neue',Arial,sans-serif";
	private const STOCK_MUTED = '#C8C8C8';

	public function __construct(
		Defaults $themingDefaults,
		IURLGenerator $urlGenerator,
		IFactory $l10nFactory,
		?int $logoWidth,
		?int $logoHeight,
		string $emailId,
		array $data,
	) {
		// the parent constructor appends the head to the body, so the layout is restyled first
		foreach (['head', 'tail', 'header', 'heading', 'bodyBegin', 'bodyText', 'listBegin', 'listItem', 'listEnd', 'buttonGroup', 'button', 'bodyEnd', 'footer'] as $part) {
			$this->$part = $this->restyle($this->$part);
		}
		parent::__construct($themingDefaults, $urlGenerator, $l10nFactory, $logoWidth, $logoHeight, $emailId, $data);
	}

	/** The brand values on the stock layout. */
	private function restyle(string $layout): string {
		$palette = IonosTheme::LIGHT;
		return strtr($layout, [
			self::STOCK_FONT => str_replace('"', "'", IonosTheme::FONT_FACE),
			self::STOCK_TEXT => $palette['text'],
			self::STOCK_MUTED => $palette['textMuted'],
			// the logo badge of the stock header is a circle, here it is a flat band
			'padding:35px 0px;border-radius:200px' => 'padding:20px 0px;border-radius:0',
			'color:#fefefe' => 'color:#ffffff',
		]);
	}
}
