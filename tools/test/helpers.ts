import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { parse } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));

/** Root of the flavors repository branch (holds flavors/ and bases/). */
export const REPO_ROOT = resolve(here, '../..');
const CLI = resolve(here, '../src/cli.ts');

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `ncw-${prefix}-`));
}

function put(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** Writes a flavors root (flavors/ and bases/) from a map of relative path to content. */
export function makeFlavorsRoot(files: Record<string, string>): string {
  const root = tempDir('flavors');
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  return root;
}

/** Same shape as the example flavor committed in this repo, but owned by the tests. */
export const FIXTURE_FLAVORS: Record<string, string> = {
  'bases/common/flavor.yaml': 'apps:\n  files: always\n  dav: always\n  workflowengine: removed\n  firstrunwizard: removed\n',
  'bases/common/config/10-core.config.php': "<?php\n$CONFIG = [\n  'appstoreenabled' => false,\n  'upgrade.disable-web' => true,\n];\n",
  'flavors/flavor1/flavor.yaml': 'extends: [common]\napp_dirs: [apps-flavor1]\napps:\n  activity: default\n  demo: always\n',
  'flavors/flavor1/config/50-flavor.config.php': "<?php\n$CONFIG = [\n  'default_phone_region' => 'DE',\n];\n",
};

let fixtureFlavorsRoot: string | undefined;
export function defaultFlavorsRoot(): string {
  fixtureFlavorsRoot ??= makeFlavorsRoot(FIXTURE_FLAVORS);
  return fixtureFlavorsRoot;
}

const VERSION_PHP = `<?php
$OC_Version = array(33,0,9,1);
$OC_VersionString = '33.0.9';
$OC_Edition = '';
$OC_Channel = 'stable';
$OC_VersionCanBeUpgradedFrom = array (
  'nextcloud' => array ('32.0' => true, '33.0' => true),
);
$OC_Build = '2026-09-10T13:26:23+00:00 4d7d05e778398cdce1428b20d8687386edbc8268';
$vendor = 'nextcloud';
`;

const SHIPPED_LISTS = {
  shippedApps: ['activity', 'dav', 'files', 'firstrunwizard', 'workflowengine'],
  defaultEnabled: ['activity', 'dav', 'files', 'firstrunwizard'],
  alwaysEnabled: ['dav', 'files', 'workflowengine'],
};

/** Server version bounds of one fixture app; a string replaces the default "33", null leaves the attribute out. */
export interface AppBounds {
  min?: string | null;
  max?: string | null;
}

function appInfo(id: string, bounds: AppBounds = {}): string {
  const attr = (name: string, value: string | null | undefined): string =>
    value === null ? '' : ` ${name}="${value ?? '33'}"`;
  return `<?xml version="1.0"?>
<info><id>${id}</id><name>${id}</name><version>1.0.0</version>
<dependencies><nextcloud${attr('min-version', bounds.min)}${attr('max-version', bounds.max)}/></dependencies></info>
`;
}

/** A small stand-in for a built Nextcloud 33.0.9 server tree, as the official artifact lays it out. */
export function makeServerTree(appBounds: Record<string, AppBounds> = {}): string {
  const root = tempDir('tree');
  put(root, 'version.php', VERSION_PHP);
  put(root, 'core/shipped.json', JSON.stringify(SHIPPED_LISTS, null, 4) + '\n');
  for (const id of SHIPPED_LISTS.shippedApps) put(root, `apps/${id}/appinfo/info.xml`, appInfo(id, appBounds[id]));
  put(root, 'config/CAN_INSTALL', '');
  put(root, 'config/config.sample.php', '<?php\n$CONFIG = [];\n');
  put(root, 'updater/index.php', '<?php // web updater\n');
  put(root, 'lib/base.php', '<?php // server code\n');
  put(root, 'apps-flavor1/demo/appinfo/info.xml', appInfo('demo', appBounds['demo']));
  put(root, 'apps-other/other/appinfo/info.xml', appInfo('other', appBounds['other']));
  return root;
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export function runCli(args: string[]): CliResult {
  const spawned = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

export interface BuildOptions {
  /** Defaults to a fixture flavors root with `common` and `flavor1`. */
  flavorsRoot?: string;
  tree: string;
  out: string;
  flavor?: string;
  line?: string;
  kind?: string;
  buildNumber?: string;
  /** Further command line arguments, appended as they are. */
  extra?: string[];
}

/** What a release build needs besides the common options; tests that do not care about it get these. */
const RELEASE_DEFAULTS = ['--snapshot-branch', 'rc/ncw-v33-1', '--release-number', '1', '--scope', 'fixture release'];

/** Runs `build` with sensible defaults; the flavors come from a fixture root unless one is given. */
export function build(o: BuildOptions): CliResult {
  const extra = o.extra ?? (o.kind === 'release' ? RELEASE_DEFAULTS : []);
  return runCli([
    'build',
    '--flavors', o.flavorsRoot ?? defaultFlavorsRoot(),
    '--flavor', o.flavor ?? 'flavor1',
    '--tree', o.tree,
    '--line', o.line ?? '33',
    '--kind', o.kind ?? 'dev',
    '--build-number', o.buildNumber ?? '812',
    '--out', o.out,
    ...extra,
  ]);
}

/** Reads an artifact into a map of entry path to bytes. */
export function readZip(path: string): Map<string, Uint8Array> {
  return new Map(Object.entries(unzipSync(new Uint8Array(readFileSync(path)))));
}

export function text(zip: Map<string, Uint8Array>, entry: string): string {
  const bytes = zip.get(entry);
  if (!bytes) throw new Error(`entry not in artifact: ${entry}`);
  return strFromU8(bytes);
}

export const hasPhp: boolean = spawnSync('php', ['--version']).status === 0;

/**
 * Evaluates the artifact's version file in PHP, as Nextcloud would, and returns the version array and
 * the channel as JSON. `withBuildNumber: false` removes the build number file first.
 */
export function versionAsNextcloudSeesIt(zip: Map<string, Uint8Array>, withBuildNumber = true): string {
  const dir = tempDir('php');
  writeFileSync(join(dir, 'version.php'), zip.get('version.php') ?? '');
  if (withBuildNumber) writeFileSync(join(dir, '.buildnumber'), zip.get('.buildnumber') ?? '');
  const evaluated = spawnSync('php', ['-r', 'include $argv[1]; echo json_encode([$OC_Version, $OC_Channel]);', join(dir, 'version.php')], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (evaluated.status !== 0) throw new Error(`php failed: ${evaluated.stderr}`);
  return evaluated.stdout;
}

/**
 * Evaluates a partial config of the artifact in PHP, as Nextcloud does (the server root is available as
 * `OC::$SERVERROOT`), and returns the resulting `$CONFIG` array as JSON.
 */
export function configAsNextcloudSeesIt(zip: Map<string, Uint8Array>, entry: string, serverRoot = '/srv/nextcloud'): string {
  const dir = tempDir('php');
  const file = join(dir, 'partial.config.php');
  writeFileSync(file, zip.get(entry) ?? '');
  const code = 'class OC { public static $SERVERROOT = ' + JSON.stringify(serverRoot) + '; } include $argv[1]; echo json_encode($CONFIG);';
  const evaluated = spawnSync('php', ['-r', code, file], { encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  if (evaluated.status !== 0) throw new Error(`php failed: ${evaluated.stderr}`);
  return evaluated.stdout;
}

/** The DOS date and time stored for every entry of an artifact, read from its central directory. */
export function entryTimestamps(path: string): string[] {
  const buf = readFileSync(path);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip artifact');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const stamps: string[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('corrupt central directory');
    stamps.push(`${buf.readUInt16LE(offset + 14)}:${buf.readUInt16LE(offset + 12)}`);
    offset += 46 + buf.readUInt16LE(offset + 28) + buf.readUInt16LE(offset + 30) + buf.readUInt16LE(offset + 32);
  }
  return stamps;
}

/** What `resolve` prints for a flavor, parsed from its YAML. */
export interface ResolvedReport {
  flavor: string;
  order: string[];
  apps: Record<string, string>;
  app_folders: string[];
  themes: string[];
  enforce_theme?: string;
  config_files: Record<string, string>;
  env: { name: string; required: boolean; default?: string }[];
}

/** Runs `resolve` for a flavor of a flavors root and returns the raw result. */
export function resolveCli(flavorsRoot: string, flavor: string): CliResult {
  return runCli(['resolve', '--flavors', flavorsRoot, '--flavor', flavor]);
}

/** Runs `resolve`, which must succeed, and returns the printed flavor parsed as YAML. */
export function resolveReport(flavorsRoot: string, flavor: string): ResolvedReport {
  const result = resolveCli(flavorsRoot, flavor);
  if (result.status !== 0) throw new Error(`resolve failed: ${result.stderr}`);
  return parse(result.stdout) as ResolvedReport;
}
