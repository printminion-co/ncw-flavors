import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { build, configAsNextcloudSeesIt, entryTimestamps, hasPhp, makeServerTree, readZip, tempDir, text, versionAsNextcloudSeesIt } from './helpers.ts';

test('build writes one artifact named after the flavor, the base release and the build number', () => {
  const out = tempDir('out');
  const result = build({ tree: makeServerTree(), out });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(out), ['ncw-flavor1-v33.0.9.812.zip']);
  assert.equal(result.stdout.trim(), join(out, 'ncw-flavor1-v33.0.9.812.zip'));
  assert.ok(existsSync(result.stdout.trim()));
});

test('the artifact has no install flag file and no web updater, and keeps the rest of the tree', () => {
  const out = tempDir('out');
  const result = build({ tree: makeServerTree(), out });
  assert.equal(result.status, 0, result.stderr);

  const entries = [...readZip(result.stdout.trim()).keys()];
  assert.ok(!entries.includes('config/CAN_INSTALL'), 'config/CAN_INSTALL must be removed');
  assert.deepEqual(entries.filter((e) => e.startsWith('updater/')), [], 'the updater directory must be removed');
  assert.ok(entries.includes('config/config.sample.php'));
  assert.ok(entries.includes('lib/base.php'));
});

test('the artifact carries the build number in its build number file', () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out'), buildNumber: '4711' });
  assert.equal(result.status, 0, result.stderr);

  assert.equal(text(readZip(result.stdout.trim()), '.buildnumber'), '4711\n');
});

test('the version file reports channel git and the build number as a fifth version element', { skip: !hasPhp && 'php is not installed' }, () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());

  assert.equal(versionAsNextcloudSeesIt(zip), '[[33,0,9,1,812],"git"]');
  assert.equal(versionAsNextcloudSeesIt(zip, false), '[[33,0,9,1],"git"]', 'without the build number file the version stays upstream\'s');
});

test('the partial configs of the bases and of the flavor are shipped in the config folder', { skip: !hasPhp && 'php is not installed' }, () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());

  assert.deepEqual(JSON.parse(configAsNextcloudSeesIt(zip, 'config/10-core.config.php')), {
    appstoreenabled: false,
    'upgrade.disable-web': true,
  });
  assert.deepEqual(JSON.parse(configAsNextcloudSeesIt(zip, 'config/50-flavor.config.php')), {
    default_phone_region: 'DE',
  });
  assert.ok(zip.has('config/config.sample.php'), "upstream's sample config stays");
});

test('two builds with the same inputs give byte-identical artifacts', () => {
  const first = build({ tree: makeServerTree(), out: tempDir('out') });
  const second = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);

  assert.ok(readFileSync(first.stdout.trim()).equals(readFileSync(second.stdout.trim())), 'the artifacts differ');
  // 33 is the DOS date 1980-01-01 and 0 is midnight: a fixed timestamp, so the clock cannot leak into the artifact
  assert.deepEqual([...new Set(entryTimestamps(first.stdout.trim()))], ['33:0']);
});

test('build prints the resolved flavor to stderr for the build log and keeps stdout for the artifact path', () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);

  assert.ok(result.stdout.trim().endsWith('ncw-flavor1-v33.0.9.812.zip'));
  assert.deepEqual(parse(result.stderr), {
    flavor: 'flavor1',
    order: ['bases/common', 'flavors/flavor1'],
    apps: { activity: 'default', dav: 'always', demo: 'always', files: 'always', firstrunwizard: 'removed', workflowengine: 'removed' },
    app_folders: ['apps-flavor1'],
    themes: [],
    config_files: {
      '10-core.config.php': 'bases/common/config/10-core.config.php',
      '50-flavor.config.php': 'flavors/flavor1/config/50-flavor.config.php',
    },
    env: [],
  });
});
