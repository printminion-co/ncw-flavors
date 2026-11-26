import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InputError } from './errors.ts';
import type { ResolvedFlavor } from './resolve.ts';
import { compareStrings, isPlainObject, relativePosix } from './util.ts';

/** A plain app setting as `occ config:import` takes it; null deletes the key. */
export type PlainValue = string | number | null;

/** A setting the import cannot set: it needs `occ config:app:set` with --sensitive, --lazy or --type. */
export interface SpecialSetting {
  app: string;
  key: string;
  value: string;
  type?: 'string' | 'integer' | 'float' | 'boolean' | 'array';
  lazy?: boolean;
  sensitive?: boolean;
}

export interface AppConfig {
  /** App id to key to value, sorted: the `apps` section of the import file. */
  apps: Record<string, Record<string, PlainValue>>;
  /** Sorted by app and key. */
  special: SpecialSetting[];
  /** Every environment variable the settings refer to as `${NAME}`, with the file that first does. */
  envReferences: Map<string, string>;
}

const TYPES = ['string', 'integer', 'float', 'boolean', 'array'];
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const WHOLE_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

function placeholdersIn(value: string, file: string, into: Map<string, string>): void {
  for (const m of value.matchAll(PLACEHOLDER)) if (!into.has(m[1] as string)) into.set(m[1] as string, file);
}

/**
 * Assembles the app-config of a flavor from the `app-config.json` of its manifests, in the order they were
 * applied. Per app and key the last declaration wins; a special setting replaces an earlier one of the same
 * app and key. Sensitive values must be a `${VAR}` placeholder, so a secret never enters the artifact.
 */
export function assembleAppConfig(flavor: ResolvedFlavor, flavorsRoot: string): AppConfig {
  const apps: Record<string, Record<string, PlainValue>> = {};
  const special = new Map<string, SpecialSetting>();
  const envReferences = new Map<string, string>();

  for (const dir of flavor.dirs) {
    const path = join(dir, 'app-config.json');
    if (!existsSync(path)) continue;
    const rel = relativePosix(flavorsRoot, path);
    const fail = (message: string): never => { throw new InputError(`${rel}: ${message}`); };

    let document: unknown;
    try {
      document = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return fail('is not valid JSON');
    }
    if (!isPlainObject(document)) return fail('must be a JSON object');
    for (const section of Object.keys(document)) {
      if (section !== 'apps' && section !== 'special') fail(`unknown section "${section}", only "apps" and "special" are allowed (the system section is never used)`);
    }

    const plain = document.apps ?? {};
    if (!isPlainObject(plain)) return fail('"apps" must be an object of app to key to value');
    for (const [app, keys] of Object.entries(plain)) {
      if (!isPlainObject(keys)) return fail(`apps.${app} must be an object of key to value`);
      for (const [key, value] of Object.entries(keys)) {
        if (value !== null && typeof value !== 'string' && !Number.isInteger(value)) {
          fail(`apps.${app}.${key} must be a string, an integer or null`);
        }
        if (typeof value === 'string') placeholdersIn(value, rel, envReferences);
        (apps[app] ??= {})[key] = value as PlainValue;
      }
    }

    const list = document.special ?? [];
    if (!Array.isArray(list)) return fail('"special" must be a list');
    for (const entry of list) {
      if (!isPlainObject(entry) || typeof entry.app !== 'string' || typeof entry.key !== 'string' || typeof entry.value !== 'string') {
        return fail('every special entry needs a string app, key and value');
      }
      const where = `special ${entry.app}.${entry.key}`;
      if (entry.type !== undefined && !TYPES.includes(entry.type as string)) fail(`${where}: type must be one of ${TYPES.join(', ')}`);
      for (const flag of ['lazy', 'sensitive'] as const) {
        if (entry[flag] !== undefined && typeof entry[flag] !== 'boolean') fail(`${where}: ${flag} must be true or false`);
      }
      if (entry.sensitive === true && !WHOLE_PLACEHOLDER.test(entry.value)) {
        fail(`${where} is sensitive, so its value must be a \${VAR} placeholder filled from the environment, not a literal`);
      }
      placeholdersIn(entry.value, rel, envReferences);
      const setting: SpecialSetting = { app: entry.app, key: entry.key, value: entry.value };
      if (entry.type !== undefined) setting.type = entry.type as SpecialSetting['type'];
      if (entry.lazy === true) setting.lazy = true;
      if (entry.sensitive === true) setting.sensitive = true;
      special.set(`${entry.app}\0${entry.key}`, setting);
    }
  }

  for (const setting of special.values()) {
    if (apps[setting.app]?.[setting.key] !== undefined) {
      throw new InputError(`${setting.app}.${setting.key} is set both as a plain value and as a special setting`);
    }
  }

  const sortedApps: AppConfig['apps'] = {};
  for (const app of Object.keys(apps).sort(compareStrings)) {
    const keys = apps[app] as Record<string, PlainValue>;
    sortedApps[app] = Object.fromEntries(Object.keys(keys).sort(compareStrings).map((k) => [k, keys[k] as PlainValue]));
  }
  const sortedSpecial = [...special.values()].sort((a, b) => compareStrings(a.app, b.app) || compareStrings(a.key, b.key));
  return { apps: sortedApps, special: sortedSpecial, envReferences };
}

/** The apps the flavor removes that the server tree ships, sorted. */
export function removedApps(flavor: ResolvedFlavor, shippedApps: string[]): string[] {
  return [...flavor.apps].filter(([id, mode]) => mode === 'removed' && shippedApps.includes(id)).map(([id]) => id).sort(compareStrings);
}
