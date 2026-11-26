import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { assertNoDuplicateApps, assertRemovedAppsAreUnlisted, checkClassification, discoverApps } from './apps.ts';
import { InputError, requireOption } from './errors.ts';
import { assertAppsCompatible } from './compat.ts';
import { renderMetadata, validateMetadataInputs, type MetadataInputs, type RawMetadataOptions } from './metadata.ts';
import { assertValidFlavor, resolveFlavor, type ResolvedFlavor } from './resolve.ts';

export type BuildKind = 'dev' | 'release';

/** The options as the command line hands them over: not yet checked. */
export interface RawBuildOptions {
  flavorsRoot: string;
  flavor: string;
  tree: string;
  line: string;
  kind: string;
  buildNumber: string;
  out: string;
  metadata?: RawMetadataOptions;
}

export interface BuildOptions {
  flavorsRoot: string;
  flavor: string;
  tree: string;
  /** The stable line, such as "33". */
  line: string;
  kind: BuildKind;
  buildNumber: number;
  out: string;
  metadata: MetadataInputs;
}

function validateOptions(raw: RawBuildOptions): BuildOptions {
  const required: [string, string][] = [
    ['--flavors', raw.flavorsRoot], ['--flavor', raw.flavor], ['--tree', raw.tree], ['--line', raw.line],
    ['--kind', raw.kind], ['--build-number', raw.buildNumber], ['--out', raw.out],
  ];
  for (const [name, value] of required) requireOption(name, value);

  assertValidFlavor(raw.flavorsRoot, raw.flavor);
  if (raw.kind !== 'dev' && raw.kind !== 'release') {
    throw new InputError(`unknown build kind "${raw.kind}", expected dev or release`);
  }
  if (!/^[1-9][0-9]*$/.test(raw.buildNumber)) {
    throw new InputError(`the build number must be a positive integer, got "${raw.buildNumber}"`);
  }
  if (!/^[0-9]+$/.test(raw.line)) {
    throw new InputError(`--line must be a stable line number such as 33, got "${raw.line}"`);
  }
  if (!existsSync(raw.tree) || !statSync(raw.tree).isDirectory() || !existsSync(join(raw.tree, 'version.php'))) {
    throw new InputError(`the tree ${raw.tree} does not exist or is not a Nextcloud tree (no version.php)`);
  }
  return {
    flavorsRoot: raw.flavorsRoot,
    flavor: raw.flavor,
    tree: raw.tree,
    line: raw.line,
    kind: raw.kind,
    buildNumber: Number(raw.buildNumber),
    out: raw.out,
    metadata: validateMetadataInputs(raw.metadata ?? {}, raw.kind),
  };
}

/** The files of a tree, by path relative to its root. */
export type Tree = Map<string, Uint8Array>;

export function loadTree(root: string): Tree {
  const tree: Tree = new Map();
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else tree.set(relative(root, path), new Uint8Array(readFileSync(path)));
    }
  };
  walk(root);
  return tree;
}

function readText(tree: Tree, path: string): string {
  const bytes = tree.get(path);
  if (!bytes) throw new InputError(`the tree has no ${path}`);
  return new TextDecoder().decode(bytes);
}

function writeText(tree: Tree, path: string, content: string): void {
  tree.set(path, new TextEncoder().encode(content));
}

function deleteWhere(tree: Tree, matches: (path: string) => boolean): void {
  for (const path of [...tree.keys()]) if (matches(path)) tree.delete(path);
}

export function baseRelease(tree: Tree): string {
  const match = /\$OC_VersionString\s*=\s*'([^']+)'/.exec(readText(tree, 'version.php'));
  if (!match?.[1]) throw new InputError('the tree has no $OC_VersionString in its version file');
  return match[1];
}

/** The official artifact ships an install flag file and a web updater; neither belongs in a flavor. */
function dropInstallFlagAndUpdater(tree: Tree): void {
  deleteWhere(tree, (path) => path === 'config/CAN_INSTALL' || path.startsWith('updater/'));
}

/** Appended to the version file: reads the build number file and adds it as a fifth version element. */
const BUILD_NUMBER_SNIPPET = `
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

/** Sets the channel to git (no integrity enforcement) and appends the build number snippet. */
function rewriteVersionFile(tree: Tree): void {
  const version = readText(tree, 'version.php');
  const withChannel = version.replace(/(\$OC_Channel\s*=\s*)'[^']*';/, "$1'git';");
  if (withChannel === version && !/\$OC_Channel\s*=\s*'git';/.test(version)) {
    throw new InputError('the version file has no $OC_Channel to set');
  }
  // A tree that was processed before already has the snippet; appending it again would add the build number twice.
  const processed = withChannel.includes(BUILD_NUMBER_SNIPPET.trim());
  writeText(tree, 'version.php', processed ? withChannel : withChannel + BUILD_NUMBER_SNIPPET);
}

interface ShippedLists {
  shippedApps: string[];
  defaultEnabled: string[];
  alwaysEnabled: string[];
}

function readShippedLists(tree: Tree): ShippedLists {
  const text = readText(tree, 'core/shipped.json');
  try {
    return JSON.parse(text) as ShippedLists;
  } catch {
    throw new InputError('core/shipped.json in the tree is not valid JSON');
  }
}

const withoutApp = (list: string[], id: string): string[] => list.filter((x) => x !== id);
const withApp = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id]);

/** Removes an app from the tree: the server's own copy and the copy in any active app folder. */
function pruneApp(tree: Tree, flavor: ResolvedFlavor, id: string): void {
  deleteWhere(tree, (path) => path.startsWith(`apps/${id}/`) || flavor.appFolders.some((folder) => path.startsWith(`${folder}/${id}/`)));
}

/**
 * Applies the app modes to the shipped-apps lists and the tree. always -> always-enabled; default ->
 * default-enabled; available -> in neither; removed -> in none of the three lists and gone from the tree.
 * Added apps are never put in the shipped list.
 */
function applyAppModes(tree: Tree, flavor: ResolvedFlavor): void {
  const lists = readShippedLists(tree);
  for (const [id, mode] of flavor.apps) {
    if (mode === 'removed') {
      lists.shippedApps = withoutApp(lists.shippedApps, id);
      lists.defaultEnabled = withoutApp(lists.defaultEnabled, id);
      lists.alwaysEnabled = withoutApp(lists.alwaysEnabled, id);
      pruneApp(tree, flavor, id);
    } else {
      lists.alwaysEnabled = mode === 'always' ? withApp(lists.alwaysEnabled, id) : withoutApp(lists.alwaysEnabled, id);
      lists.defaultEnabled = mode === 'default' ? withApp(lists.defaultEnabled, id) : withoutApp(lists.defaultEnabled, id);
    }
  }
  const generated: ShippedLists = {
    shippedApps: [...lists.shippedApps].sort(),
    defaultEnabled: [...lists.defaultEnabled].sort(),
    alwaysEnabled: [...lists.alwaysEnabled].sort(),
  };
  assertRemovedAppsAreUnlisted(generated, flavor);
  writeText(tree, 'core/shipped.json', JSON.stringify(generated, null, 4) + '\n');
}

/**
 * Ships only the app folders the flavor activates (top-level `apps-*` folders) and generates the partial
 * config that makes them app roots next to the server's own `apps`.
 */
function activateAppFolders(tree: Tree, flavor: ResolvedFlavor): void {
  deleteWhere(tree, (path) => {
    const top = path.split('/')[0] ?? '';
    return top.startsWith('apps-') && !flavor.appFolders.includes(top);
  });
  const roots = ['apps', ...flavor.appFolders]
    .map((folder) => `    ['path' => OC::$SERVERROOT . '/${folder}', 'url' => '/${folder}', 'writable' => false],`)
    .join('\n');
  writeText(tree, 'config/00-apps-paths.config.php', `<?php\n$CONFIG = [\n  'apps_paths' => [\n${roots}\n  ],\n];\n`);
}

/** Ships the flavor's partial configs next to upstream's sample config. */
function addPartialConfigs(tree: Tree, flavor: ResolvedFlavor): void {
  for (const [file, source] of flavor.configs) tree.set(`config/${file}`, new Uint8Array(readFileSync(source)));
}

/** A fixed timestamp (the earliest a zip can store), so the clock never leaks into an artifact. */
const FIXED_TIME = new Date(1980, 0, 1, 0, 0, 0);

/** Zips the tree with sorted entries and fixed timestamps, so equal inputs give equal bytes. */
function zipTree(tree: Tree): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const path of [...tree.keys()].sort()) entries[path] = [tree.get(path) as Uint8Array, { mtime: FIXED_TIME }];
  return zipSync(entries);
}

export interface BuildResult {
  /** The path of the artifact that was written. */
  artifact: string;
  /** What the build resolved the flavor to, for the build log. */
  flavor: ResolvedFlavor;
}

/** Builds the artifact of one flavor. */
export function buildArtifact(raw: RawBuildOptions): BuildResult {
  const options = validateOptions(raw);
  const flavor = resolveFlavor(options.flavorsRoot, options.flavor);
  const tree = loadTree(options.tree);
  const release = baseRelease(tree);
  if (!release.startsWith(`${options.line}.`)) {
    throw new InputError(`line ${options.line} does not match the tree's base release ${release}`);
  }

  const apps = discoverApps(tree, flavor);
  assertNoDuplicateApps(apps);
  for (const warning of checkClassification(apps, flavor, options.kind)) process.stderr.write(`${warning}\n`);
  assertAppsCompatible(tree, flavor, release, options.tree, 'source tree');
  applyAppModes(tree, flavor);
  activateAppFolders(tree, flavor);
  addPartialConfigs(tree, flavor);
  dropInstallFlagAndUpdater(tree);
  writeText(tree, '.buildnumber', `${options.buildNumber}\n`);
  rewriteVersionFile(tree);
  assertAppsCompatible(tree, flavor, release, options.tree, 'assembled tree');
  writeText(tree, 'version.json', renderMetadata(options.metadata, options.flavor, release, options.kind));

  mkdirSync(options.out, { recursive: true });
  const artifact = join(options.out, `ncw-${options.flavor}-v${release}.${options.buildNumber}.zip`);
  writeFileSync(artifact, zipTree(tree));
  return { artifact, flavor };
}
