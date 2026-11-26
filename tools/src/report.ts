import { relative, sep } from 'node:path';
import { stringify } from 'yaml';
import type { ResolvedFlavor } from './resolve.ts';

const sortedObject = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** The fully resolved flavor as YAML, for a person to review. Paths are relative to the flavors root. */
export function formatResolvedFlavor(flavor: ResolvedFlavor, flavorsRoot: string): string {
  return stringify({
    flavor: flavor.name,
    order: flavor.order,
    apps: sortedObject(flavor.apps),
    app_folders: flavor.appFolders,
    themes: flavor.themes,
    config_files: sortedObject([...flavor.configs].map(([file, source]): [string, string] => [file, relative(flavorsRoot, source).split(sep).join('/')])),
    env: [...flavor.env.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  });
}
