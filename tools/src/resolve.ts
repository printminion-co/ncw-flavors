import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { InputError } from './errors.ts';
import { compareStrings } from './util.ts';

export type Mode = 'always' | 'default' | 'available' | 'removed';
const MODES: readonly string[] = ['always', 'default', 'available', 'removed'];

/** An environment variable a flavor needs, as declared in its manifest. */
export interface EnvDeclaration {
  name: string;
  required: boolean;
  default?: string;
}

export interface ResolvedFlavor {
  name: string;
  /** The manifests in the order they were applied, such as `bases/common` then `flavors/flavor1`. */
  order: string[];
  /** App id to mode; a later declaration replaces an earlier one. */
  apps: Map<string, Mode>;
  /** App folders the flavor activates, in the order they were first declared. */
  appFolders: string[];
  /** Themes the flavor includes, in the order they were first declared. */
  themes: string[];
  /** The theme the flavor enforces, if any; the last declaration wins. */
  enforceTheme?: string;
  /** Environment variables by name; a later declaration replaces an earlier one. */
  env: Map<string, EnvDeclaration>;
  /** Partial config files by file name, mapped to their source path; a later declaration replaces an earlier one. */
  configs: Map<string, string>;
  /** The folders of the manifests in the order they were applied (parallel to `order`). */
  dirs: string[];
}

type ManifestKind = 'flavor' | 'base';

interface Manifest {
  extends: string[];
  appFolders: string[];
  themes: string[];
  enforceTheme?: string;
  env: EnvDeclaration[];
  apps: Record<string, Mode>;
  /** Partial config files by file name, mapped to their source path. */
  configs: Record<string, string>;
}

/** The folder of the flavors root that holds manifests of a kind. */
const folderOf = (kind: ManifestKind): string => (kind === 'flavor' ? 'flavors' : 'bases');

const FLAVOR_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Fails unless the flavor name follows the naming rule and the flavor exists in the flavors root. */
export function assertValidFlavor(flavorsRoot: string, flavor: string): void {
  if (!FLAVOR_NAME.test(flavor)) {
    throw new InputError(`flavor name "${flavor}" must be lowercase letters, digits and single hyphens, starting with a letter`);
  }
  if (!existsSync(join(flavorsRoot, folderOf('flavor'), flavor, 'flavor.yaml'))) {
    throw new InputError(`flavor "${flavor}" not found in ${join(flavorsRoot, folderOf('flavor'))}`);
  }
}

/** Names of bases and themes become folder names, so they follow the same rule as flavor names and are never paths. */
function parsePlainNames(path: string, what: string, names: string[]): string[] {
  for (const name of names) {
    if (!FLAVOR_NAME.test(name)) {
      throw new InputError(`${path}: ${what} "${name}" must be lowercase letters, digits and single hyphens, starting with a letter`);
    }
  }
  return names;
}

function parseNames(path: string, field: string, value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    throw new InputError(`${path}: ${field} must be a list of names`);
  }
  return value as string[];
}

function parseEnv(path: string, value: unknown): EnvDeclaration[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new InputError(`${path}: env must be a list of declarations`);
  return value.map((entry: unknown) => {
    const fields = (entry ?? {}) as { name?: unknown; required?: unknown; default?: unknown };
    if (typeof fields.name !== 'string' || fields.name === '') {
      throw new InputError(`${path}: every env declaration needs a name`);
    }
    const declaration: EnvDeclaration = { name: fields.name, required: fields.required === true };
    if (typeof fields.default === 'string') declaration.default = fields.default;
    return declaration;
  });
}

function loadManifest(flavorsRoot: string, kind: ManifestKind, name: string, extendedBy?: string): Manifest {
  const folder = join(flavorsRoot, folderOf(kind));
  const path = join(folder, name, 'flavor.yaml');
  if (!existsSync(path)) {
    const by = extendedBy ? ` (extended by ${extendedBy})` : '';
    throw new InputError(`${kind} "${name}" not found in ${folder}${by}`);
  }

  let document: unknown;
  try {
    document = parse(readFileSync(path, 'utf8')) ?? {};
  } catch (error) {
    throw new InputError(`${path} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const fields = document as { extends?: unknown; app_dirs?: unknown; themes?: unknown; enforce_theme?: unknown; env?: unknown; apps?: unknown };

  const apps: Record<string, Mode> = {};
  for (const [id, mode] of Object.entries((fields.apps ?? {}) as Record<string, unknown>)) {
    if (typeof mode !== 'string' || !MODES.includes(mode)) {
      throw new InputError(`${path}: app ${id} has mode ${String(mode)}, expected one of ${MODES.join(', ')}`);
    }
    apps[id] = mode as Mode;
  }

  const configs: Record<string, string> = {};
  const configFolder = join(folder, name, 'config');
  if (existsSync(configFolder)) {
    for (const file of readdirSync(configFolder).filter((f) => f.endsWith('.config.php')).sort(compareStrings)) {
      configs[file] = join(configFolder, file);
    }
  }
  if (fields.enforce_theme !== undefined && fields.enforce_theme !== null && (typeof fields.enforce_theme !== 'string' || fields.enforce_theme === '')) {
    throw new InputError(`${path}: enforce_theme must be a theme name`);
  }
  return {
    enforceTheme: typeof fields.enforce_theme === 'string' ? fields.enforce_theme : undefined,
    extends: parsePlainNames(path, 'base name', parseNames(path, 'extends', fields.extends)),
    appFolders: parseNames(path, 'app_dirs', fields.app_dirs),
    themes: parsePlainNames(path, 'theme name', parseNames(path, 'themes', fields.themes)),
    env: parseEnv(path, fields.env),
    apps,
    configs,
  };
}

/**
 * Resolves a flavor. Its bases are applied depth first in the listed order, then the flavor itself, and the
 * last declaration wins. A base reached through more than one path is applied once, where it is first reached.
 * A cycle between manifests is an input error that names the cycle.
 */
export function resolveFlavor(flavorsRoot: string, name: string): ResolvedFlavor {
  const resolved: ResolvedFlavor = {
    name, order: [], apps: new Map(), appFolders: [], themes: [], env: new Map(), configs: new Map(), dirs: [],
  };

  const mergeIntoResolved = (manifest: Manifest): void => {
    for (const [id, mode] of Object.entries(manifest.apps)) resolved.apps.set(id, mode);
    for (const folder of manifest.appFolders) if (!resolved.appFolders.includes(folder)) resolved.appFolders.push(folder);
    for (const theme of manifest.themes) if (!resolved.themes.includes(theme)) resolved.themes.push(theme);
    if (manifest.enforceTheme !== undefined) resolved.enforceTheme = manifest.enforceTheme;
    for (const declaration of manifest.env) resolved.env.set(declaration.name, declaration);
    for (const [file, source] of Object.entries(manifest.configs)) resolved.configs.set(file, source);
  };

  /** `chain` holds the labels of the manifests being resolved above this one, to detect cycles. */
  const resolveManifest = (kind: ManifestKind, manifestName: string, chain: string[]): void => {
    const label = `${folderOf(kind)}/${manifestName}`;
    if (chain.includes(label)) throw new InputError(`cycle in extends: ${[...chain, label].join(' -> ')}`);
    if (resolved.order.includes(label)) return;

    const manifest = loadManifest(flavorsRoot, kind, manifestName, chain[chain.length - 1]);
    for (const base of manifest.extends) resolveManifest('base', base, [...chain, label]);
    mergeIntoResolved(manifest);
    resolved.order.push(label);
    resolved.dirs.push(join(flavorsRoot, folderOf(kind), manifestName));
  };

  resolveManifest('flavor', name, []);
  return resolved;
}
