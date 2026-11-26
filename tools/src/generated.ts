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

/** The generated config file names an artifact of the flavor must hold. */
export function generatedConfigs(flavor: ResolvedFlavor): string[] {
  return flavor.themes.length > 0 ? [APPS_PATHS_CONFIG, THEMES_CONFIG] : [APPS_PATHS_CONFIG];
}
