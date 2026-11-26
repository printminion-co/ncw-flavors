import { existsSync, readFileSync, statSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { discoverApps } from './apps.ts';
import { BUILD_NUMBER_SNIPPET } from './versionfile.ts';
import { configNumber } from './configrules.ts';
import { isDevFile } from './devfiles.ts';
import { InputError } from './errors.ts';
import { assertValidFlavor, resolveFlavor, type ResolvedFlavor } from './resolve.ts';
import { loadTree, type Files, type ShippedLists, type Tree } from './tree.ts';
import { compareStrings, isPlainObject } from './util.ts';
import { generatedConfigs } from './generated.ts';

/** Files of upstream's `config/` directory that stay in the artifact. */
const UPSTREAM_CONFIG_FILES: readonly string[] = ['config.sample.php', '.htaccess'];

/** Reads the artifact, a zip file or an unpacked directory, into a tree. */
function loadArtifact(path: string): Tree {
  if (!existsSync(path)) throw new InputError(`artifact ${path} does not exist`);
  if (statSync(path).isDirectory()) return loadTree(path);
  try {
    const entries = unzipSync(new Uint8Array(readFileSync(path)));
    return new Map(Object.entries(entries).filter(([name]) => !name.endsWith('/')));
  } catch {
    throw new InputError(`artifact ${path} is not a zip file`);
  }
}

const decode = (files: Files, path: string): string | undefined => {
  const bytes = files.get(path);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
};

function checkConfig(files: Files, flavor: ResolvedFlavor, violations: string[]): void {
  const expected = new Set([...flavor.configs.keys(), ...generatedConfigs(flavor)]);
  const allowed = new Set([...expected, ...UPSTREAM_CONFIG_FILES]);
  const present = [...files.keys()].filter((path) => path.startsWith('config/'));
  for (const path of present) {
    const file = path.slice('config/'.length);
    if (!allowed.has(file) && !isDevFile(path, flavor.appFolders)) violations.push(`unexpected file ${path}`);
  }
  for (const file of [...expected].sort(compareStrings)) {
    if (!files.has(`config/${file}`)) violations.push(`missing config file config/${file}`);
  }
  const byNumber = new Map<string, string[]>();
  for (const path of present.sort(compareStrings)) {
    const number = configNumber(path.slice('config/'.length));
    if (number !== undefined) byNumber.set(number, [...(byNumber.get(number) ?? []), path]);
  }
  for (const [number, paths] of byNumber) {
    if (paths.length > 1) violations.push(`config files ${paths.join(' and ')} share the number ${number}`);
  }
}

function checkFlavorName(versionJson: Record<string, unknown> | undefined, flavorName: string, violations: string[]): void {
  if (versionJson && versionJson.flavor !== flavorName) {
    violations.push(`version.json is for flavor "${String(versionJson.flavor)}" but the flavor to validate is "${flavorName}"`);
  }
}

/** Apps of the artifact against the flavor; returns the warnings for apps without a mode in a dev artifact. */
function checkApps(files: Files, flavor: ResolvedFlavor, kind: unknown, violations: string[]): { warnings: string[]; present: Map<string, string[]> } {
  const present = discoverApps(files, flavor);
  const warnings: string[] = [];
  for (const id of [...present.keys()].sort(compareStrings)) {
    const mode = flavor.apps.get(id);
    if (mode === 'removed') violations.push(`app ${id} is removed in flavor ${flavor.name} but present`);
    else if (mode === undefined && kind === 'dev') warnings.push(`warning: app ${id} has no mode`);
    else if (mode === undefined) violations.push(`app ${id} has no mode in flavor ${flavor.name}`);
  }
  for (const [id, mode] of [...flavor.apps].sort(([a], [b]) => compareStrings(a, b))) {
    if (mode !== 'removed' && !present.has(id)) violations.push(`app ${id} is missing (mode ${mode} in flavor ${flavor.name})`);
  }
  return { warnings, present };
}

function checkShippedLists(files: Files, flavor: ResolvedFlavor, present: Map<string, string[]>, violations: string[]): void {
  const text = decode(files, 'core/shipped.json');
  if (text === undefined) return void violations.push('missing core/shipped.json');
  let lists: ShippedLists;
  try {
    lists = JSON.parse(text) as ShippedLists;
  } catch {
    return void violations.push('core/shipped.json is not valid JSON');
  }
  const names = ['shippedApps', 'defaultEnabled', 'alwaysEnabled'] as const;
  const listed = (name: (typeof names)[number], id: string): boolean => Array.isArray(lists[name]) && lists[name].includes(id);
  for (const [id, mode] of [...flavor.apps].sort(([a], [b]) => compareStrings(a, b))) {
    if (mode === 'removed') {
      for (const name of names) if (listed(name, id)) violations.push(`removed app ${id} is in ${name} of core/shipped.json`);
      continue;
    }
    if (mode === 'always' && !listed('alwaysEnabled', id)) violations.push(`app ${id} (always) is not in alwaysEnabled of core/shipped.json`);
    if (mode === 'default') {
      if (!listed('defaultEnabled', id)) violations.push(`app ${id} (default) is not in defaultEnabled of core/shipped.json`);
      if (listed('alwaysEnabled', id)) violations.push(`app ${id} (default) is in alwaysEnabled of core/shipped.json`);
    }
    if (mode === 'available') {
      for (const name of ['defaultEnabled', 'alwaysEnabled'] as const) {
        if (listed(name, id)) violations.push(`app ${id} (available) is in ${name} of core/shipped.json`);
      }
    }
  }
  // an added app is one that is not in the server's own apps folder
  for (const [id, folders] of [...present].sort(([a], [b]) => compareStrings(a, b))) {
    if (!folders.includes('apps') && listed('shippedApps', id)) violations.push(`added app ${id} is in shippedApps of core/shipped.json`);
  }
}

function checkForbidden(files: Files, flavor: ResolvedFlavor, violations: string[]): void {
  for (const path of [...files.keys()].sort(compareStrings)) {
    if (isDevFile(path, flavor.appFolders)) violations.push(`forbidden entry ${path}`);
  }
}

/** The `version.json` of the artifact when it is a JSON object, else undefined. */
function readVersionJson(files: Files): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(decode(files, 'version.json') ?? '');
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function checkVersionFiles(files: Files, versionJson: Record<string, unknown> | undefined, violations: string[]): void {
  for (const path of ['version.json', '.buildnumber', 'version.php']) {
    if (!files.has(path)) violations.push(`missing version file ${path}`);
  }
  if (files.has('version.json') && !versionJson) violations.push('version.json is not a valid JSON object');

  const buildnumber = decode(files, '.buildnumber')?.trim();
  if (buildnumber !== undefined) {
    if (!/^[1-9][0-9]*$/.test(buildnumber)) violations.push(`.buildnumber must be a positive integer, got "${buildnumber}"`);
    else if (versionJson && versionJson.build_number !== Number(buildnumber)) {
      violations.push(`.buildnumber is ${buildnumber} but version.json build_number is ${String(versionJson.build_number)}`);
    }
  }

  const version = decode(files, 'version.php');
  if (version !== undefined) {
    if (!/\$OC_Channel\s*=\s*'git';/.test(version)) violations.push("version.php does not set the channel 'git'");
    const count = version.split(BUILD_NUMBER_SNIPPET.trim()).length - 1;
    if (count !== 1) violations.push(`version.php has the build number snippet ${count} times, expected once`);
  }
}

/** The `validate` command: static checks of a produced artifact against the resolved flavor. */
export function validateArtifact(flavorsRoot: string, flavorName: string, artifactPath: string): void {
  assertValidFlavor(flavorsRoot, flavorName);
  const flavor = resolveFlavor(flavorsRoot, flavorName);
  const files = loadArtifact(artifactPath);

  const violations: string[] = [];
  const versionJson = readVersionJson(files);
  checkFlavorName(versionJson, flavorName, violations);
  checkConfig(files, flavor, violations);
  const { warnings, present } = checkApps(files, flavor, versionJson?.kind, violations);
  checkShippedLists(files, flavor, present, violations);
  checkForbidden(files, flavor, violations);
  checkVersionFiles(files, versionJson, violations);

  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  if (violations.length > 0) {
    throw new InputError(`artifact ${artifactPath} failed validation for flavor ${flavorName}:\n  ${violations.join('\n  ')}`);
  }
}
