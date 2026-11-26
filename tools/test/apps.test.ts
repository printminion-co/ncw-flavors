import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, configAsNextcloudSeesIt, hasPhp, makeFlavorsRoot, makeServerTree, readZip, tempDir, text } from './helpers.ts';

// The fixture tree ships five apps. The example flavor (base `common` plus `flavor1`) declares:
//   files: always, dav: always, activity: default, demo: always (from an app folder),
//   workflowengine: removed, firstrunwizard: removed.

test('the shipped-apps lists follow the app modes of the flavor', () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());

  assert.deepEqual(JSON.parse(text(zip, 'core/shipped.json')), {
    // removed apps leave all three lists; the added app `demo` is never listed as shipped
    shippedApps: ['activity', 'dav', 'files'],
    defaultEnabled: ['activity'],
    alwaysEnabled: ['dav', 'demo', 'files'],
  });
});

test('removed apps are gone from the tree and kept apps are still there', () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const entries = [...readZip(result.stdout.trim()).keys()];

  assert.deepEqual(entries.filter((e) => e.startsWith('apps/workflowengine/') || e.startsWith('apps/firstrunwizard/')), []);
  for (const kept of ['apps/activity/appinfo/info.xml', 'apps/dav/appinfo/info.xml', 'apps/files/appinfo/info.xml']) {
    assert.ok(entries.includes(kept), `${kept} must stay`);
  }
});

test('only the app folders the flavor activates are shipped', () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const entries = [...readZip(result.stdout.trim()).keys()];

  assert.ok(entries.includes('apps-flavor1/demo/appinfo/info.xml'), 'the active app folder is shipped');
  assert.deepEqual(entries.filter((e) => e.startsWith('apps-other/')), [], 'an inactive app folder is not shipped');
});

test('a generated partial config makes the active app folders app roots', { skip: !hasPhp && 'php is not installed' }, () => {
  const result = build({ tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());

  assert.deepEqual(JSON.parse(configAsNextcloudSeesIt(zip, 'config/00-apps-paths.config.php')), {
    apps_paths: [
      { path: '/srv/nextcloud/apps', url: '/apps', writable: false },
      { path: '/srv/nextcloud/apps-flavor1', url: '/apps-flavor1', writable: false },
    ],
  });
});

test('an available app stays on disk and shipped but is neither default- nor always-enabled', () => {
  const flavorsRoot = makeFlavorsRoot({
    'flavors/lite/flavor.yaml': 'apps:\n  activity: available\n  dav: always\n',
  });
  const result = build({ flavorsRoot, flavor: 'lite', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());

  assert.deepEqual(JSON.parse(text(zip, 'core/shipped.json')), {
    shippedApps: ['activity', 'dav', 'files', 'firstrunwizard', 'workflowengine'],
    defaultEnabled: ['files', 'firstrunwizard'],
    alwaysEnabled: ['dav', 'files', 'workflowengine'],
  });
  assert.ok(zip.has('apps/activity/appinfo/info.xml'), 'the app files stay on disk');
});
