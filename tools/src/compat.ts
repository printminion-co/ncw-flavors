import { join } from 'node:path';
import { appInfoPath, discoverApps } from './apps.ts';
import { InputError } from './errors.ts';
import { assertValidFlavor, resolveFlavor, type ResolvedFlavor } from './resolve.ts';
import { assertServerTree, loadServerTree, readText } from './tree.ts';

const ANNOTATION_TITLE = 'App version compatibility';

/** Where in the build the check runs: on the checkout as given, or on the tree after the flavor was applied. */
export type CheckStage = 'source tree' | 'assembled tree';

/** Splits a version into numbers; null when it is not dot-separated digits. */
function versionNumbers(version: string): number[] | null {
  return /^[0-9]+(\.[0-9]+)*$/.test(version) ? version.split('.').map(Number) : null;
}

/** Compares the server version with a bound, but only as far as the bound is written (Nextcloud's rule). */
function compareAsFarAsWritten(server: number[], bound: number[]): number {
  for (let i = 0; i < bound.length; i++) {
    const s = server[i] ?? 0;
    const b = bound[i] as number;
    if (s !== b) return s < b ? -1 : 1;
  }
  return 0;
}

/** Why the bounds do not accept the server version, or null when they do. */
function incompatibility(min: string | undefined, max: string | undefined, server: string): string | null {
  if (min === undefined || max === undefined) {
    const missing = [min === undefined ? 'min-version' : '', max === undefined ? 'max-version' : ''].filter(Boolean);
    return `${missing.join(' and ')} missing`;
  }
  const minNumbers = versionNumbers(min);
  const maxNumbers = versionNumbers(max);
  const serverNumbers = versionNumbers(server) as number[];
  if (!minNumbers || !maxNumbers) return 'bounds must be version numbers such as 33 or 33.0';
  if (compareAsFarAsWritten(serverNumbers, minNumbers) < 0) return 'server is older than min-version';
  if (compareAsFarAsWritten(serverNumbers, maxNumbers) > 0) return 'server is newer than max-version';
  return null;
}

/**
 * Fails when an app that stays in the tree does not accept the server version. `files` maps tree paths to
 * content; `fileRoot` is the source checkout the annotations point into. At the assembled stage the file is named by
 * its source path and the annotation title names the stage, since the assembled tree is not on disk. Writes one GitHub
 * Actions error annotation and one readable line per offending app to stderr, then throws.
 */
export function assertAppsCompatible(
  files: ReadonlyMap<string, Uint8Array>,
  flavor: ResolvedFlavor,
  serverVersion: string,
  fileRoot: string,
  stage: CheckStage,
): void {
  const title = stage === 'source tree' ? ANNOTATION_TITLE : `${ANNOTATION_TITLE} (${stage})`;
  const failures: string[] = [];
  for (const [id, folders] of discoverApps(files, flavor)) {
    if (flavor.apps.get(id) === 'removed') continue;
    for (const folder of folders) {
      const path = appInfoPath(folder, id);
      const tag = /<nextcloud\b[^>]*>/.exec(readText(files, path))?.[0] ?? '';
      const bound = (name: string): string | undefined => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
      const min = bound('min-version');
      const max = bound('max-version');
      const reason = incompatibility(min, max, serverVersion);
      if (reason === null) continue;

      const message = `app "${id}": min-version ${min === undefined ? '(missing)' : `"${min}"`}, max-version ${max === undefined ? '(missing)' : `"${max}"`} do not accept server version ${serverVersion} (${reason})`;
      process.stderr.write(`::error file=${join(fileRoot, path)},title=${title}::${message}\n`);
      failures.push(message);
    }
  }
  if (failures.length > 0) {
    throw new InputError(`app version compatibility check failed on the ${stage}:\n  ${failures.join('\n  ')}`);
  }
}

/** The `check-compat` command: the apps of a server checkout against its own version. */
export function checkCompat(flavorsRoot: string, flavorName: string, treeDir: string): void {
  assertValidFlavor(flavorsRoot, flavorName);
  assertServerTree(treeDir);
  const flavor = resolveFlavor(flavorsRoot, flavorName);
  const { files, release } = loadServerTree(treeDir);
  assertAppsCompatible(files, flavor, release, treeDir, 'source tree');
}
