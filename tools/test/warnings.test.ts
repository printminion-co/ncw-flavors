import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addApp } from './app-helpers.ts';
import { build, makeFlavorsRoot, makeServerTree, tempDir } from './helpers.ts';

test('a flavor config file that replaces a base file of the same name needs no convention warning', () => {
  const root = makeFlavorsRoot({
    'bases/b/flavor.yaml': '',
    'bases/b/config/10-core.config.php': '<?php\n$CONFIG = [\'appstoreenabled\' => false];\n',
    'flavors/f/flavor.yaml': 'extends: [b]\n',
    'flavors/f/config/10-core.config.php': '<?php\n$CONFIG = [\'appstoreenabled\' => true];\n',
  });
  const result = build({ flavorsRoot: root, flavor: 'f', tree: makeServerTree(), out: tempDir('out') });

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /warning: config file/);
});

test('a build that fails still prints the warnings collected before the failure', () => {
  const root = makeFlavorsRoot({
    'flavors/f/flavor.yaml': 'app_dirs: [apps-flavor1]\n',
    'flavors/f/config/20-low.config.php': '<?php\n$CONFIG = [\'appstoreenabled\' => false];\n',
  });
  const tree = makeServerTree();
  addApp(tree, 'apps-flavor1', 'files'); // the same app id as apps/files
  const result = build({ flavorsRoot: root, flavor: 'f', tree, out: tempDir('out') });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /warning: config file flavors\/f\/config\/20-low\.config\.php uses number 20/);
  assert.match(result.stderr, /apps\/files/, 'the failure itself is still reported');
});
