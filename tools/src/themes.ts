import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './errors.ts';
import type { ResolvedFlavor } from './resolve.ts';
import { compareStrings, relativePosix } from './util.ts';
import { writeText, type Tree } from './tree.ts';
import { CONFIG_KEYS, THEMES_CONFIG, phpString, renderPartialConfig } from './generated.ts';

/**
 * Where theme classes go in the tree, and the namespace of the classes in it. Not the theming app: its autoloader is
 * a classmap that only knows the classes it was built with, so a class added to apps/theming/lib is never found.
 * The server's own `OC\` namespace is autoloaded by PSR-4 from lib/private.
 */
const CLASS_FOLDER = 'lib/private/Ncw/Themes';
const CLASS_NAMESPACE = 'OC\\Ncw\\Themes';
/** Where the mail template classes of a theme package (its `mail/` folder) go; they are activated by config, not registered. */
const MAIL_FOLDER = 'lib/private/Ncw/Mail';

/** The package folders whose files are classes: only files directly in them count. */
const CLASS_PACKAGE_FOLDERS = ['lib', 'mail'] as const;

function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relativePosix(folder, join(entry.parentPath, entry.name)))
    .sort(compareStrings);
}

/** Every theme of the flavor needs a package folder `themes/<name>/`, and the enforced theme must be one of them. */
export function checkThemes(flavor: ResolvedFlavor, flavorsRoot: string): void {
  for (const theme of flavor.themes) {
    if (!existsSync(join(flavorsRoot, 'themes', theme))) {
      throw new InputError(`theme "${theme}" has no package folder ${join(flavorsRoot, 'themes', theme)}`);
    }
  }
  for (const theme of flavor.themes) {
    for (const folder of CLASS_PACKAGE_FOLDERS) {
      const dir = join(flavorsRoot, 'themes', theme, folder);
      const nested = !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true, recursive: true })
        .filter((entry) => entry.parentPath !== dir)
        .map((entry) => `${folder}/${relativePosix(dir, join(entry.parentPath, entry.name))}`)
        .sort(compareStrings);
      if (nested.length > 0) {
        throw new InputError(`theme "${theme}": only files directly in ${folder}/ are classes, but found ${nested.join(', ')}`);
      }
    }
  }
  if (flavor.enforceTheme !== undefined && !flavor.themes.includes(flavor.enforceTheme)) {
    throw new InputError(`enforce_theme "${flavor.enforceTheme}" is not one of the themes of flavor ${flavor.name} (${flavor.themes.join(', ') || 'none'})`);
  }
}

/** Every file a theme package puts in the tree: the tree path, the package file and whether the class is a theme to register. */
function packageFiles(flavorsRoot: string, theme: string): { path: string; source: string; registered: boolean }[] {
  const folder = join(flavorsRoot, 'themes', theme);
  const files: { path: string; source: string; registered: boolean }[] = [];
  for (const file of filesUnder(join(folder, 'lib')).filter((f) => f.endsWith('.php'))) {
    files.push({ path: `${CLASS_FOLDER}/${file}`, source: join(folder, 'lib', file), registered: true });
  }
  for (const file of filesUnder(join(folder, 'mail')).filter((f) => f.endsWith('.php'))) {
    files.push({ path: `${MAIL_FOLDER}/${file}`, source: join(folder, 'mail', file), registered: false });
  }
  for (const file of filesUnder(join(folder, 'assets'))) {
    files.push({ path: `themes/${theme}/${file}`, source: join(folder, 'assets', file), registered: false });
  }
  return files;
}

/** Reports every file of the themes of the flavor that the artifact lacks or holds with other content. */
export function checkThemeFiles(files: Map<string, Uint8Array>, flavor: ResolvedFlavor, flavorsRoot: string, violations: string[]): void {
  for (const theme of flavor.themes) {
    for (const { path, source } of packageFiles(flavorsRoot, theme)) {
      const actual = files.get(path);
      if (actual === undefined) violations.push(`missing file ${path} of theme ${theme}`);
      else if (!Buffer.from(actual).equals(readFileSync(source))) violations.push(`file ${path} differs from theme ${theme}`);
    }
  }
}

/** Copies the themes of the flavor into the tree and generates the partial config that registers them. */
export function applyThemes(tree: Tree, flavor: ResolvedFlavor, flavorsRoot: string): void {
  if (flavor.themes.length === 0) return;
  const classes: string[] = [];
  for (const theme of flavor.themes) {
    for (const { path, source, registered } of packageFiles(flavorsRoot, theme)) {
      tree.set(path, new Uint8Array(readFileSync(source)));
      if (registered) classes.push(`${CLASS_NAMESPACE}\\${path.slice(CLASS_FOLDER.length + 1, -'.php'.length)}`);
    }
  }
  const entries: [string, string | string[]][] = [[CONFIG_KEYS.themes, classes.map(phpString)]];
  if (flavor.enforceTheme !== undefined) entries.push([CONFIG_KEYS.enforceTheme, flavor.enforceTheme]);
  writeText(tree, `config/${THEMES_CONFIG}`, renderPartialConfig(entries));
}
