import { InputError } from './errors.ts';
import type { ResolvedFlavor } from './resolve.ts';
import type { Files, ShippedLists } from './tree.ts';


/**
 * The apps of the tree and of the flavor's active app folders: app id to the folders it is in. An app is a
 * folder with an `appinfo/info.xml` directly below `apps` or an active app folder.
 */
export function discoverApps(tree: Files, flavor: ResolvedFlavor): Map<string, string[]> {
  const folders = ['apps', ...flavor.appFolders];
  const found = new Map<string, string[]>();
  const ids = new Set<string>();
  for (const path of [...tree.keys()].sort()) {
    const parts = path.split('/');
    if (parts.length === 4 && parts[2] === 'appinfo' && parts[3] === 'info.xml') ids.add(`${parts[0]}/${parts[1]}`);
  }
  // server tree first, then the folders in the order the flavor declares them
  for (const folder of folders) {
    for (const entry of [...ids].sort()) {
      const [at, id] = entry.split('/') as [string, string];
      if (at === folder) found.set(id, [...(found.get(id) ?? []), folder]);
    }
  }
  return found;
}

/** Fails when an app id exists in more than one place, and names every place. */
export function assertNoDuplicateApps(apps: Map<string, string[]>): void {
  const duplicates = [...apps].filter(([, folders]) => folders.length > 1);
  if (duplicates.length === 0) return;
  const lines = duplicates.map(([id, folders]) => `app ${id} is in ${folders.map((f) => `${f}/${id}`).join(' and ')}`);
  throw new InputError(`the same app id exists in more than one place: ${lines.join('; ')}`);
}

/**
 * Every app needs an explicit mode. Returns the warnings for a dev build; fails a release build, naming
 * the unclassified apps.
 */
export function checkClassification(apps: Map<string, string[]>, flavor: ResolvedFlavor, kind: 'dev' | 'release'): string[] {
  const unclassified = [...apps.keys()].filter((id) => !flavor.apps.has(id)).sort();
  if (kind === 'release' && unclassified.length > 0) {
    throw new InputError(`release builds need a mode for every app, unclassified apps: ${unclassified.join(', ')}`);
  }
  return unclassified.map((id) => `warning: app ${id} has no mode`);
}

/**
 * Self-check of the generated lists: an app that is removed must be in none of them. The build removes such
 * apps by construction, so a failure here is a bug of the tool (or a hand-made list), not an input mistake.
 */
export function assertRemovedAppsAreUnlisted(lists: ShippedLists, flavor: ResolvedFlavor): void {
  for (const [id, mode] of flavor.apps) {
    if (mode !== 'removed') continue;
    for (const [name, list] of Object.entries(lists)) {
      if ((list as string[]).includes(id)) throw new Error(`removed app ${id} is still in ${name}`);
    }
  }
}
