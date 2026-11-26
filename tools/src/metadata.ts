import { existsSync, readFileSync } from 'node:fs';
import { InputError } from './errors.ts';
import type { BuildKind } from './kind.ts';
import { compareStrings, isPlainObject, renderJson, withSortedKeys } from './util.ts';

/** The pipeline-supplied inputs for the build metadata, as the command line hands them over (not yet checked). */
export interface RawMetadataOptions {
  snapshotBranch?: string;
  releaseNumber?: string;
  scope?: string;
  serverCommit?: string;
  flavorsCommit?: string;
  appPins?: string;
  cacheKeys?: string;
}

export interface MetadataInputs {
  snapshotBranch?: string;
  releaseNumber?: number;
  scope?: string;
  serverCommit?: string;
  flavorsCommit?: string;
  apps: Record<string, { commit: string; describe: string }>;
  cachedBuilds: Record<string, { key: string; checksum: string }>;
}

const SHA = /^[0-9a-f]{7,64}$/i;

function readJsonObject(option: string, path: string): Record<string, unknown> {
  if (!existsSync(path)) throw new InputError(`${option}: file ${path} does not exist`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new InputError(`${option}: ${path} is not valid JSON`);
  }
  if (!isPlainObject(data)) {
    throw new InputError(`${option}: ${path} must hold a JSON object keyed by app id`);
  }
  return data;
}

/** Reads a file of `app id -> { fields }`, where every field is a non-empty string and no other field is allowed. */
function readEntries<F extends string>(option: string, path: string | undefined, fields: readonly F[]): Record<string, Record<F, string>> {
  const result: Record<string, Record<F, string>> = {};
  if (path === undefined) return result;
  const data = readJsonObject(option, path);
  for (const id of Object.keys(data).sort(compareStrings)) {
    const entry = data[id];
    if (!isPlainObject(entry)) {
      throw new InputError(`${option}: the entry of ${id} must be an object with ${fields.join(' and ')}`);
    }
    const record = entry;
    for (const name of Object.keys(record)) {
      if (!fields.includes(name as F)) throw new InputError(`${option}: the entry of ${id} has an unknown field ${name}`);
    }
    const checked = {} as Record<F, string>;
    for (const name of fields) {
      const value = record[name];
      if (typeof value !== 'string' || value.trim() === '') throw new InputError(`${option}: the entry of ${id} needs a non-empty ${name}`);
      checked[name] = value;
    }
    if ('commit' in checked && !SHA.test(checked['commit' as F])) {
      throw new InputError(`${option}: the commit of ${id} is not a hex sha, got "${checked['commit' as F]}"`);
    }
    result[id] = checked;
  }
  return result;
}

function checkSha(option: string, value: string | undefined): string | undefined {
  if (value !== undefined && !SHA.test(value)) throw new InputError(`${option} must be a hex commit sha, got "${value}"`);
  return value;
}

/** Checks the metadata inputs. A release build needs the snapshot branch, release number and scope. */
export function validateMetadataInputs(raw: RawMetadataOptions, kind: BuildKind): MetadataInputs {
  if (kind === 'release') {
    if (!raw.snapshotBranch) throw new InputError('a release build needs --snapshot-branch');
    if (raw.releaseNumber === undefined) throw new InputError('a release build needs --release-number');
    if (raw.scope === undefined) throw new InputError('a release build needs --scope');
  }
  if (raw.releaseNumber !== undefined && !/^[1-9][0-9]*$/.test(raw.releaseNumber)) {
    throw new InputError(`--release-number must be a positive integer, got "${raw.releaseNumber}"`);
  }
  if (raw.scope !== undefined && raw.scope.trim() === '') throw new InputError('--scope must not be empty');
  if (raw.snapshotBranch !== undefined && raw.snapshotBranch.trim() === '') throw new InputError('--snapshot-branch must not be empty');
  return {
    snapshotBranch: raw.snapshotBranch,
    releaseNumber: raw.releaseNumber === undefined ? undefined : Number(raw.releaseNumber),
    scope: raw.scope,
    serverCommit: checkSha('--server-commit', raw.serverCommit),
    flavorsCommit: checkSha('--flavors-commit', raw.flavorsCommit),
    apps: readEntries('--app-pins', raw.appPins, ['commit', 'describe'] as const),
    cachedBuilds: readEntries('--cache-keys', raw.cacheKeys, ['key', 'checksum'] as const),
  };
}

/** The content of `version.json`: sorted keys, two-space indent, final newline; absent inputs are left out. */
export function renderMetadata(inputs: MetadataInputs, flavor: string, baseRelease: string, buildNumber: number, kind: BuildKind): string {
  const fields: Record<string, unknown> = {
    flavor, base_release: baseRelease, build_number: buildNumber, kind,
    snapshot_branch: inputs.snapshotBranch, release_number: inputs.releaseNumber, scope: inputs.scope,
    server_commit: inputs.serverCommit, flavors_commit: inputs.flavorsCommit,
    apps: inputs.apps, cached_builds: inputs.cachedBuilds,
  };
  return renderJson(withSortedKeys(fields), 2);
}
