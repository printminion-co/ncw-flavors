import type { ResolvedFlavor } from './resolve.ts';

/** File names (inside `config/`) of the partial configs the tool generates, in the reserved number range 00 to 09. */
export const APPS_PATHS_CONFIG = '00-apps-paths.config.php';
export const THEMES_CONFIG = '01-themes.config.php';

/** The config keys the generated partial configs set; a flavor config may not set them. */
export const CONFIG_KEYS = {
  appsPaths: 'apps_paths',
  themes: 'ncw.themes',
  enforceTheme: 'enforce_theme',
} as const;

/** A PHP single-quoted string literal. */
export const phpString = (value: string): string => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/**
 * Renders a partial config file. A string value becomes a PHP string; a list becomes a PHP array with one item
 * per line, each item given as PHP source.
 */
export function renderPartialConfig(entries: [key: string, value: string | string[]][]): string {
  const lines = entries.map(([key, value]) =>
    typeof value === 'string'
      ? `  ${phpString(key)} => ${phpString(value)},\n`
      : `  ${phpString(key)} => [\n${value.map((item) => `    ${item},\n`).join('')}  ],\n`);
  return `<?php\n$CONFIG = [\n${lines.join('')}];\n`;
}

/** The generated config file names an artifact of the flavor must hold. */
export function generatedConfigs(flavor: ResolvedFlavor): string[] {
  return flavor.themes.length > 0 ? [APPS_PATHS_CONFIG, THEMES_CONFIG] : [APPS_PATHS_CONFIG];
}
