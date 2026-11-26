import { InputError } from './errors.ts';
import { readText, type Files } from './tree.ts';

/** Appended to the version file: reads the build number file and adds it as a fifth version element. */
export const BUILD_NUMBER_SNIPPET = `
$buildNumberFile = __DIR__ . '/.buildnumber';
if (file_exists($buildNumberFile)) {
	$buildNumberContent = @file_get_contents($buildNumberFile);
	if ($buildNumberContent !== false) {
		$buildId = (int)trim($buildNumberContent);
		if ($buildId > 0) {
			// Append build ID as 5th element in version array
			$OC_Version[] = $buildId;
		}
	}
}
`;

/** The version file of the artifact: channel set to git (no integrity enforcement), build number snippet appended. */
export function renderVersionFile(files: Files): string {
  const version = readText(files, 'version.php');
  const withChannel = version.replace(/(\$OC_Channel\s*=\s*)'[^']*';/, "$1'git';");
  if (withChannel === version && !/\$OC_Channel\s*=\s*'git';/.test(version)) {
    throw new InputError('the version file has no $OC_Channel to set');
  }
  // A tree that was processed before already has the snippet; appending it again would add the build number twice.
  const processed = withChannel.includes(BUILD_NUMBER_SNIPPET.trim());
  return processed ? withChannel : withChannel + BUILD_NUMBER_SNIPPET;
}
