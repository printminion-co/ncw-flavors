<?php
/**
 * SPDX-FileCopyrightText: 2019 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Source offer (AGPL) of the IONOS theme. It replaces the personal development notice of the server
 * (apps/settings/templates/settings/personal/development.notice.php): no marketing links, a link to the source of
 * the running version, read at runtime from version.json in the server root.
 */

// BRAND VALUE: the public repository of the modified server (the only place that names it)
$ncwSourceRepository = 'https://github.com/printminion-co/mk-nc-server';

// The link: a release build links the snapshot tag ncw-v<base release>-<release number>, a dev build links the
// commit (server_commit). Without a usable version.json (missing, no JSON, a value that is not strict) it is the
// plain repository. Nothing here may throw or print: the personal page must not break.
$ncwSourceUrl = (static function (string $repository): string {
	try {
		$file = \OC::$SERVERROOT . '/version.json';
		if (!is_file($file) || !is_readable($file) || filesize($file) > 1048576) {
			return $repository;
		}
		$data = json_decode((string)file_get_contents($file), true, 8);
		if (!is_array($data)) {
			return $repository;
		}
		$kind = $data['kind'] ?? null;
		if ($kind === 'dev') {
			$commit = $data['server_commit'] ?? null;
			if (is_string($commit) && preg_match('/^[0-9a-f]{40}$/D', $commit) === 1) {
				return $repository . '/tree/' . $commit;
			}
		} elseif ($kind === 'release') {
			$base = $data['base_release'] ?? null;
			$number = $data['release_number'] ?? null;
			if (is_string($base) && is_int($number) && $number >= 1) {
				$tag = 'ncw-v' . $base . '-' . $number;
				if (preg_match('/^[A-Za-z0-9._-]+$/D', $tag) === 1) {
					return $repository . '/tree/' . $tag;
				}
			}
		}
	} catch (\Throwable $e) {
		// fall through to the plain repository
	}
	return $repository;
})($ncwSourceRepository);
?>
<div class="section development-notice">
	<p>
		<?php p($l->t('This server is based on the Nextcloud server by the Nextcloud community and has been modified.')); ?>
	</p>
	<p>
		<a href="<?php p($ncwSourceUrl); ?>" id="ncw-source-link" target="_blank" rel="noreferrer noopener"><?php p($l->t('The source code of the running version is available here.')); ?></a>
	</p>
	<p>
		<a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer noopener"><?php p($l->t('It is licensed under the GNU Affero General Public License (AGPL).')); ?></a>
	</p>
</div>
