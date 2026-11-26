import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { build, defaultFlavorsRoot, makeServerTree, readZip, runCli, tempDir } from './helpers.ts';

const STRIPPED = [
  '.git/HEAD',
  '.github/workflows/ci.yml',
  '.gitignore',
  '.gitmodules',
  'node_modules/dep/index.js',
  'apps/files/.git/config',
  'apps/files/node_modules/dep/index.js',
  'apps/files/tests/unit.php',
  'apps/files/lib/test/helper.php',
  'apps-flavor1/demo/test/unit.php',
  'apps-flavor1/demo/tests/unit.php',
  'IONOS/README.md',
  'IONOS/flavors/flavor1/flavor.yaml',
];

const KEPT = [
  'lib/base.php',
  'lib/tests/helper.php',
  'lib/IONOS/keep.php',
  'apps/files/lib/Controller.php',
  'apps-flavor1/demo/lib/tests.php',
  'config/config.sample.php',
];

test('the build strips the dev files, keeps everything else, and the artifact validates', () => {
  const tree = makeServerTree();
  for (const path of [...STRIPPED, ...KEPT]) {
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), 'x');
  }
  const result = build({ tree, out: tempDir('out') });
  assert.equal(result.status, 0, result.stderr);

  const entries = readZip(result.stdout.trim());
  assert.deepEqual(STRIPPED.filter((path) => entries.has(path)), []);
  assert.deepEqual(KEPT.filter((path) => !entries.has(path)), []);

  const validated = runCli(['validate', '--flavors', defaultFlavorsRoot(), '--flavor', 'flavor1', '--artifact', result.stdout.trim()]);
  assert.equal(validated.status, 0, validated.stderr);
});
