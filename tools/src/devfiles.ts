/** Names that never ship, as a file or a folder at any depth. */
const DEV_NAMES: readonly string[] = ['.git', '.github', '.gitignore', '.gitmodules', 'node_modules'];

/** Folders that never ship below an app (`apps/<id>/...` or `<active app folder>/<id>/...`). */
const DEV_APP_FOLDERS: readonly string[] = ['tests', 'test'];

/** The install flag file and the web updater folder of the official artifact. */
const DEV_PATHS: readonly string[] = ['config/CAN_INSTALL', 'updater'];

/** Top-level folders that never ship: `IONOS` is the flavors repository submodule of the server fork. */
const DEV_TOP_FOLDERS: readonly string[] = ['IONOS'];

/**
 * The single definition of dev files: `build` strips these, `validate` forbids them. `appFolders` are the active
 * app folders of the flavor; `apps` is always an app folder.
 */
export function isDevFile(path: string, appFolders: readonly string[]): boolean {
  const parts = path.split('/');
  const folders = parts.slice(0, -1);
  return (
    DEV_PATHS.some((entry) => path === entry || path.startsWith(`${entry}/`)) ||
    (parts.length > 1 && DEV_TOP_FOLDERS.includes(parts[0] ?? '')) ||
    parts.some((part) => DEV_NAMES.includes(part)) ||
    (['apps', ...appFolders].includes(parts[0] ?? '') && folders.slice(2).some((part) => DEV_APP_FOLDERS.includes(part)))
  );
}
