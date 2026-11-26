import { stringify } from 'yaml';
import type { ResolvedFlavor } from './resolve.ts';
import { compareStrings, relativePosix } from './util.ts';

const sortedObject = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].sort(([a], [b]) => compareStrings(a, b)));

/** The fully resolved flavor as YAML, for a person to review. Paths are relative to the flavors root. */
export function formatResolvedFlavor(flavor: ResolvedFlavor, flavorsRoot: string): string {
  const relativeSource = (source: string): string => relativePosix(flavorsRoot, source);
  return stringify({
    flavor: flavor.name,
    order: flavor.order,
    apps: sortedObject(flavor.apps),
    app_folders: flavor.appFolders,
    themes: flavor.themes,
    enforce_theme: flavor.enforceTheme,
    config_files: sortedObject([...flavor.configs].map(([file, source]): [string, string] => [file, relativeSource(source)])),
    env: [...flavor.env.values()].sort((a, b) => compareStrings(a.name, b.name)),
  });
}
