import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, defaultFlavorsRoot, makeFlavorsRoot, makeServerTree, readZip, resolveCli, resolveReport, tempDir, text } from './helpers.ts';

test('resolve prints the flavor with its apps, app folders, themes, config files and environment variables', () => {
  assert.deepEqual(resolveReport(defaultFlavorsRoot(), 'flavor1'), {
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

test('bases of bases are applied depth first, so a nearer declaration beats a more distant one', () => {
  const root = makeFlavorsRoot({
    'bases/c/flavor.yaml': 'apps:\n  files: always\n  calendar: default\n',
    'bases/b/flavor.yaml': 'extends: [c]\napps:\n  calendar: removed\n',
    'bases/a/flavor.yaml': 'extends: [b]\napps:\n  talk: available\n',
    'flavors/f/flavor.yaml': 'extends: [a]\napps:\n  files: default\n',
  });
  const report = resolveReport(root, 'f');

  assert.deepEqual(report.order, ['bases/c', 'bases/b', 'bases/a', 'flavors/f']);
  assert.deepEqual(report.apps, { calendar: 'removed', files: 'default', talk: 'available' });
});

test('of two sibling bases the one listed later wins', () => {
  const files = {
    'bases/x/flavor.yaml': 'apps:\n  tool: always\n',
    'bases/y/flavor.yaml': 'apps:\n  tool: removed\n',
  };
  const xThenY = resolveReport(makeFlavorsRoot({ ...files, 'flavors/f/flavor.yaml': 'extends: [x, y]\n' }), 'f');
  const yThenX = resolveReport(makeFlavorsRoot({ ...files, 'flavors/f/flavor.yaml': 'extends: [y, x]\n' }), 'f');

  assert.deepEqual(xThenY.apps, { tool: 'removed' });
  assert.deepEqual(yThenX.apps, { tool: 'always' });
});

test('a base reached through two paths is applied once, where it is first reached', () => {
  const root = makeFlavorsRoot({
    'bases/x/flavor.yaml': 'apps:\n  tool: always\n',
    'bases/a/flavor.yaml': 'extends: [x]\napps:\n  tool: removed\n',
    'bases/b/flavor.yaml': 'extends: [x]\n',
    'flavors/f/flavor.yaml': 'extends: [a, b]\n',
  });
  const report = resolveReport(root, 'f');

  assert.deepEqual(report.order, ['bases/x', 'bases/a', 'bases/b', 'flavors/f']);
  assert.equal(report.apps['tool'], 'removed', 'applying x again after a would undo the override made by a');
});

test('a config file with the same name in a nearer base replaces the earlier one', () => {
  const root = makeFlavorsRoot({
    'bases/b/flavor.yaml': '',
    'bases/b/config/10-core.config.php': '<?php // from the base\n',
    'bases/b/config/20-mail.config.php': '<?php // base mail\n',
    'bases/c/flavor.yaml': 'extends: [b]\n',
    'bases/c/config/10-core.config.php': '<?php // from the nearer base\n',
    'flavors/f/flavor.yaml': 'extends: [c]\n',
  });

  assert.deepEqual(resolveReport(root, 'f').config_files, {
    '10-core.config.php': 'bases/c/config/10-core.config.php',
    '20-mail.config.php': 'bases/b/config/20-mail.config.php',
  });
});

test('the artifact ships the config file of the nearer declaration', () => {
  const root = makeFlavorsRoot({
    'bases/b/flavor.yaml': '',
    'bases/b/config/10-core.config.php': '<?php // from the base\n',
    'bases/b/config/20-mail.config.php': '<?php // base mail\n',
    'bases/c/flavor.yaml': 'extends: [b]\n',
    'bases/c/config/10-core.config.php': '<?php // from the nearer base\n',
    'flavors/f/flavor.yaml': 'extends: [c]\n',
  });
  const built = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });
  assert.equal(built.status, 0, built.stderr);

  const zip = readZip(built.stdout.trim());
  assert.equal(text(zip, 'config/10-core.config.php'), '<?php // from the nearer base\n');
  assert.equal(text(zip, 'config/20-mail.config.php'), '<?php // base mail\n');
});

test('themes are an ordered union and a later environment variable declaration replaces an earlier one', () => {
  const root = makeFlavorsRoot({
    'bases/x/flavor.yaml': 'themes: [t1]\nenv:\n  - { name: A, required: true }\n',
    'bases/y/flavor.yaml': 'themes: [t2, t1]\nenv:\n  - { name: A, required: false, default: d }\n  - { name: B }\n',
    'flavors/f/flavor.yaml': 'extends: [x, y]\nthemes: [t3]\n',
  });
  const report = resolveReport(root, 'f');

  assert.deepEqual(report.themes, ['t1', 't2', 't3']);
  assert.deepEqual(report.env, [
    { name: 'A', required: false, default: 'd' },
    { name: 'B', required: false },
  ]);
});

test('a flavor without bases resolves with only itself in the order', () => {
  const root = makeFlavorsRoot({ 'flavors/solo/flavor.yaml': 'apps:\n  files: always\n' });

  assert.deepEqual(resolveReport(root, 'solo').order, ['flavors/solo']);
});

const cycles: { name: string; files: Record<string, string>; mentions: string[] }[] = [
  {
    name: 'two bases that extend each other',
    files: {
      'bases/a/flavor.yaml': 'extends: [b]\n',
      'bases/b/flavor.yaml': 'extends: [a]\n',
      'flavors/f/flavor.yaml': 'extends: [a]\n',
    },
    mentions: ['cycle', 'flavors/f -> bases/a -> bases/b -> bases/a'],
  },
  {
    name: 'a base that extends itself',
    files: { 'bases/a/flavor.yaml': 'extends: [a]\n', 'flavors/f/flavor.yaml': 'extends: [a]\n' },
    mentions: ['cycle', 'bases/a -> bases/a'],
  },
];

for (const c of cycles) {
  test(`a cycle between ${c.name} is rejected by resolve and by build, and the message names it`, () => {
    const root = makeFlavorsRoot(c.files);
    const resolved = resolveCli(root, 'f');
    const built = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });

    for (const result of [resolved, built]) {
      assert.equal(result.status, 2, result.stderr);
      for (const word of c.mentions) assert.ok(result.stderr.includes(word), `stderr should mention "${word}", got: ${result.stderr}`);
    }
  });
}
