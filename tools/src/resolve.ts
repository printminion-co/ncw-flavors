import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { InputError } from './errors.ts';

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
  /** Environment variables by name; a later declaration replaces an earlier one. */
  env: Map<string, EnvDeclaration>;
  /** Partial config files by file name, mapped to their source path; a later declaration replaces an earlier one. */
  configs: Map<string, string>;
}

interface Manifest {
  extends: string[];
  appFolders: string[];
  themes: string[];
  env: EnvDeclaration[];
  apps: Record<string, Mode>;
  /** Partial config files by file name, mapped to their source path. */
  configs: Record<string, string>;
}

const FLAVOR_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Checks that a flavor name is well formed and that the flavor exists in the flavors root. */
export function checkFlavorSelection(flavorsRoot: string, flavor: string): void {
  if (!FLAVOR_NAME.test(flavor)) {
    throw new InputError(`flavor name "${flavor}" must be lowercase letters, digits and single hyphens, starting with a letter`);
  }
  if (!existsSync(join(flavorsRoot, 'flavors', flavor, 'flavor.yaml'))) {
    throw new InputError(`flavor "${flavor}" not found in ${join(flavorsRoot, 'flavors')}`);
  }
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

function loadManifest(flavorsRoot: string, kind: 'flavor' | 'base', name: string, extendedBy?: string): Manifest {
  const folder = join(flavorsRoot, kind === 'flavor' ? 'flavors' : 'bases');
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
  const fields = document as { extends?: unknown; app_dirs?: unknown; themes?: unknown; env?: unknown; apps?: unknown };

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
    for (const file of readdirSync(configFolder).filter((f) => f.endsWith('.config.php')).sort()) {
      configs[file] = join(configFolder, file);
    }
  }
  return {
    extends: (fields.extends ?? []) as string[],
    appFolders: (fields.app_dirs ?? []) as string[],
    themes: (fields.themes ?? []) as string[],
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
    name, order: [], apps: new Map(), appFolders: [], themes: [], env: new Map(), configs: new Map(),
  };

  const apply = (manifest: Manifest): void => {
    for (const [id, mode] of Object.entries(manifest.apps)) resolved.apps.set(id, mode);
    for (const folder of manifest.appFolders) if (!resolved.appFolders.includes(folder)) resolved.appFolders.push(folder);
    for (const theme of manifest.themes) if (!resolved.themes.includes(theme)) resolved.themes.push(theme);
    for (const declaration of manifest.env) resolved.env.set(declaration.name, declaration);
    for (const [file, source] of Object.entries(manifest.configs)) resolved.configs.set(file, source);
  };

  const visit = (kind: 'flavor' | 'base', manifestName: string, chain: string[]): void => {
    const id = `${kind === 'flavor' ? 'flavors' : 'bases'}/${manifestName}`;
    if (chain.includes(id)) throw new InputError(`cycle in extends: ${[...chain, id].join(' -> ')}`);
    if (resolved.order.includes(id)) return;

    const manifest = loadManifest(flavorsRoot, kind, manifestName, chain[chain.length - 1]);
    for (const base of manifest.extends) visit('base', base, [...chain, id]);
    apply(manifest);
    resolved.order.push(id);
  };

  visit('flavor', name, []);
  return resolved;
}
