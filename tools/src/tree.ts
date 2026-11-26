import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './errors.ts';
import { relativePosix } from './util.ts';

/** The files of a tree, read-only: path relative to the root to content. */
export type Files = ReadonlyMap<string, Uint8Array>;

/** The files of a tree the build works on, by path relative to its root. */
export type Tree = Map<string, Uint8Array>;

/** The three lists `core/shipped.json` holds. */
export interface ShippedLists {
  shippedApps: string[];
  defaultEnabled: string[];
  alwaysEnabled: string[];
}

export function readText(tree: Files, path: string): string {
  const bytes = tree.get(path);
  if (!bytes) throw new InputError(`the tree has no ${path}`);
  return new TextDecoder().decode(bytes);
}

export function writeText(tree: Tree, path: string, content: string): void {
  tree.set(path, new TextEncoder().encode(content));
}

export function deleteWhere(tree: Tree, matches: (path: string) => boolean): void {
  for (const path of [...tree.keys()]) if (matches(path)) tree.delete(path);
}

/** The one place the shipped-apps lists are read from a tree. */
export function readShippedLists(tree: Files): ShippedLists {
  const text = readText(tree, 'core/shipped.json');
  try {
    return JSON.parse(text) as ShippedLists;
  } catch {
    throw new InputError('core/shipped.json in the tree is not valid JSON');
  }
}

/** Fails unless the directory is a Nextcloud server tree (it has a version file). */
export function assertServerTree(dir: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory() || !existsSync(join(dir, 'version.php'))) {
    throw new InputError(`the tree ${dir} does not exist or is not a Nextcloud tree (no version.php)`);
  }
}

/** Reads every file below a directory into a tree. */
export function loadTree(root: string): Tree {
  const tree: Tree = new Map();
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else tree.set(relativePosix(root, path), new Uint8Array(readFileSync(path)));
    }
  };
  walk(root);
  return tree;
}

/** A server tree read from disk together with its base release (the `$OC_VersionString` of its version file). */
export interface ServerTree {
  files: Tree;
  release: string;
}

/** Loads a server tree for build and check-compat, after the check that it is one. */
export function loadServerTree(dir: string): ServerTree {
  assertServerTree(dir);
  const files = loadTree(dir);
  const match = /\$OC_VersionString\s*=\s*'([^']+)'/.exec(readText(files, 'version.php'));
  if (!match?.[1]) throw new InputError('the tree has no $OC_VersionString in its version file');
  return { files, release: match[1] };
}
