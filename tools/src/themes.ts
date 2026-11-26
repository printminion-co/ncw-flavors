import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './errors.ts';
import type { ResolvedFlavor } from './resolve.ts';
import { compareStrings, relativePosix } from './util.ts';
import { writeText, type Tree } from './tree.ts';

/** The generated partial config that tells the server which theme classes to register. */
export const THEMES_CONFIG = 'config/01-themes.config.php';

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

const phpString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Every theme of the flavor needs a package folder `themes/<name>/`, and the enforced theme must be one of them. */
export function checkThemes(flavor: ResolvedFlavor, flavorsRoot: string): void {
  for (const theme of flavor.themes) {
    if (!existsSync(join(flavorsRoot, 'themes', theme))) {
      throw new InputError(`theme "${theme}" has no package folder ${join(flavorsRoot, 'themes', theme)}`);
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
  const list = classes.map((name) => `    ${phpString(name)},`).join('\n');
  const enforced = flavor.enforceTheme === undefined ? '' : `  'enforce_theme' => ${phpString(flavor.enforceTheme)},\n`;
  writeText(tree, THEMES_CONFIG, `<?php\n$CONFIG = [\n  'ncw.themes' => [\n${list}\n  ],\n${enforced}];\n`);
}
