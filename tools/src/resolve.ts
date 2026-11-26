import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { InputError } from './errors.ts';

export type Mode = 'always' | 'default' | 'available' | 'removed';
const MODES: readonly string[] = ['always', 'default', 'available', 'removed'];

export interface ResolvedFlavor {
  name: string;
  /** App id to mode; a later declaration replaces an earlier one. */
  apps: Map<string, Mode>;
  /** App folders the flavor activates, in declaration order. */
  appFolders: string[];
  /** Partial config files by file name, mapped to their source path; a later declaration replaces an earlier one. */
  configs: Map<string, string>;
}

interface Manifest {
  extends: string[];
  appFolders: string[];
  apps: Record<string, Mode>;
  /** Partial config files by file name, mapped to their source path. */
  configs: Record<string, string>;
}

function loadManifest(flavorsRoot: string, kind: 'flavor' | 'base', name: string, extendedBy?: string): Manifest {
  const folder = join(flavorsRoot, kind === 'flavor' ? 'flavors' : 'bases');
  const path = join(folder, name, 'flavor.yaml');
  if (!existsSync(path)) {
    const by = extendedBy ? ` (extended by flavor "${extendedBy}")` : '';
    throw new InputError(`${kind} "${name}" not found in ${folder}${by}`);
  }

  let document: unknown;
  try {
    document = parse(readFileSync(path, 'utf8')) ?? {};
  } catch (error) {
    throw new InputError(`${path} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const fields = document as { extends?: unknown; app_dirs?: unknown; apps?: unknown };

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
    apps,
    configs,
  };
}

/** Resolves a flavor: its bases in the listed order, then the flavor itself; the last declaration wins. */
export function resolveFlavor(flavorsRoot: string, name: string): ResolvedFlavor {
  const flavor = loadManifest(flavorsRoot, 'flavor', name);
  const resolved: ResolvedFlavor = { name, apps: new Map(), appFolders: [], configs: new Map() };

  const apply = (manifest: Manifest): void => {
    for (const [id, mode] of Object.entries(manifest.apps)) resolved.apps.set(id, mode);
    for (const folder of manifest.appFolders) if (!resolved.appFolders.includes(folder)) resolved.appFolders.push(folder);
    for (const [file, source] of Object.entries(manifest.configs)) resolved.configs.set(file, source);
  };
  for (const base of flavor.extends) apply(loadManifest(flavorsRoot, 'base', base, name));
  apply(flavor);
  return resolved;
}
