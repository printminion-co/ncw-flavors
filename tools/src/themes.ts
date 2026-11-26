import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './errors.ts';
import type { ResolvedFlavor } from './resolve.ts';
import { compareStrings, relativePosix } from './util.ts';
import { writeText, type Tree } from './tree.ts';
import { CONFIG_KEYS, THEMES_CONFIG, phpString, renderPartialConfig } from './generated.ts';

/** Where theme classes go in the tree, and the namespace of the classes in it. */
const CLASS_FOLDER = 'apps/theming/lib/Themes';
const CLASS_NAMESPACE = 'OCA\\Theming\\Themes';

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
    const lib = join(flavorsRoot, 'themes', theme, 'lib');
    const nested = !existsSync(lib) ? [] : readdirSync(lib, { withFileTypes: true, recursive: true })
      .filter((entry) => entry.parentPath !== lib)
      .map((entry) => `lib/${relativePosix(lib, join(entry.parentPath, entry.name))}`)
      .sort(compareStrings);
    if (nested.length > 0) {
      throw new InputError(`theme "${theme}": only files directly in lib/ are classes, but found ${nested.join(', ')}`);
    }
  }
  if (flavor.enforceTheme !== undefined && !flavor.themes.includes(flavor.enforceTheme)) {
    throw new InputError(`enforce_theme "${flavor.enforceTheme}" is not one of the themes of flavor ${flavor.name} (${flavor.themes.join(', ') || 'none'})`);
  }
}

/** Copies the themes of the flavor into the tree and generates the partial config that registers them. */
export function applyThemes(tree: Tree, flavor: ResolvedFlavor, flavorsRoot: string): void {
  if (flavor.themes.length === 0) return;
  const classes: string[] = [];
  for (const theme of flavor.themes) {
    const folder = join(flavorsRoot, 'themes', theme);
    for (const file of filesUnder(join(folder, 'lib')).filter((f) => f.endsWith('.php'))) {
      tree.set(`${CLASS_FOLDER}/${file}`, new Uint8Array(readFileSync(join(folder, 'lib', file))));
      classes.push(`${CLASS_NAMESPACE}\\${file.slice(0, -'.php'.length)}`);
    }
    for (const file of filesUnder(join(folder, 'assets'))) {
      tree.set(`themes/${theme}/${file}`, new Uint8Array(readFileSync(join(folder, 'assets', file))));
    }
  }
  const entries: [string, string | string[]][] = [[CONFIG_KEYS.themes, classes.map(phpString)]];
  if (flavor.enforceTheme !== undefined) entries.push([CONFIG_KEYS.enforceTheme, flavor.enforceTheme]);
  writeText(tree, `config/${THEMES_CONFIG}`, renderPartialConfig(entries));
}
