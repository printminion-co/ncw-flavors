import { relative, sep } from 'node:path';

/** Orders strings by code unit, the same everywhere (no locale), so sorted output is stable. */
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A JSON object: not null, not an array. */
export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The path from one folder to a file, always written with forward slashes. */
export const relativePosix = (from: string, to: string): string => relative(from, to).split(sep).join('/');

/** A copy of the value with the keys of every object sorted and the keys whose value is undefined left out. */
export function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([key, entry]) => [key, withSortedKeys(entry)]),
  );
}

/** Pretty JSON with the given indent and a final newline: the way the build writes every JSON file. */
export const renderJson = (value: unknown, indent: number): string => JSON.stringify(value, null, indent) + '\n';
