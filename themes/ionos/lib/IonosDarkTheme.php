<?php

declare(strict_types=1);
/**
 * SPDX-FileCopyrightText: 2026 NC Flavors contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OC\Ncw\Themes;

use OCA\Theming\ITheme;
use OCA\Theming\Themes\DarkTheme;

/**
 * The dark variant of the IONOS theme. The values are IonosTheme::DARK; nothing is defined here.
 */
class IonosDarkTheme extends DarkTheme implements ITheme {
	public function getId(): string {
		return 'ionos-dark';
	}

	public function getTitle(): string {
		return 'IONOS dark theme';
	}

	public function getEnableLabel(): string {
		return 'Enable the IONOS dark theme';
	}

	public function getDescription(): string {
		return 'The IONOS design, dark.';
	}

	public function getCSSVariables(): array {
		$this->primaryColor = IonosTheme::DARK['primary'];
		return array_merge(parent::getCSSVariables(), IonosTheme::variables($this->util, IonosTheme::DARK, true));
	}
}
