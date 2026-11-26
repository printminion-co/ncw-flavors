import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { addApp, setShippedLists } from './app-helpers.ts';
import { build, makeFlavorsRoot, makeServerTree, readZip, tempDir } from './helpers.ts';

// The fixture tree ships dav, files, activity, firstrunwizard and workflowengine in `apps`, `demo` in the
// active app folder `apps-flavor1` and `other` in the inactive `apps-other`.

const LITE = { 'flavors/lite/flavor.yaml': 'apps:\n  activity: available\n  dav: always\n' };

test('an unclassified app fails a release build and is named, and no artifact is written', () => {
  const out = tempDir('out');
  const result = build({ flavorsRoot: makeFlavorsRoot(LITE), flavor: 'lite', kind: 'release', tree: makeServerTree(), out });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unclassified apps: files, firstrunwizard, workflowengine/);
  assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'no artifact');
});

test('an unclassified app is only a warning in a dev build, which still succeeds', () => {
  const result = build({ flavorsRoot: makeFlavorsRoot(LITE), flavor: 'lite', kind: 'dev', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /warning: app files has no mode/);
  assert.match(result.stderr, /warning: app firstrunwizard has no mode/);
  assert.match(result.stderr, /warning: app workflowengine has no mode/);
  assert.doesNotMatch(result.stderr, /warning: app (dav|activity) /);
});

test('an unclassified app in an active app folder is reported too', () => {
  const tree = makeServerTree();
  addApp(tree, 'apps-flavor1', 'extra');
  const flavorsRoot = makeFlavorsRoot({
    'flavors/f/flavor.yaml': 'app_dirs: [apps-flavor1]\napps:\n  files: always\n  dav: always\n  activity: default\n  demo: always\n  firstrunwizard: removed\n  workflowengine: removed\n',
  });
  const release = build({ flavorsRoot, flavor: 'f', kind: 'release', tree, out: tempDir('out') });
  assert.equal(release.status, 2);
  assert.match(release.stderr, /unclassified apps: extra\b/);
  const dev = build({ flavorsRoot, flavor: 'f', kind: 'dev', tree, out: tempDir('out') });
  assert.equal(dev.status, 0, dev.stderr);
  assert.match(dev.stderr, /warning: app extra has no mode/);
});

test('an app in an inactive app folder needs no mode', () => {
  // `other` lives in apps-other, which the flavor does not activate
  const result = build({ kind: 'release', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /other/);
});

test('a fully classified flavor builds in a release without warnings', () => {
  const result = build({ kind: 'release', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning/);
});

// ---- duplicates

const ALL_CLASSIFIED = 'apps:\n  files: always\n  dav: always\n  activity: default\n  firstrunwizard: removed\n  workflowengine: removed\n';

test('an app id in the server tree and in an active folder fails and names both locations', () => {
  const tree = makeServerTree();
  addApp(tree, 'apps-flavor1', 'files');
  const flavorsRoot = makeFlavorsRoot({ 'flavors/f/flavor.yaml': `app_dirs: [apps-flavor1]\n${ALL_CLASSIFIED}  demo: always\n` });
  const out = tempDir('out');
  const result = build({ flavorsRoot, flavor: 'f', tree, out });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /app files is in apps\/files and apps-flavor1\/files/);
  assert.ok(!existsSync(out) || readdirSync(out).length === 0, 'no artifact');
});

test('an app id in two active folders fails and names both, in dev and release builds', () => {
  const tree = makeServerTree();
  addApp(tree, 'apps-other', 'demo');
  const flavorsRoot = makeFlavorsRoot({ 'flavors/f/flavor.yaml': `app_dirs: [apps-flavor1, apps-other]\n${ALL_CLASSIFIED}  demo: always\n  other: available\n` });
  for (const kind of ['dev', 'release']) {
    const result = build({ flavorsRoot, flavor: 'f', tree, kind, out: tempDir('out') });
    assert.equal(result.status, 2, kind);
    assert.match(result.stderr, /app demo is in apps-flavor1\/demo and apps-other\/demo/);
  }
});

test('the same app id in a folder the flavor does not activate is no duplicate', () => {
  const tree = makeServerTree();
  addApp(tree, 'apps-other', 'demo');
  const result = build({ tree, out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
});

// ---- modes and the lists (fixture cases from the 33.0.9 prototype)

function listsOf(flavorYaml: string, tree = makeServerTree(), folders = '') {
  const flavorsRoot = makeFlavorsRoot({ 'flavors/f/flavor.yaml': `${folders}${flavorYaml}` });
  const result = build({ flavorsRoot, flavor: 'f', tree, kind: 'release', out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);
  const zip = readZip(result.stdout.trim());
  return { zip, lists: JSON.parse(new TextDecoder().decode(zip.get('core/shipped.json'))) as Record<string, string[]> };
}

test('dropping a default-enabled app removes it from all lists and from the tree', () => {
  const { zip, lists } = listsOf('apps:\n  files: always\n  dav: always\n  activity: removed\n  firstrunwizard: default\n  workflowengine: always\n');
  assert.deepEqual(lists, {
    shippedApps: ['dav', 'files', 'firstrunwizard', 'workflowengine'],
    defaultEnabled: ['firstrunwizard'],
    alwaysEnabled: ['dav', 'files', 'workflowengine'],
  });
  assert.ok(![...zip.keys()].some((e) => e.startsWith('apps/activity/')));
});

test('dropping an always-enabled app removes it from all lists and from the tree', () => {
  const { zip, lists } = listsOf('apps:\n  files: always\n  dav: always\n  activity: default\n  firstrunwizard: default\n  workflowengine: removed\n');
  assert.deepEqual(lists, {
    shippedApps: ['activity', 'dav', 'files', 'firstrunwizard'],
    defaultEnabled: ['activity', 'firstrunwizard'],
    alwaysEnabled: ['dav', 'files'],
  });
  assert.ok(![...zip.keys()].some((e) => e.startsWith('apps/workflowengine/')));
});

test('mode changes move a vanilla app between the lists and keep it shipped', () => {
  // vanilla: activity is default-enabled, workflowengine is always-enabled, firstrunwizard default-enabled
  const { lists } = listsOf('apps:\n  files: always\n  dav: always\n  activity: always\n  firstrunwizard: available\n  workflowengine: default\n');
  assert.deepEqual(lists, {
    shippedApps: ['activity', 'dav', 'files', 'firstrunwizard', 'workflowengine'],
    defaultEnabled: ['workflowengine'],
    alwaysEnabled: ['activity', 'dav', 'files'],
  });
});

test('an added app is enabled by its mode but is never in the shipped list', () => {
  const tree = makeServerTree();
  addApp(tree, 'apps-flavor1', 'extra');
  const yaml = `${ALL_CLASSIFIED}  demo: default\n  extra: always\n`;
  const { lists } = listsOf(yaml, tree, 'app_dirs: [apps-flavor1]\n');
  assert.deepEqual(lists, {
    shippedApps: ['activity', 'dav', 'files'],
    defaultEnabled: ['activity', 'demo'],
    alwaysEnabled: ['dav', 'extra', 'files'],
  });
  const available = listsOf(`${ALL_CLASSIFIED}  demo: available\n  extra: available\n`, tree, 'app_dirs: [apps-flavor1]\n');
  assert.deepEqual(available.lists.shippedApps, ['activity', 'dav', 'files']);
  assert.ok(!available.lists.alwaysEnabled?.includes('extra') && !available.lists.defaultEnabled?.includes('demo'));
});

test('a removed app that lives in an active app folder is gone from the tree and the lists', () => {
  const { zip, lists } = listsOf(`${ALL_CLASSIFIED}  demo: removed\n`, makeServerTree(), 'app_dirs: [apps-flavor1]\n');
  assert.ok(![...zip.keys()].some((e) => e.startsWith('apps-flavor1/demo/')));
  assert.deepEqual(lists.alwaysEnabled, ['dav', 'files']);
  assert.ok(!lists.shippedApps?.includes('demo'));
});

test('fresh-install contents: a flavor that classifies everything enables exactly its always and default apps', () => {
  const { lists } = listsOf('apps:\n  files: always\n  dav: always\n  activity: default\n  firstrunwizard: available\n  workflowengine: removed\n');
  assert.deepEqual(lists, {
    shippedApps: ['activity', 'dav', 'files', 'firstrunwizard'],
    defaultEnabled: ['activity'],
    alwaysEnabled: ['dav', 'files'],
  });
});

// ---- a removed app is never left in a list, whatever the starting point

test('a removed app is in no list of the artifact, over several fixtures', () => {
  const MODES = ['always', 'default', 'available', 'removed'];
  const ids = ['activity', 'dav', 'files', 'firstrunwizard', 'workflowengine'];
  for (let seed = 0; seed < 12; seed++) {
    // a deterministic spread of mode combinations
    const modes = ids.map((_, i) => MODES[(seed * (i + 1) + i) % 4] as string);
    const tree = makeServerTree();
    const { lists } = listsOf(`apps:\n${ids.map((id, i) => `  ${id}: ${modes[i]}`).join('\n')}\n`, tree);
    ids.forEach((id, i) => {
      if (modes[i] !== 'removed') return;
      for (const [name, list] of Object.entries(lists)) assert.ok(!list.includes(id), `seed ${seed}: ${id} left in ${name}`);
    });
  }
});

test('a removed app that is already missing from the shipped lists of the tree is fine', () => {
  const tree = makeServerTree();
  setShippedLists(tree, { shippedApps: ['dav', 'files'], defaultEnabled: [], alwaysEnabled: ['dav', 'files'] });
  const { lists } = listsOf('apps:\n  files: always\n  dav: always\n  activity: removed\n  firstrunwizard: removed\n  workflowengine: removed\n', tree);
  assert.deepEqual(lists, { shippedApps: ['dav', 'files'], defaultEnabled: [], alwaysEnabled: ['dav', 'files'] });
});
