import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export type Mode = 'always' | 'default' | 'available' | 'removed';
const MODES: readonly string[] = ['always', 'default', 'available', 'removed'];

export interface ResolvedFlavor {
  name: string;
  /** App id to mode; a later declaration replaces an earlier one. */
  apps: Map<string, Mode>;
  /** App folders the flavor activates, in declaration order. */
  appDirs: string[];
  /** Partial config files by file name, mapped to their source path; a later declaration replaces an earlier one. */
  configs: Map<string, string>;
}

interface Manifest {
  extends: string[];
  appDirs: string[];
  apps: Record<string, Mode>;
  /** Partial config files by file name, mapped to their source path. */
  configs: Record<string, string>;
}

function loadManifest(flavorsRoot: string, folder: 'flavors' | 'bases', name: string): Manifest {
  const path = join(flavorsRoot, folder, name, 'flavor.yaml');
  const doc: unknown = parse(readFileSync(path, 'utf8')) ?? {};
  const d = doc as { extends?: unknown; app_dirs?: unknown; apps?: unknown };

  const apps: Record<string, Mode> = {};
  for (const [id, mode] of Object.entries((d.apps ?? {}) as Record<string, unknown>)) {
    if (typeof mode !== 'string' || !MODES.includes(mode)) {
      throw new Error(`${path}: app ${id} has mode ${String(mode)}, expected one of ${MODES.join(', ')}`);
    }
    apps[id] = mode as Mode;
  }
  const configs: Record<string, string> = {};
  const configDir = join(flavorsRoot, folder, name, 'config');
  if (existsSync(configDir)) {
    for (const file of readdirSync(configDir).filter((f) => f.endsWith('.config.php')).sort()) configs[file] = join(configDir, file);
  }
  return {
    extends: (d.extends ?? []) as string[],
    appDirs: (d.app_dirs ?? []) as string[],
    apps,
    configs,
  };
}

/** Resolves a flavor: its bases in the listed order, then the flavor itself; the last declaration wins. */
export function resolveFlavor(flavorsRoot: string, name: string): ResolvedFlavor {
  const flavor = loadManifest(flavorsRoot, 'flavors', name);
  const resolved: ResolvedFlavor = { name, apps: new Map(), appDirs: [], configs: new Map() };

  const apply = (m: Manifest): void => {
    for (const [id, mode] of Object.entries(m.apps)) resolved.apps.set(id, mode);
    for (const dir of m.appDirs) if (!resolved.appDirs.includes(dir)) resolved.appDirs.push(dir);
    for (const [file, source] of Object.entries(m.configs)) resolved.configs.set(file, source);
  };
  for (const base of flavor.extends) apply(loadManifest(flavorsRoot, 'bases', base));
  apply(flavor);
  return resolved;
}
