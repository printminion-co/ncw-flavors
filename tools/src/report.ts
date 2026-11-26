import { relative, sep } from 'node:path';
import { stringify } from 'yaml';
import type { ResolvedFlavor } from './resolve.ts';

const compareNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const sortedObject = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => compareNames(a, b)));

/** The fully resolved flavor as YAML, for a person to review. Paths are relative to the flavors root. */
export function formatResolvedFlavor(flavor: ResolvedFlavor, flavorsRoot: string): string {
  const relativeSource = (source: string): string => relative(flavorsRoot, source).split(sep).join('/');
  return stringify({
    flavor: flavor.name,
    order: flavor.order,
    apps: sortedObject(flavor.apps),
    app_folders: flavor.appFolders,
    themes: flavor.themes,
    config_files: sortedObject([...flavor.configs].map(([file, source]): [string, string] => [file, relativeSource(source)])),
    env: [...flavor.env.values()].sort((a, b) => compareNames(a.name, b.name)),
  });
}
