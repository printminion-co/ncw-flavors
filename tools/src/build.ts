import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';
import { resolveFlavor, type ResolvedFlavor } from './resolve.ts';

export interface BuildOptions {
  flavorsRoot: string;
  flavor: string;
  tree: string;
  line: string;
  kind: string;
  buildNumber: string;
  out: string;
}

/** The input is wrong in a way the caller can fix; the message says how. */
export class InputError extends Error {}

function validateOptions(o: BuildOptions): void {
  const required: [string, string][] = [
    ['--flavors', o.flavorsRoot], ['--flavor', o.flavor], ['--tree', o.tree], ['--line', o.line],
    ['--kind', o.kind], ['--build-number', o.buildNumber], ['--out', o.out],
  ];
  for (const [name, value] of required) if (!value) throw new InputError(`missing option ${name}`);

  if (o.kind !== 'dev' && o.kind !== 'release') throw new InputError(`unknown build kind "${o.kind}", expected dev or release`);
  if (!/^[1-9][0-9]*$/.test(o.buildNumber)) {
    throw new InputError(`the build number must be a positive integer, got "${o.buildNumber}"`);
  }
  if (!existsSync(o.tree) || !statSync(o.tree).isDirectory() || !existsSync(join(o.tree, 'version.php'))) {
    throw new InputError(`the tree ${o.tree} does not exist or is not a Nextcloud tree (no version.php)`);
  }
  if (!existsSync(join(o.flavorsRoot, 'flavors', o.flavor, 'flavor.yaml'))) {
    throw new InputError(`flavor "${o.flavor}" not found in ${join(o.flavorsRoot, 'flavors')}`);
  }
}

/** The files of a tree, by path relative to its root. */
type Tree = Map<string, Uint8Array>;

function loadTree(root: string): Tree {
  const tree: Tree = new Map();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else tree.set(relative(root, path), new Uint8Array(readFileSync(path)));
    }
  };
  walk(root);
  return tree;
}

function baseRelease(tree: Tree): string {
  const version = readText(tree, 'version.php');
  const match = /\$OC_VersionString\s*=\s*'([^']+)'/.exec(version);
  if (!match?.[1]) throw new Error('the tree has no $OC_VersionString in its version file');
  return match[1];
}

/** The official archive ships an install flag file and a web updater; neither belongs in a flavor. */
function dropInstallFlagAndUpdater(tree: Tree): void {
  tree.delete('config/CAN_INSTALL');
  for (const path of [...tree.keys()]) if (path.startsWith('updater/')) tree.delete(path);
}

function readText(tree: Tree, path: string): string {
  const bytes = tree.get(path);
  if (!bytes) throw new Error(`the tree has no ${path}`);
  return new TextDecoder().decode(bytes);
}

function writeText(tree: Tree, path: string, content: string): void {
  tree.set(path, new TextEncoder().encode(content));
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
    throw new Error('the version file has no $OC_Channel to set');
  }
  writeText(tree, 'version.php', withChannel + BUILD_NUMBER_SNIPPET);
}

interface ShippedLists {
  shippedApps: string[];
  defaultEnabled: string[];
  alwaysEnabled: string[];
}

/**
 * Applies the app modes: generates the shipped-apps lists and prunes removed apps from the tree.
 * always -> always-enabled; default -> default-enabled; available -> in neither; removed -> in none of
 * the three lists and gone from the tree. Added apps are never put in the shipped list.
 */
function applyAppModes(tree: Tree, flavor: ResolvedFlavor): void {
  const lists = JSON.parse(readText(tree, 'core/shipped.json')) as ShippedLists;
  const without = (list: string[], id: string): string[] => list.filter((x) => x !== id);
  const added = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id]);

  for (const [id, mode] of flavor.apps) {
    if (mode === 'removed') {
      lists.shippedApps = without(lists.shippedApps, id);
      lists.defaultEnabled = without(lists.defaultEnabled, id);
      lists.alwaysEnabled = without(lists.alwaysEnabled, id);
      for (const path of [...tree.keys()]) {
        if (path.startsWith(`apps/${id}/`) || flavor.appDirs.some((d) => path.startsWith(`${d}/${id}/`))) tree.delete(path);
      }
    } else if (mode === 'always') {
      lists.defaultEnabled = without(lists.defaultEnabled, id);
      lists.alwaysEnabled = added(lists.alwaysEnabled, id);
    } else if (mode === 'default') {
      lists.alwaysEnabled = without(lists.alwaysEnabled, id);
      lists.defaultEnabled = added(lists.defaultEnabled, id);
    } else {
      lists.defaultEnabled = without(lists.defaultEnabled, id);
      lists.alwaysEnabled = without(lists.alwaysEnabled, id);
    }
  }
  const sorted = (list: string[]): string[] => [...list].sort();
  const out: ShippedLists = {
    shippedApps: sorted(lists.shippedApps),
    defaultEnabled: sorted(lists.defaultEnabled),
    alwaysEnabled: sorted(lists.alwaysEnabled),
  };
  writeText(tree, 'core/shipped.json', JSON.stringify(out, null, 4) + '\n');
}

/**
 * Ships only the app folders the flavor activates (top-level `apps-*` folders) and generates the partial
 * config that makes them app roots next to the server's own `apps`.
 */
function activateAppFolders(tree: Tree, flavor: ResolvedFlavor): void {
  for (const path of [...tree.keys()]) {
    const top = path.split('/')[0] ?? '';
    if (top.startsWith('apps-') && !flavor.appDirs.includes(top)) tree.delete(path);
  }
  const roots = ['apps', ...flavor.appDirs]
    .map((dir) => `    ['path' => OC::$SERVERROOT . '/${dir}', 'url' => '/${dir}', 'writable' => false],`)
    .join('\n');
  writeText(tree, 'config/00-apps-paths.config.php', `<?php\n$CONFIG = [\n  'apps_paths' => [\n${roots}\n  ],\n];\n`);
}

/** Ships the flavor's partial configs next to upstream's sample config. */
function addPartialConfigs(tree: Tree, flavor: ResolvedFlavor): void {
  for (const [file, source] of flavor.configs) tree.set(`config/${file}`, new Uint8Array(readFileSync(source)));
}

/** A fixed timestamp (the earliest a zip can store), so the clock never leaks into an archive. */
const FIXED_TIME = new Date(1980, 0, 1, 0, 0, 0);

/** Zips the tree with sorted entries and fixed timestamps, so equal inputs give equal bytes. */
function zip(tree: Tree): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const path of [...tree.keys()].sort()) entries[path] = [tree.get(path) as Uint8Array, { mtime: FIXED_TIME }];
  return zipSync(entries);
}

/** Builds the archive of one flavor and returns its path. */
export function buildArchive(o: BuildOptions): string {
  validateOptions(o);
  const flavor = resolveFlavor(o.flavorsRoot, o.flavor);
  const tree = loadTree(o.tree);
  const release = baseRelease(tree);
  if (!release.startsWith(`${o.line}.`)) {
    throw new InputError(`line ${o.line} does not match the tree's base release ${release}`);
  }
  applyAppModes(tree, flavor);
  activateAppFolders(tree, flavor);
  addPartialConfigs(tree, flavor);
  dropInstallFlagAndUpdater(tree);
  writeText(tree, '.buildnumber', `${o.buildNumber}\n`);
  rewriteVersionFile(tree);

  mkdirSync(o.out, { recursive: true });
  const archive = join(o.out, `ncw-${o.flavor}-v${release}.${o.buildNumber}.zip`);
  writeFileSync(archive, zip(tree));
  return archive;
}
