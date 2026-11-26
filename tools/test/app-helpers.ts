import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Adds an app (an `appinfo/info.xml`) to a folder of a fixture server tree, such as `apps` or `apps-flavor1`. */
export function addApp(tree: string, folder: string, id: string): void {
  const path = join(tree, folder, id, 'appinfo', 'info.xml');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `<?xml version="1.0"?>
<info><id>${id}</id><version>1.0.0</version>
<dependencies><nextcloud min-version="33" max-version="33"/></dependencies></info>
`);
}

/** Replaces the three shipped-apps lists of a fixture server tree. */
export function setShippedLists(tree: string, lists: { shippedApps: string[]; defaultEnabled: string[]; alwaysEnabled: string[] }): void {
  writeFileSync(join(tree, 'core/shipped.json'), JSON.stringify(lists, null, 4) + '\n');
}

export function readShippedLists(tree: string): unknown {
  return JSON.parse(readFileSync(join(tree, 'core/shipped.json'), 'utf8'));
}
