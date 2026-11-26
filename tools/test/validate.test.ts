import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { build, defaultFlavorsRoot, makeServerTree, readZip, runCli, tempDir, text, type CliResult } from './helpers.ts';

type Entries = Map<string, Uint8Array>;

/** Builds the fixture flavor and returns the files of the produced artifact. */
function produced(kind = 'dev'): { zip: string; files: Entries } {
  const out = tempDir('out');
  const result = build({ tree: makeServerTree(), out, kind });
  assert.equal(result.status, 0, result.stderr);
  const zip = result.stdout.trim();
  return { zip, files: readZip(zip) };
}

const put = (files: Entries, path: string, content: string): void => void files.set(path, strToU8(content));

function writeZip(files: Entries): string {
  const path = join(tempDir('tampered'), 'artifact.zip');
  writeFileSync(path, zipSync(Object.fromEntries(files)));
  return path;
}

function writeTree(files: Entries): string {
  const root = tempDir('unpacked');
  for (const [path, bytes] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  return root;
}

function validate(artifact: string, flavor = 'flavor1'): CliResult {
  return runCli(['validate', '--flavors', defaultFlavorsRoot(), '--flavor', flavor, '--artifact', artifact]);
}

/** Runs validate on the tampered files as a zip and as an unpacked tree; both must give the same answer. */
function validateBoth(files: Entries): CliResult {
  const zipPath = writeZip(files);
  const treePath = writeTree(files);
  const asZip = validate(zipPath);
  const asTree = validate(treePath);
  assert.equal(asTree.status, asZip.status);
  assert.equal(asTree.stderr.replaceAll(treePath, '<artifact>'), asZip.stderr.replaceAll(zipPath, '<artifact>'));
  return asZip;
}

function assertFails(files: Entries, ...expected: RegExp[]): void {
  const result = validateBoth(files);
  assert.equal(result.status, 2, result.stderr);
  for (const pattern of expected) assert.match(result.stderr, pattern);
}

test('a freshly built artifact validates, as a zip and as an unpacked tree', () => {
  const { zip, files } = produced();
  const asZip = validate(zip);
  assert.equal(asZip.status, 0, asZip.stderr);
  const asTree = validate(writeTree(files));
  assert.equal(asTree.status, 0, asTree.stderr);
});

test('a release artifact validates', () => {
  const result = validate(produced('release').zip);
  assert.equal(result.status, 0, result.stderr);
});

test('a path that is neither a zip nor a directory is an input error', () => {
  const missing = validate('/nonexistent/artifact.zip');
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /artifact \/nonexistent\/artifact\.zip does not exist/);
  const notZip = join(tempDir('bad'), 'x.zip');
  writeFileSync(notZip, 'not a zip');
  const bad = validate(notZip);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /is not a zip file/);
});

test('validate requires --artifact', () => {
  const result = runCli(['validate', '--flavors', defaultFlavorsRoot(), '--flavor', 'flavor1']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing option --artifact/);
});

// config directory

test('an unexpected file in config/ fails and is named', () => {
  const { files } = produced();
  put(files, 'config/99-extra.config.php', '<?php\n');
  put(files, 'config/secrets.php', '<?php\n');
  assertFails(files, /unexpected file config\/99-extra\.config\.php/, /unexpected file config\/secrets\.php/);
});

test('a missing partial config of the flavor fails and is named', () => {
  const { files } = produced();
  files.delete('config/50-flavor.config.php');
  assertFails(files, /missing config file config\/50-flavor\.config\.php/);
});

test('a missing generated apps paths config fails and is named', () => {
  const { files } = produced();
  files.delete('config/00-apps-paths.config.php');
  assertFails(files, /missing config file config\/00-apps-paths\.config\.php/);
});

test('upstream sample files in config/ are allowed', () => {
  const { files } = produced();
  put(files, 'config/.htaccess', 'Require all denied\n');
  const result = validateBoth(files);
  assert.equal(result.status, 0, result.stderr);
});

// apps

test('an app that is not in the flavor fails and is named', () => {
  const { files } = produced('release');
  put(files, 'apps/stranger/appinfo/info.xml', '<info/>');
  assertFails(files, /app stranger has no mode in flavor flavor1/);
});

test('a removed app that is present fails and is named', () => {
  const { files } = produced();
  put(files, 'apps/workflowengine/appinfo/info.xml', '<info/>');
  assertFails(files, /app workflowengine is removed in flavor flavor1 but present/);
});

test('an app of the flavor that is missing fails and is named', () => {
  const { files } = produced();
  files.delete('apps/activity/appinfo/info.xml');
  files.delete('apps-flavor1/demo/appinfo/info.xml');
  assertFails(files, /app activity is missing/, /app demo is missing/);
});

test('an app without a mode is a warning in a dev artifact and a failure in a release artifact', () => {
  const dev = produced('dev').files;
  put(dev, 'apps/stranger/appinfo/info.xml', '<info/>');
  const devResult = validate(writeZip(dev), 'flavor1');
  assert.equal(devResult.status, 0, devResult.stderr);
  assert.match(devResult.stderr, /warning: app stranger has no mode/);

  const release = produced('release').files;
  put(release, 'apps/stranger/appinfo/info.xml', '<info/>');
  assertFails(release, /app stranger has no mode/);
});

// shipped lists

function setLists(files: Entries, lists: { shippedApps: string[]; defaultEnabled: string[]; alwaysEnabled: string[] }): void {
  put(files, 'core/shipped.json', JSON.stringify(lists, null, 4) + '\n');
}

const GOOD_LISTS = { shippedApps: ['activity', 'dav', 'files'], defaultEnabled: ['activity'], alwaysEnabled: ['dav', 'demo', 'files'] };

test('the lists the build writes pass the shipped lists check', () => {
  const { files } = produced();
  setLists(files, GOOD_LISTS);
  const result = validateBoth(files);
  assert.equal(result.status, 0, result.stderr);
});

test('a removed app in a shipped list fails and the message names the app and the list', () => {
  const { files } = produced();
  setLists(files, { ...GOOD_LISTS, shippedApps: [...GOOD_LISTS.shippedApps, 'workflowengine'], alwaysEnabled: [...GOOD_LISTS.alwaysEnabled, 'firstrunwizard'] });
  assertFails(files, /removed app workflowengine is in shippedApps of core\/shipped\.json/, /removed app firstrunwizard is in alwaysEnabled of core\/shipped\.json/);
});

test('an always app missing from alwaysEnabled and a default app missing from defaultEnabled fail', () => {
  const { files } = produced();
  setLists(files, { ...GOOD_LISTS, defaultEnabled: [], alwaysEnabled: ['dav', 'demo'] });
  assertFails(files, /app files \(always\) is not in alwaysEnabled of core\/shipped\.json/, /app activity \(default\) is not in defaultEnabled of core\/shipped\.json/);
});

test('an added app in shippedApps fails', () => {
  const { files } = produced();
  setLists(files, { ...GOOD_LISTS, shippedApps: [...GOOD_LISTS.shippedApps, 'demo'] });
  assertFails(files, /added app demo is in shippedApps of core\/shipped\.json/);
});

test('a default app that is also always enabled fails', () => {
  const { files } = produced();
  setLists(files, { ...GOOD_LISTS, alwaysEnabled: [...GOOD_LISTS.alwaysEnabled, 'activity'] });
  assertFails(files, /app activity \(default\) is in alwaysEnabled of core\/shipped\.json/);
});

test('missing or broken core/shipped.json fails', () => {
  const missing = produced().files;
  missing.delete('core/shipped.json');
  assertFails(missing, /missing core\/shipped\.json/);
  const broken = produced().files;
  put(broken, 'core/shipped.json', '{nope');
  assertFails(broken, /core\/shipped\.json is not valid JSON/);
});

// forbidden entries

for (const [path, name] of [
  ['config/CAN_INSTALL', 'config/CAN_INSTALL'],
  ['IONOS/README.md', 'IONOS/README.md'],
  ['updater/index.php', 'updater/'],
  ['.git/HEAD', '.git/HEAD'],
  ['.github/workflows/ci.yml', '.github/workflows/ci.yml'],
  ['.gitignore', '.gitignore'],
  ['.gitmodules', '.gitmodules'],
  ['apps/files/.git/config', 'apps/files/.git/config'],
  ['apps-flavor1/demo/node_modules/x/index.js', 'apps-flavor1/demo/node_modules/x/index.js'],
  ['apps/files/tests/unit.php', 'apps/files/tests/unit.php'],
  ['apps-flavor1/demo/test/unit.php', 'apps-flavor1/demo/test/unit.php'],
] as const) {
  test(`forbidden entry ${path} fails and is named`, () => {
    const { files } = produced();
    put(files, path, 'x');
    assertFails(files, new RegExp(`forbidden entry ${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`));
  });
}

test('a tests directory outside the apps is allowed', () => {
  const { files } = produced();
  put(files, 'lib/tests/helper.php', 'x');
  const result = validateBoth(files);
  assert.equal(result.status, 0, result.stderr);
});

// version files

test('missing version.json and .buildnumber fail and are named', () => {
  const { files } = produced();
  files.delete('version.json');
  files.delete('.buildnumber');
  assertFails(files, /missing version file version\.json/, /missing version file \.buildnumber/);
});

test('a .buildnumber that is not a positive integer fails', () => {
  const { files } = produced();
  put(files, '.buildnumber', 'abc\n');
  assertFails(files, /\.buildnumber must be a positive integer, got "abc"/);
});

test('a .buildnumber that differs from build_number in version.json fails', () => {
  const { files } = produced();
  put(files, '.buildnumber', '813\n');
  assertFails(files, /\.buildnumber is 813 but version\.json build_number is 812/);
});

test('version.php with another channel fails', () => {
  const { files } = produced();
  put(files, 'version.php', text(files, 'version.php').replace("'git'", "'stable'"));
  assertFails(files, /version\.php does not set the channel 'git'/);
});

test('version.php without the build number snippet, or with it twice, fails', () => {
  const none = produced().files;
  const version = text(none, 'version.php');
  const snippet = version.slice(version.indexOf('\n$buildNumberFile'));
  put(none, 'version.php', version.replace(snippet, '\n'));
  assertFails(none, /version\.php has the build number snippet 0 times, expected once/);

  const twice = produced().files;
  put(twice, 'version.php', text(twice, 'version.php') + snippet);
  assertFails(twice, /version\.php has the build number snippet 2 times, expected once/);
});

// every violation is listed

test('every violation is listed, not just the first', () => {
  const { files } = produced();
  put(files, 'config/99-extra.config.php', '<?php\n');
  put(files, 'apps/stranger/appinfo/info.xml', '<info/>');
  put(files, 'updater/index.php', 'x');
  files.delete('.buildnumber');
  assertFails(files, /99-extra\.config\.php/, /app stranger/, /updater\/index\.php/, /\.buildnumber/);
});

// flavor and config numbers

test('a version.json that is for another flavor fails and names both flavors', () => {
  const { files } = produced();
  const version = JSON.parse(text(files, 'version.json')) as Record<string, unknown>;
  put(files, 'version.json', JSON.stringify({ ...version, flavor: 'other' }, null, 2) + '\n');
  assertFails(files, /version\.json is for flavor "other" but the flavor to validate is "flavor1"/);
});

test('two config files with the same number fail and both are named', () => {
  const { files } = produced();
  put(files, 'config/50-other.config.php', '<?php\n');
  assertFails(files, /config files config\/50-flavor\.config\.php and config\/50-other\.config\.php share the number 50/);
});
