import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { assertNoDuplicateApps, assertRemovedAppsAreUnlisted, checkClassification, discoverApps, removedApps } from './apps.ts';
import { isDevFile } from './devfiles.ts';
import { APPS_PATHS_CONFIG, CONFIG_KEYS, phpString, renderPartialConfig } from './generated.ts';
import { InputError, requireOption } from './errors.ts';
import type { BuildKind } from './kind.ts';
import { assertAppsCompatible } from './compat.ts';
import { renderMetadata, validateMetadataInputs, type MetadataInputs, type RawMetadataOptions } from './metadata.ts';
import { assembleAppConfig, type AppConfig } from './appconfig.ts';
import { checkConfigs, checkEnvironment } from './configrules.ts';
import { assertServerTree, deleteWhere, loadServerTree, readShippedLists, writeText, type Files, type ShippedLists, type Tree } from './tree.ts';
import { compareStrings, renderJson } from './util.ts';
import { renderVersionFile } from './versionfile.ts';
import { applyThemes, checkThemes } from './themes.ts';
import { assertValidFlavor, resolveFlavor, type ResolvedFlavor } from './resolve.ts';

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
  assertServerTree(raw.tree);
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

/** Strips what never ships: the install flag file, the web updater, VCS and CI files, dependencies, tests of apps, the flavors submodule. */
function stripDevFiles(tree: Tree, flavor: ResolvedFlavor): void {
  deleteWhere(tree, (path) => isDevFile(path, flavor.appFolders));
}

const withoutApp = (list: string[], id: string): string[] => list.filter((x) => x !== id);
const withApp = (list: string[], id: string): string[] => (list.includes(id) ? list : [...list, id]);

/** Removes an app from the tree: the server's own copy and the copy in any active app folder. */
function pruneApp(tree: Tree, flavor: ResolvedFlavor, id: string): void {
  deleteWhere(tree, (path) => path.startsWith(`apps/${id}/`) || flavor.appFolders.some((folder) => path.startsWith(`${folder}/${id}/`)));
}

/**
 * The shipped-apps lists the artifact gets from the app modes. always -> always-enabled; default ->
 * default-enabled; available -> in neither; removed -> in none of the three lists. Added apps are never put in
 * the shipped list, which includes a vanilla app that the fork keeps outside `apps/` (a submodule of an app folder,
 * although the tree's own list names it). Pure: the tree's own lists are only read.
 */
function generateShippedLists(tree: ShippedLists, flavor: ResolvedFlavor, apps: Map<string, string[]>): ShippedLists {
  const lists = { ...tree };
  for (const [id, folders] of apps) {
    if (!folders.includes('apps')) lists.shippedApps = withoutApp(lists.shippedApps, id);
  }
  for (const [id, mode] of flavor.apps) {
    if (mode === 'removed') {
      lists.shippedApps = withoutApp(lists.shippedApps, id);
      lists.defaultEnabled = withoutApp(lists.defaultEnabled, id);
      lists.alwaysEnabled = withoutApp(lists.alwaysEnabled, id);
    } else {
      lists.alwaysEnabled = mode === 'always' ? withApp(lists.alwaysEnabled, id) : withoutApp(lists.alwaysEnabled, id);
      lists.defaultEnabled = mode === 'default' ? withApp(lists.defaultEnabled, id) : withoutApp(lists.defaultEnabled, id);
    }
  }
  const generated: ShippedLists = {
    shippedApps: [...lists.shippedApps].sort(compareStrings),
    defaultEnabled: [...lists.defaultEnabled].sort(compareStrings),
    alwaysEnabled: [...lists.alwaysEnabled].sort(compareStrings),
  };
  assertRemovedAppsAreUnlisted(generated, flavor);
  return generated;
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
    .map((folder) => `['path' => OC::$SERVERROOT . ${phpString(`/${folder}`)}, 'url' => ${phpString(`/${folder}`)}, 'writable' => false]`);
  writeText(tree, `config/${APPS_PATHS_CONFIG}`, renderPartialConfig([[CONFIG_KEYS.appsPaths, roots]]));
}

/** Ships the flavor's partial configs next to upstream's sample config. */
function addPartialConfigs(tree: Tree, flavor: ResolvedFlavor): void {
  for (const [file, source] of flavor.configs) tree.set(`config/${file}`, new Uint8Array(readFileSync(source)));
}

/** The files the deployment reads: the app-config template, the settings the import cannot set, the removed apps. */
function writeDeploymentFiles(tree: Tree, appConfig: AppConfig, removed: string[]): void {
  writeText(tree, 'app-config.json', renderJson({ apps: appConfig.apps }, 2));
  writeText(tree, 'app-config-special.json', renderJson(appConfig.special, 2));
  writeText(tree, 'removed-apps.json', renderJson(removed, 2));
}

/** A fixed timestamp (the earliest a zip can store), so the clock never leaks into an artifact. */
const FIXED_TIME = new Date(1980, 0, 1, 0, 0, 0);

/** Zips the tree with sorted entries and fixed timestamps, so equal inputs give equal bytes. */
function zipTree(tree: Tree): Uint8Array {
  const entries: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const path of [...tree.keys()].sort(compareStrings)) entries[path] = [tree.get(path) as Uint8Array, { mtime: FIXED_TIME }];
  return zipSync(entries);
}

export interface BuildResult {
  /** The path of the artifact that was written. */
  artifact: string;
  /** What the build resolved the flavor to, for the build log. */
  flavor: ResolvedFlavor;
  /** Every warning of the build, in the order the checks ran: config numbers, environment variables, unclassified apps. */
  warnings: string[];
}

/** Everything the assembly needs, computed by `validate` without touching anything. */
interface ValidatedBuild {
  options: BuildOptions;
  flavor: ResolvedFlavor;
  appConfig: AppConfig;
  /** The server tree as read from disk. */
  files: Tree;
  release: string;
  /** The shipped-apps lists the artifact gets. */
  shippedLists: ShippedLists;
  removed: string[];
  versionFile: string;
  warnings: string[];
}

/** The validation phase: every check of the build, in order, with no mutation of the tree and nothing written. */
function validate(raw: RawBuildOptions): ValidatedBuild {
  const options = validateOptions(raw);
  const flavor = resolveFlavor(options.flavorsRoot, options.flavor);
  checkThemes(flavor, options.flavorsRoot);
  const configCheck = checkConfigs(flavor, options.flavorsRoot);
  const appConfig = assembleAppConfig(flavor, options.flavorsRoot);
  const warnings = [...configCheck.warnings, ...checkEnvironment(flavor, new Map([...appConfig.envReferences, ...configCheck.envReferences]))];
  try {
    const { files, release } = loadServerTree(options.tree);
    if (!release.startsWith(`${options.line}.`)) {
      throw new InputError(`line ${options.line} does not match the tree's base release ${release}`);
    }

    const apps = discoverApps(files, flavor);
    assertNoDuplicateApps(apps);
    warnings.push(...checkClassification(apps, flavor, options.kind));
    assertAppsCompatible(files, flavor, release, options.tree, 'source tree');
    const treeLists = readShippedLists(files);
    const removed = removedApps(flavor, treeLists.shippedApps);
    const shippedLists = generateShippedLists(treeLists, flavor, apps);
    const versionFile = renderVersionFile(files);
    return { options, flavor, appConfig, files, release, shippedLists, removed, versionFile, warnings };  } catch (error) {
    if (error instanceof InputError) error.warnings.push(...warnings);
    throw error;
  }
}

/**
 * The assembly phase: applies the validated build to the tree. The one check left is the compatibility check of
 * the assembled tree, which needs the assembled tree.
 */
function assemble(validated: ValidatedBuild): Tree {
  const { options, flavor, files: tree } = validated;
  for (const [id, mode] of flavor.apps) if (mode === 'removed') pruneApp(tree, flavor, id);
  writeText(tree, 'core/shipped.json', renderJson(validated.shippedLists, 4));
  writeDeploymentFiles(tree, validated.appConfig, validated.removed);
  activateAppFolders(tree, flavor);
  addPartialConfigs(tree, flavor);
  applyThemes(tree, flavor, options.flavorsRoot);
  stripDevFiles(tree, flavor);
  writeText(tree, '.buildnumber', `${options.buildNumber}\n`);
  writeText(tree, 'version.php', validated.versionFile);
  assertAppsCompatible(tree, flavor, validated.release, options.tree, 'assembled tree');
  writeText(tree, 'version.json', renderMetadata(options.metadata, options.flavor, validated.release, options.buildNumber, options.kind));
  return tree;
}

/** Builds the artifact of one flavor. */
export function buildArtifact(raw: RawBuildOptions): BuildResult {
  const validated = validate(raw);
  const tree = assemble(validated);
  const { options, release } = validated;

  mkdirSync(options.out, { recursive: true });
  const artifact = join(options.out, `ncw-${options.flavor}-v${release}.${options.buildNumber}.zip`);
  writeFileSync(artifact, zipTree(tree));
  return { artifact, flavor: validated.flavor, warnings: validated.warnings };
}
